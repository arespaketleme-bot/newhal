/* ═══════════════════════════════════════════════════════════════
   NewHal — arama motoru sayfaları
   /isletme/:id-ad   her işletmenin sunucuda hazırlanan sayfası
   /isletmeler       tüm işletmeler, kategoriye göre
   /ilan/:no-baslik  her ilanın sunucuda hazırlanan sayfası
   /ilanlar          güncel ilanların listesi
   /kategori/:ad     bir kategorideki tüm işletmeler
   /urun/:ad         bir ürün ya da hizmet: satan işletmeler ve ilgili ilanlar
   /urunler          tüm ürün ve hizmet sayfaları
   /sitemap.xml      Google'a verilen sayfa listesi
   /robots.txt       hangi sayfaların taranacağı
   ═══════════════════════════════════════════════════════════════ */

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
const SITEMAP_CACHE_MS = 10 * 60 * 1000;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function slugify(text) {
  return String(text || '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, ch => TR_MAP[ch])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'isletme';
}

const pinPath = pin => `/isletme/${pin.id}-${slugify(pin.title)}`;

// İlanlar: hava durumu kartı ve onay bekleyen/kapalı ilanlar yayına çıkmaz
const isPublicAd = a => !!(a && a.no && !a.weather && a.active !== false && !a.pending);
const adText = a => String(a.title || a.body || '').replace(/[\u200b\s]+/g, ' ').trim()
  || (a.video ? 'Videolu ilan' : (a.images || []).length ? 'Fotoğraflı ilan' : 'İlan');
const adSlug = a => { const s = slugify(adText(a)); return (s.length > 60 ? s.slice(0, 60).replace(/-[^-]*$/, '') : s) || 'ilan'; };
const adPath = a => `/ilan/${a.no}-${adSlug(a)}`;
// Arama sonucu açıklaması telefon numarasıyla başlamasın
const stripPhones = t => String(t || '').replace(/\+?\d[\d\s().-]{8,}\d/g, ' ')
  .replace(/[\u200b\s]+/g, ' ').replace(/^[\s—–\-·:,]+/, '').trim();
const catPath = name => `/kategori/${slugify(name)}`;
const productPath = name => `/urun/${slugify(name)}`;
const MIN_CATEGORY_PINS = 3;
const MIN_PRODUCT_HITS = 3;
// Ilanlarda sik gecen hal urunleri. Grup: hangi isletme turu satar
const PRODUCE = {
  sebze: ['domates', 'biber', 'patlıcan', 'salatalık', 'kabak', 'fasulye', 'patates', 'soğan', 'sarımsak', 'marul', 'lahana',
    'karnabahar', 'brokoli', 'havuç', 'ıspanak', 'mantar', 'enginar', 'bezelye', 'bamya', 'pırasa', 'maydanoz'],
  meyve: ['limon', 'portakal', 'mandalina', 'greyfurt', 'narenciye', 'muz', 'elma', 'armut', 'üzüm', 'karpuz', 'kavun', 'çilek',
    'nar', 'ayva', 'kiraz', 'şeftali', 'kayısı', 'erik', 'avokado', 'kivi', 'incir', 'zeytin', 'ceviz'],
};
const TR_LETTER = 'a-zçğıöşü0-9';
const lowerTr = t => String(t || '').toLocaleLowerCase('tr-TR');
const titleTr = t => t.split(' ').map(w => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)).join(' ');
// Kelimenin basinda eslesir ("domatesi", "limonlar" de sayilir); kisa kelimeler yalniz ek alirsa ("nar" ama "narin" degil)
const termRegex = term => {
  const w = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return term.length <= 3
    ? new RegExp(`(^|[^${TR_LETTER}])${w}(lar|ler|ı|i|u|ü|ın|in)?(?![${TR_LETTER}])`)
    : new RegExp(`(^|[^${TR_LETTER}])${w}`);
};
const trDate = iso => {
  try { return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }); }
  catch { return ''; }
};

// Yapay zeka aramalari ve Google icin soru-cevap blogu. Cevaplar yalniz sitedeki gercek veriden uretilir.
const HAL_PLACE = 'Mersin Sebze ve Meyve Hal Kompleksi';
const HAL_AREA = 'Akdeniz ilçesinde (Mersin, 33020)';
function faq(qas) {
  const list = qas.filter(([q, a]) => q && a);
  if (!list.length) return { html: '', jsonLd: null };
  return {
    html: `<h2>Sık sorulan sorular</h2>\n${list.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${esc(a)}</p>`).join('\n')}`,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: list.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  };
}
const joinTr = arr => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} ve ${arr[arr.length - 1]}`);

// Tum urun/hizmet sayfalarini hesaplar: hal urunleri + isletmelerin en az 3'unun sattigi kalemler.
// Ayni liste ard arda istenince 5 dakika yeniden hesaplanmaz.
let productsCache = { pins: null, ads: null, at: 0, list: [] };
function buildProducts(pins, ads) {
  if (productsCache.pins === pins && productsCache.ads === ads && Date.now() - productsCache.at < 5 * 60 * 1000) return productsCache.list;
  const list = computeProducts(pins, ads);
  productsCache = { pins, ads, at: Date.now(), list };
  return list;
}
function computeProducts(pins, ads) {
  const liveAds = ads.filter(isPublicAd);
  const adTexts = liveAds.map(a => lowerTr(`${a.title || ''} ${a.body || ''}`));
  const sellsOf = p => (p.sells || []).map(x => lowerTr(x).trim());
  const terms = new Map();
  Object.entries(PRODUCE).forEach(([group, list]) => list.forEach(t => terms.set(t, group)));
  const sellCount = {};
  pins.forEach(p => new Set(sellsOf(p)).forEach(t => { sellCount[t] = (sellCount[t] || 0) + 1; }));
  // Kategori adiyla ayni kalem (ör. "market") ayri sayfa olmaz; kategori sayfasi zaten var
  const categoryNames = new Set(pins.map(p => lowerTr(p.category)));
  Object.entries(sellCount).forEach(([t, n]) => {
    if (n < MIN_PRODUCT_HITS || terms.has(t) || t.length <= 2 || categoryNames.has(t)) return;
    terms.set(t, PRODUCE[t] ? t : null);   // "sebze" ve "meyve" kendi grubunun sayfasidir
  });

  const out = [];
  terms.forEach((group, term) => {
    const re = termRegex(term);
    const matchedAds = liveAds.filter((a, i) => re.test(adTexts[i]));
    const sellers = pins.filter(p => sellsOf(p).includes(term) || re.test(lowerTr(p.title)));
    // Hal urunu: sebze/meyve satan komisyoncu ve tuccarlar da listelenir
    const groupSellers = group && group !== term
      ? pins.filter(p => !sellers.includes(p) && ['Komisyoncu', 'Tüccar', 'Müstahsil', 'Manav'].includes(p.category) && sellsOf(p).includes(group))
      : [];
    if (matchedAds.length + sellers.length < MIN_PRODUCT_HITS) return;
    if (out.some(o => slugify(o.term) === slugify(term))) return;
    out.push({ term, name: titleTr(term), group, ads: matchedAds, sellers, groupSellers });
  });
  return out.sort((a, b) => (b.ads.length + b.sellers.length) - (a.ads.length + a.sellers.length));
}

// Sayfanın ortak iskeleti: başlık, açıklama, kalıcı adres, paylaşım önizlemesi, yapılandırılmış veri
function layout({ site, title, description, path, image, jsonLd, body }) {
  const url = site + path;
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(url)}" />
<meta name="theme-color" content="#080c16" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="tr_TR" />
<meta property="og:site_name" content="NewHal" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image || site + '/img/newhal-og-share.png')}" />
<meta name="twitter:card" content="summary_large_image" />
${(jsonLd || []).map(d => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n')}
<style>
  body { margin: 0; background: #080c16; color: #e2e8f0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 820px; margin: 0 auto; padding: 24px 16px 64px; }
  a { color: #34d399; }
  .top { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; font-weight: 700; text-decoration: none; color: #fff; }
  .ad-body { white-space: pre-line; font-size: 17px; color: #f1f5f9; }
  .meta { font-size: 14px; color: #94a3b8; }
  .comment { padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,0.05); margin-bottom: 8px; }
  .comment b { color: #fff; }
  video { max-width: 100%; border-radius: 12px; }
  .top img { width: 36px; height: 36px; border-radius: 10px; }
  nav.crumbs { font-size: 13px; color: #94a3b8; margin-bottom: 10px; }
  nav.crumbs a { color: #94a3b8; }
  h1 { color: #fff; font-size: 28px; line-height: 1.2; margin: 0 0 6px; }
  h2 { color: #fff; font-size: 19px; margin: 28px 0 10px; }
  h3 { color: #f1f5f9; font-size: 16px; margin: 18px 0 4px; }
  .cat { display: inline-block; font-size: 13px; padding: 3px 12px; border-radius: 99px; background: rgba(0,255,135,0.1); color: #34d399; border: 1px solid rgba(0,255,135,0.3); }
  .badge { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: #1d9bf0; color: #fff; font-size: 12px; align-items: center; justify-content: center; vertical-align: 4px; margin-left: 6px; }
  dl { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 20px 0; }
  dt { color: #94a3b8; } dd { margin: 0; color: #f1f5f9; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; list-style: none; margin: 0; }
  .chips li { font-size: 13px; padding: 4px 12px; border-radius: 99px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); }
  .photos { display: flex; gap: 8px; overflow-x: auto; }
  .photos img { height: 160px; border-radius: 12px; }
  .btns { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 11px 18px; border-radius: 99px; font-weight: 700; text-decoration: none; background: #10b981; color: #04120c; }
  .btn.alt { background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.15); }
  ul.list { padding-left: 18px; columns: 2; column-gap: 24px; }
  ul.list li { break-inside: avoid; margin-bottom: 4px; }
  @media (max-width: 560px) { ul.list { columns: 1; } dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
  footer { margin-top: 40px; font-size: 13px; color: #64748b; }
</style>
</head>
<body>
<main>
<a class="top" href="/"><img src="/icons/icon-192.png" alt="" width="36" height="36" />NewHal · Mersin Hal Kompleksi Rehberi</a>
${body}
<footer><a href="/">Ana sayfa</a> · <a href="/isletmeler">Tüm işletmeler</a> · <a href="/ilanlar">İlanlar</a> · <a href="/urunler">Ürünler</a> · <a href="/hakkimizda">Hakkımızda</a> · <a href="/iletisim">İletişim</a> · <a href="/kullanim-sartlari">Kullanım Şartları</a> · <a href="/gizlilik">Gizlilik</a></footer>
</main>
</body>
</html>`;
}

module.exports = function registerSeo(app, { db, getClaims, siteUrl }) {
  const site = siteUrl.replace(/\/$/, '');
  const organization = {
    '@type': 'Organization', name: 'NewHal', url: site + '/',
    logo: site + '/icons/icon-512.png', sameAs: ['https://www.facebook.com/halkompleksi33'],
  };

  const categoryIcons = async () => {
    const cats = await db.getCategories();
    return Object.fromEntries(cats.map(c => [c.name, c.icon || '📦']));
  };

  // ── İşletme sayfası ──
  app.get('/isletme/:key', async (req, res, next) => {
    const id = parseInt(req.params.key, 10);
    if (!id) return next();
    const pin = await db.getPin(id);
    if (!pin || pin.status !== 'approved') return next();
    if (req.params.key !== pinPath(pin).split('/').pop()) return res.redirect(301, pinPath(pin));

    const [claims, icons, all] = await Promise.all([getClaims(), categoryIcons(), db.getApprovedPins()]);
    const verified = !!claims.verified[pin.id];
    const sells = pin.sells || [], seeks = pin.seeks || [], images = pin.images || [];
    const icon = icons[pin.category] || '🏪';

    const title = `${pin.title} · ${pin.category} | Mersin Hal Kompleksi | NewHal`;
    const description = [
      `${pin.title}: NewHal Mersin Hal Kompleksi rehberinde kayıtlı ${pin.category.toLocaleLowerCase('tr-TR')}.`,
      pin.address ? `Adres: ${pin.address}.` : '',
      sells.length ? `Satılan ürünler: ${sells.slice(0, 8).join(', ')}.` : '',
      pin.phone ? 'Telefon ve konum bilgisi NewHal haritasında.' : 'Konum bilgisi NewHal haritasında.',
    ].filter(Boolean).join(' ');
    const shortDesc = description.length > 160 ? description.slice(0, 157).replace(/\s+\S*$/, '') + '…' : description;

    const business = {
      '@context': 'https://schema.org', '@type': 'LocalBusiness',
      '@id': site + pinPath(pin), name: pin.title, url: site + pinPath(pin),
      address: { '@type': 'PostalAddress', streetAddress: pin.address || '', addressCountry: 'TR' },
      geo: { '@type': 'GeoCoordinates', latitude: pin.lat, longitude: pin.lng },
      ...(pin.phone ? { telephone: pin.phone } : {}),
      ...(images[0] ? { image: images } : {}),
      ...(pin.website ? { sameAs: [/^https?:\/\//.test(pin.website) ? pin.website : 'https://' + pin.website] } : {}),
      ...(sells.length ? { makesOffer: sells.slice(0, 20).map(p => ({ '@type': 'Offer', itemOffered: { '@type': 'Product', name: p } })) } : {}),
    };
    const crumbs = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'NewHal', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: 'İşletmeler', item: site + '/isletmeler' },
        { '@type': 'ListItem', position: 3, name: pin.title, item: site + pinPath(pin) },
      ],
    };

    const others = all.filter(p => p.id !== pin.id && p.category === pin.category).slice(0, 12);
    const website = pin.website ? (/^https?:\/\//.test(pin.website) ? pin.website : 'https://' + pin.website) : '';
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › <a href="/isletmeler">İşletmeler</a> › ${esc(pin.title)}</nav>
<h1>${esc(icon)} ${esc(pin.title)}${verified ? '<span class="badge" title="Sahibi onaylı">✓</span>' : ''}</h1>
<a class="cat" href="${catPath(pin.category)}">${esc(pin.category)}</a>
<dl>
  ${pin.address ? `<dt>Adres</dt><dd>${esc(pin.address)}</dd>` : ''}
  ${pin.phone ? `<dt>Telefon</dt><dd><a href="tel:${esc(pin.phone.replace(/[^\d+]/g, ''))}">${esc(pin.phone)}</a></dd>` : ''}
  ${website ? `<dt>Web sitesi</dt><dd><a href="${esc(website)}" rel="nofollow noopener" target="_blank">${esc(pin.website)}</a></dd>` : ''}
</dl>
<div class="btns">
  <a class="btn" href="/?isletme=${pin.id}">🗺️ Haritada gör</a>
  ${pin.phone ? `<a class="btn alt" href="tel:${esc(pin.phone.replace(/[^\d+]/g, ''))}">📞 Ara</a>` : ''}
  <a class="btn alt" href="https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}" target="_blank" rel="noopener">🧭 Yol tarifi</a>
</div>
${images.length ? `<div class="photos">${images.map(u => `<img src="${esc(u)}" alt="${esc(pin.title)}" loading="lazy" />`).join('')}</div>` : ''}
${sells.length ? `<h2>🛒 Sattığı ürünler</h2><ul class="chips">${sells.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
${seeks.length ? `<h2>🔎 Aradığı ürünler</h2><ul class="chips">${seeks.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
${others.length ? `<h2>Diğer ${esc(pin.category)} işletmeleri</h2><ul class="list">${others.map(p => `<li><a href="${pinPath(p)}">${esc(p.title)}</a></li>`).join('')}</ul>` : ''}
<h2>${esc(pin.title)} hakkında</h2>
<p>${esc(pin.title)}, Mersin Hal Kompleksi çevresinde hizmet veren bir ${esc(pin.category.toLocaleLowerCase('tr-TR'))} işletmesidir${pin.address ? ` ve ${esc(pin.address)} adresinde bulunur` : ''}.
${sells.length ? `İşletmenin sattığı ürünler arasında ${esc(sells.slice(0, 6).join(', '))}${sells.length > 6 ? ' ve daha fazlası' : ''} yer alır.` : ''}
${seeks.length ? `Alım yaptığı ürünler: ${esc(seeks.slice(0, 6).join(', '))}.` : ''}
${pin.phone ? 'Fiyat ve stok bilgisi için işletmeyi doğrudan telefonla arayabilirsiniz.' : 'İletişim için haritadaki işletme kartını kullanabilirsiniz.'}
Haritada yerini görüp yol tarifi alabilir, NewHal üzerinden işletmeyi takip ederek yeni ilanlarından haberdar olabilirsiniz.</p>
${others.length ? `<p>Mersin Hal Kompleksi'nde ${others.length > 11 ? '12\'den fazla' : others.length} başka ${esc(pin.category.toLocaleLowerCase('tr-TR'))} işletmesi daha var. Fiyat karşılaştırmak için aşağıdaki listeye göz atabilirsiniz.</p>` : ''}
<p>Bu bilgiler NewHal kullanıcıları tarafından eklenmiştir. Dükkan sizinse haritada açıp <b>"Bu dükkan benim"</b> diyerek bilgilerinizi kendiniz güncelleyebilirsiniz.</p>`;

    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, path: pinPath(pin), image: images[0], description: shortDesc, jsonLd: [business, crumbs], body }));
  });

  // ── Tüm işletmeler ──
  app.get('/isletmeler', async (req, res) => {
    const [pins, icons] = await Promise.all([db.getApprovedPins(), categoryIcons()]);
    const groups = {};
    pins.forEach(p => (groups[p.category] = groups[p.category] || []).push(p));
    const names = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    names.forEach(n => groups[n].sort((a, b) => a.title.localeCompare(b.title, 'tr')));

    const title = `Mersin Hal Kompleksi İşletmeleri (${pins.length}) | NewHal`;
    const description = `Mersin Hal Kompleksi'ndeki ${pins.length} işletmenin listesi: ${names.slice(0, 3).join(', ')} ve diğerleri. Adres, telefon ve ürün bilgileri.`;
    const list = {
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'Mersin Hal Kompleksi İşletmeleri',
      itemListElement: pins.slice(0, 200).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: site + pinPath(p), name: p.title })),
    };
    const topCats = names.slice(0, 4).map(n => `${groups[n].length} ${n.toLocaleLowerCase('tr-TR')}`);
    const prods = buildProducts(pins, await db.getAds()).filter(x => x.group && x.group !== x.term).slice(0, 8).map(x => lowerTr(x.name));
    const qa = faq([
      ['Mersin Hal Kompleksi nerede?', `${HAL_PLACE}, Mersin'in ${HAL_AREA} bulunur. NewHal haritasında halin içindeki ve çevresindeki her işletmenin yeri tek tek işaretlidir; işletme sayfasından yol tarifi alabilirsiniz.`],
      ['Mersin Hal Kompleksi’nde kaç işletme var?', `NewHal rehberinde şu an ${pins.length} işletme kayıtlı. En kalabalık gruplar: ${joinTr(topCats)} işletmesi. Liste, yeni işletmeler eklendikçe güncellenir.`],
      prods.length ? ['Mersin Hal’de hangi ürünler alınıp satılıyor?', `Sebze ve meyve ağırlıklı toptan alım satım yapılır. NewHal ilanlarında en sık geçen ürünler ${joinTr(prods)}. Ürün sayfalarında o ürünü satan işletmeleri ve güncel ilanları görebilirsiniz.`] : null,
      ['İşletmemi NewHal’e nasıl eklerim?', 'NewHal ana sayfasında haritada işletmenizin yerine dokunup bilgilerinizi girmeniz yeterli. Kayıt ücretsizdir; yönetici onayından sonra işletmeniz haritada ve rehberde görünür. İşletme zaten ekliyse "Bu dükkan benim" diyerek bilgilerinizi kendiniz güncelleyebilirsiniz.'],
      ['NewHal’de ilan vermek ücretli mi?', 'Hayır. Alım ve satım ilanı vermek ücretsizdir. İlanlar NewHal ana sayfasında, ilanlar listesinde ve ilgili ürün sayfalarında yayınlanır.'],
    ].filter(Boolean));
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › İşletmeler</nav>
<h1>Mersin Hal Kompleksi İşletmeleri</h1>
<p>${HAL_PLACE}, Mersin'in ${HAL_AREA} yer alan toptan sebze ve meyve pazarıdır. NewHal bu haldeki ve çevresindeki ${pins.length} işletmeyi tek bir rehberde toplar: komisyoncular, tüccarlar, manavlar, marketler, nakliyeciler ve hal esnafına hizmet veren işletmeler. Her işletmenin adresi, telefonu, sattığı ürünler ve haritadaki yeri kendi sayfasındadır.</p>
<div class="btns"><a class="btn" href="/">🗺️ Haritada keşfet</a></div>
${names.map(n => `<h2>${esc(icons[n] || '📦')} ${groups[n].length >= MIN_CATEGORY_PINS ? `<a href="${catPath(n)}">${esc(n)}</a>` : esc(n)} (${groups[n].length})</h2>
<ul class="list">${groups[n].map(p => `<li><a href="${pinPath(p)}">${esc(p.title)}</a></li>`).join('')}</ul>`).join('\n')}
${qa.html}`;

    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: '/isletmeler', jsonLd: [{ '@context': 'https://schema.org', ...organization }, list, qa.jsonLd].filter(Boolean), body }));
  });

  // ── İlan sayfası ──
  app.get('/ilan/:key', async (req, res, next) => {
    const no = parseInt(req.params.key, 10);
    if (!no) return next();
    const ads = await db.getAds();
    const ad = ads.find(a => a.no === no);
    if (!isPublicAd(ad)) return next();
    if (req.params.key !== adPath(ad).split('/').pop()) return res.redirect(301, adPath(ad));

    const text = adText(ad);
    const pin = ad.pinId ? await db.getPin(ad.pinId).catch(() => null) : null;
    const shop = pin && pin.status === 'approved' ? pin : null;
    const images = ad.images || [];
    const title = `#${ad.no} ${text.slice(0, 65)}${shop ? ` · ${shop.title}` : ''} | Mersin Hal İlanları | NewHal`;
    const clean = stripPhones(ad.body && ad.body !== ad.title ? `${ad.title || ''} ${ad.body}` : text);
    const description = `${clean.slice(0, 170)}${clean.length > 170 ? '…' : /[.!?]$/.test(clean) ? '' : '.'}${shop && !clean.includes(shop.title) ? ` ${shop.title}.` : ''} Mersin Hal Kompleksi ücretsiz alım satım ilanı, NewHal.`.slice(0, 300);
    const posted = ad.updated_at || ad.created_at;
    const comments = (ad.comments || []).filter(c => c && c.message);
    const related = ads.filter(a => a !== ad && isPublicAd(a))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
    const crumbs = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'NewHal', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: 'İlanlar', item: site + '/ilanlar' },
        { '@type': 'ListItem', position: 3, name: `#${ad.no} ${text.slice(0, 60)}`, item: site + adPath(ad) },
      ],
    };
    const youtube = ad.video && ad.video.type === 'youtube' ? ad.video.id : '';
    const videoFile = ad.video && ad.video.type === 'file' ? ad.video.url : '';
    const image = images[0] || (youtube ? `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg` : site + '/img/ilan-logo.jpg');
    const tel = shop && shop.phone ? shop.phone.replace(/[^\d+]/g, '') : '';
    const adProducts = buildProducts(await db.getApprovedPins(), ads).filter(pr => pr.ads.includes(ad)).slice(0, 8);

    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › <a href="/ilanlar">İlanlar</a> › #${ad.no}</nav>
<h1>${esc(text.slice(0, 140))}</h1>
<p class="meta">İlan #${ad.no}${posted ? ` · ${esc(trDate(posted))}` : ''}${shop ? ` · <a href="${pinPath(shop)}">${esc(shop.title)}</a>` : ''}${ad.owner_name && !shop ? ` · ${esc(ad.owner_name)}` : ''}</p>
${ad.body && ad.body !== ad.title ? `<p class="ad-body">${esc(ad.body)}</p>` : ''}
${images.length ? `<div class="photos">${images.map((u, i) => `<img src="${esc(u)}" alt="${esc(text.slice(0, 80))}${i ? ` ${i + 1}` : ''}" loading="lazy" />`).join('')}</div>` : ''}
${videoFile ? `<video src="${esc(videoFile)}" controls preload="none" playsinline></video>` : ''}
${youtube ? `<p><a href="https://www.youtube.com/watch?v=${esc(youtube)}" target="_blank" rel="noopener">▶️ Videoyu YouTube'da izle</a></p>` : ''}
<div class="btns">
  <a class="btn" href="/?ilan=${encodeURIComponent(ad.id)}">💬 NewHal'da aç, beğen ve yorum yaz</a>
  ${tel ? `<a class="btn alt" href="tel:${esc(tel)}">📞 Ara</a>` : ''}
  ${shop ? `<a class="btn alt" href="${pinPath(shop)}">🏪 İşletmeyi gör</a>` : ''}
</div>
${comments.length ? `<h2>💬 Yorumlar (${comments.length})</h2>${comments.slice(0, 30).map(c => `<div class="comment"><b>${esc(c.name || 'Üye')}</b><br>${esc(c.message)}</div>`).join('')}` : ''}
${adProducts.length ? `<h2>İlgili ürünler</h2><ul class="chips">${adProducts.map(pr => `<li><a href="${productPath(pr.term)}">${esc(pr.name)}</a></li>`).join('')}</ul>` : ''}
${related.length ? `<h2>Diğer güncel ilanlar</h2><ul class="list">${related.map(a => `<li><a href="${adPath(a)}">#${a.no} ${esc(adText(a).slice(0, 60))}</a></li>`).join('')}</ul>` : ''}
<p><a href="/ilanlar">Tüm ilanlar</a> · İlan vermek ücretsizdir.</p>`;

    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: adPath(ad), image, jsonLd: [crumbs], body }));
  });

  // ── Tüm ilanlar ──
  app.get('/ilanlar', async (req, res) => {
    const ads = (await db.getAds()).filter(isPublicAd)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const title = `Mersin Hal İlanları (${ads.length}) · Ücretsiz Alım Satım | NewHal`;
    const description = `Mersin Hal Kompleksi'nden ${ads.length} güncel alım satım ilanı: sebze, meyve, nakliye, soğuk hava deposu ve daha fazlası. İlan vermek ücretsiz.`;
    const list = {
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'Mersin Hal İlanları',
      itemListElement: ads.slice(0, 200).map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: site + adPath(a), name: adText(a).slice(0, 100) })),
    };
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › İlanlar</nav>
<h1>Mersin Hal İlanları</h1>
<p>Mersin Hal Kompleksi'nden en yeni ${ads.length} alım satım ilanı. İlana tıklayarak ayrıntısını, fotoğraflarını ve yorumlarını görebilirsiniz.</p>
<div class="btns"><a class="btn" href="/">📢 Ücretsiz ilan ver</a></div>
<ul class="list">${ads.map(a => `<li><a href="${adPath(a)}">#${a.no} ${esc(adText(a).slice(0, 70))}</a> <span class="meta">${esc(trDate(a.created_at))}</span></li>`).join('')}</ul>`;
    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: '/ilanlar', jsonLd: [list], body }));
  });

  // ── Kategori sayfası ──
  app.get('/kategori/:slug', async (req, res, next) => {
    const [pins, ads, icons] = await Promise.all([db.getApprovedPins(), db.getAds(), categoryIcons()]);
    const name = [...new Set(pins.map(p => p.category))].find(c => slugify(c) === req.params.slug);
    if (!name) return next();
    const list = pins.filter(p => p.category === name).sort((a, b) => a.title.localeCompare(b.title, 'tr'));
    if (list.length < MIN_CATEGORY_PINS) return next();
    const lower = name.toLocaleLowerCase('tr-TR');
    const products = buildProducts(pins, ads).filter(pr => pr.sellers.some(p => p.category === name)).slice(0, 20);
    const sellsTop = {};
    list.forEach(p => (p.sells || []).forEach(x => { const k = lowerTr(x).trim(); sellsTop[k] = (sellsTop[k] || 0) + 1; }));
    const topSells = Object.entries(sellsTop).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const phoneCount = list.filter(p => p.phone).length;
    const catQa = faq([
      [`Mersin Hal’de kaç ${lower} var?`, `NewHal rehberinde Mersin Hal Kompleksi ve çevresinde ${list.length} ${lower} işletmesi kayıtlı${phoneCount ? `; bunların ${phoneCount} tanesinin telefon numarası sayfasında yazıyor` : ''}.`],
      topSells.length ? [`Mersin Hal’deki ${lower} işletmeleri ne satıyor?`, `Bu kategorideki işletmelerin en sık belirttiği ürün ve hizmetler: ${joinTr(topSells)}. Her işletmenin tam ürün listesi kendi sayfasındadır.`] : null,
      [`Bir ${lower} işletmesine nasıl ulaşırım?`, 'Listeden işletmeye tıklayın. Sayfada telefon numarası varsa tek dokunuşla arayabilir, haritada yerini görüp yol tarifi alabilirsiniz. NewHal üyeleri işletmeye mesaj da gönderebilir.'],
    ].filter(Boolean));
    const title = `Mersin Hal ${name} İşletmeleri (${list.length}) | NewHal`;
    const description = `Mersin Hal Kompleksi'ndeki ${list.length} ${lower} işletmesi: adres, telefon ve ürünler. Haritada yerini bulun, doğrudan arayın.`;
    const itemList = {
      '@context': 'https://schema.org', '@type': 'ItemList', name: `Mersin Hal ${name} İşletmeleri`,
      itemListElement: list.slice(0, 200).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: site + pinPath(p), name: p.title })),
    };
    const crumbs = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'NewHal', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: 'İşletmeler', item: site + '/isletmeler' },
        { '@type': 'ListItem', position: 3, name, item: site + catPath(name) },
      ],
    };
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › <a href="/isletmeler">İşletmeler</a> › ${esc(name)}</nav>
<h1>${esc(icons[name] || '📦')} Mersin Hal ${esc(name)} İşletmeleri</h1>
<p>Mersin Hal Kompleksi ve çevresinde ${list.length} ${esc(lower)} işletmesi NewHal rehberinde kayıtlı.
${phoneCount ? `Bunların ${phoneCount} tanesinin telefon numarası sayfasında yazıyor, doğrudan arayabilirsiniz.` : ''}
${topSells.length ? `Bu işletmelerin en çok sattığı ürün ve hizmetler: ${esc(topSells.join(', '))}.` : ''}
Bir işletmeye tıklayarak adresini, ürünlerini ve haritadaki yerini görebilirsiniz.</p>
<div class="btns"><a class="btn" href="/">🗺️ Haritada gör</a><a class="btn alt" href="/ilanlar">📢 Güncel ilanlar</a></div>
${products.length ? `<h2>Ürün ve hizmetler</h2><ul class="chips">${products.map(pr => `<li><a href="${productPath(pr.term)}">${esc(pr.name)}</a></li>`).join('')}</ul>` : ''}
<h2>Tüm ${esc(name)} işletmeleri (${list.length})</h2>
<ul class="list">${list.map(p => `<li><a href="${pinPath(p)}">${esc(p.title)}</a>${(p.sells || []).length ? ` <span class="meta">${esc(p.sells.slice(0, 3).join(', '))}</span>` : ''}</li>`).join('')}</ul>
<p>İşletmeniz listede yok mu? Haritaya ücretsiz ekleyebilirsiniz. <a href="/">NewHal'ı açın</a>.</p>
${catQa.html}`;
    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: catPath(name), jsonLd: [itemList, crumbs, catQa.jsonLd].filter(Boolean), body }));
  });

  // ── Ürün / hizmet sayfası ──
  app.get('/urun/:slug', async (req, res, next) => {
    const [pins, ads] = await Promise.all([db.getApprovedPins(), db.getAds()]);
    const pr = buildProducts(pins, ads).find(x => slugify(x.term) === req.params.slug);
    if (!pr) return next();
    const recent = [...pr.ads].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const isProduce = !!pr.group;
    const isGroup = pr.group === pr.term;
    const h1 = isGroup ? `Mersin Hal ${pr.name} Toptancıları ve Komisyoncuları`
      : isProduce ? `Mersin Hal ${pr.name} Toptan Alım Satım` : `Mersin Hal ${pr.name}`;
    const title = isGroup
      ? `Mersin Hal ${pr.name} Toptancıları (${pr.sellers.length}) | NewHal`
      : isProduce
      ? `Mersin Hal ${pr.name} Toptan: İlanlar ve Satıcılar | NewHal`
      : `Mersin Hal ${pr.name}: ${pr.sellers.length} İşletme | NewHal`;
    const parts = [];
    if (pr.sellers.length) parts.push(`${pr.sellers.length} işletme`);
    if (recent.length) parts.push(`${recent.length} ilan`);
    const description = `Mersin Hal Kompleksi'nde ${lowerTr(pr.name)} ${isProduce ? 'alım satımı' : 'hizmeti'}: ${parts.join(' ve ')}. Telefon, adres ve güncel ilanlar NewHal'da.`;
    const allSellers = [...pr.sellers, ...pr.groupSellers];
    const crumbs = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'NewHal', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: 'Ürünler', item: site + '/urunler' },
        { '@type': 'ListItem', position: 3, name: pr.name, item: site + productPath(pr.term) },
      ],
    };
    const others = buildProducts(pins, ads).filter(x => x.term !== pr.term && x.group === pr.group).slice(0, 16);
    const low = lowerTr(pr.name);
    const prodQa = faq(isProduce ? [
      [`Mersin Hal’de ${low} nereden alınır?`, `${HAL_PLACE}'ndeki komisyoncu ve tüccarlardan toptan ${low} alınabilir. NewHal'da ${allSellers.length ? `${allSellers.length} işletme ${pr.sellers.length ? low : pr.group} satıyor` : 'satıcı işletmeler listelenir'}${recent.length ? ` ve ${recent.length} ilanda ${low} geçiyor` : ''}. İlan sahibini ya da işletmeyi doğrudan arayabilirsiniz.`],
      [`Mersin Hal ${low} fiyatı ne kadar?`, `Hal fiyatları gün içinde ve kaliteye göre değiştiği için NewHal sabit fiyat yayınlamaz. Güncel fiyat için bu sayfadaki ${recent.length ? `en yeni ilanlara${recent[0] ? ` (son ilan ${trDate(recent[0].created_at)})` : ''}` : 'işletmelere'} bakıp satıcıyı aramanız en doğru yoldur.`],
      [`Mersin Hal’de ${low} satmak istiyorum, ne yapmalıyım?`, 'NewHal ana sayfasından ücretsiz satış ilanı verebilirsiniz. İlanınız ilanlar listesinde ve bu ürün sayfasında görünür; komisyoncu ve tüccarlar sizi doğrudan arar.'],
    ] : [
      [`Mersin Hal’de ${low} hizmeti veren kaç işletme var?`, `NewHal rehberinde ${pr.sellers.length} işletme ${low} hizmeti verdiğini belirtiyor. Adres ve telefonları bu sayfadaki listede.`],
      [`${pr.name} için hangi işletmeyi aramalıyım?`, 'Listeden işletmeye tıklayıp sattığı ürünlere, adresine ve haritadaki yerine bakın. Telefonu olan işletmeleri sayfadan tek dokunuşla arayabilirsiniz.'],
    ]);
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › <a href="/urunler">Ürünler</a> › ${esc(pr.name)}</nav>
<h1>${esc(h1)}</h1>
<p>${isProduce
    ? `Mersin Hal Kompleksi'nde ${esc(lowerTr(pr.name))} alıp satmak isteyenler için güncel ilanlar ve ${esc(pr.group)} satan işletmeler bu sayfada.
${recent.length ? `NewHal'da ${esc(lowerTr(pr.name))} geçen ${recent.length} ilan var${recent[0] ? `, en yenisi ${esc(trDate(recent[0].created_at))} tarihli` : ''}.` : ''}
Fiyat ve stok bilgisi gün içinde değiştiği için ilan sahibini ya da işletmeyi doğrudan aramanızı öneririz.`
    : `Mersin Hal Kompleksi ve çevresinde ${esc(lowerTr(pr.name))} hizmeti veren ${pr.sellers.length} işletme NewHal rehberinde kayıtlı.
Adres, telefon ve haritadaki yerlerini aşağıda bulabilirsiniz.`}</p>
<div class="btns"><a class="btn" href="/">📢 Ücretsiz ilan ver</a><a class="btn alt" href="/">🗺️ Haritada keşfet</a></div>
${recent.length ? `<h2>📢 ${esc(pr.name)} ilanları (${recent.length})</h2><ul class="list">${recent.slice(0, 40).map(a => `<li><a href="${adPath(a)}">#${a.no} ${esc(adText(a).slice(0, 70))}</a> <span class="meta">${esc(trDate(a.created_at))}</span></li>`).join('')}</ul>` : ''}
${pr.sellers.length ? `<h2>🏪 ${esc(pr.name)} satan işletmeler (${pr.sellers.length})</h2><ul class="list">${pr.sellers.map(p => `<li><a href="${pinPath(p)}">${esc(p.title)}</a> <span class="meta"><a href="${catPath(p.category)}">${esc(p.category)}</a></span></li>`).join('')}</ul>` : ''}
${pr.groupSellers.length ? `<h2>🥬 ${esc(titleTr(pr.group))} satan komisyoncu ve tüccarlar (${pr.groupSellers.length})</h2><ul class="list">${pr.groupSellers.slice(0, 40).map(p => `<li><a href="${pinPath(p)}">${esc(p.title)}</a></li>`).join('')}</ul>` : ''}
${others.length ? `<h2>Diğer ${isProduce ? esc(pr.group) : 'hizmet'} sayfaları</h2><ul class="chips">${others.map(x => `<li><a href="${productPath(x.term)}">${esc(x.name)}</a></li>`).join('')}</ul>` : ''}
${prodQa.html}
<p><a href="/urunler">Tüm ürün ve hizmetler</a></p>`;
    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: productPath(pr.term), jsonLd: [crumbs, prodQa.jsonLd].filter(Boolean), body }));
  });

  // ── Tüm ürün ve hizmetler ──
  app.get('/urunler', async (req, res) => {
    const [pins, ads] = await Promise.all([db.getApprovedPins(), db.getAds()]);
    const all = buildProducts(pins, ads);
    const groups = [['🍅 Sebze', all.filter(x => x.group === 'sebze')], ['🍊 Meyve', all.filter(x => x.group === 'meyve')], ['🛠️ Hizmet ve diğer ürünler', all.filter(x => !x.group)]];
    const title = 'Mersin Hal Ürünleri ve Hizmetleri | NewHal';
    const description = `Mersin Hal Kompleksi'nde ${all.length} ürün ve hizmet: sebze, meyve, nakliye, ambalaj, oto servis. Satıcılar ve güncel ilanlar NewHal'da.`;
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › Ürünler</nav>
<h1>Mersin Hal Ürünleri ve Hizmetleri</h1>
<p>Mersin Hal Kompleksi'nde alınıp satılan ürünler ve verilen hizmetler. Bir ürüne tıklayarak o ürünü satan işletmeleri ve güncel ilanları görebilirsiniz.</p>
${groups.filter(g => g[1].length).map(([h, list]) => `<h2>${h}</h2><ul class="chips">${list.map(x => `<li><a href="${productPath(x.term)}">${esc(x.name)}</a> <span class="meta">${x.ads.length + x.sellers.length}</span></li>`).join('')}</ul>`).join('\n')}`;
    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: '/urunler', jsonLd: [{ '@context': 'https://schema.org', ...organization }], body }));
  });

  // ── Site haritası ──
  let sitemapCache = { at: 0, xml: '' };
  app.get('/sitemap.xml', async (req, res) => {
    if (Date.now() - sitemapCache.at > SITEMAP_CACHE_MS) {
      const [pins, ads] = await Promise.all([db.getApprovedPins(), db.getAds()]);
      const day = iso => (iso ? String(iso).slice(0, 10) : '');
      const urls = [
        { loc: '/', freq: 'daily', pri: '1.0' },
        { loc: '/isletmeler', freq: 'daily', pri: '0.9' },
        { loc: '/ilanlar', freq: 'daily', pri: '0.8' },
        { loc: '/urunler', freq: 'daily', pri: '0.8' },
        ...Object.entries(pins.reduce((m, p) => ({ ...m, [p.category]: (m[p.category] || 0) + 1 }), {}))
          .filter(([, n]) => n >= MIN_CATEGORY_PINS).map(([c]) => ({ loc: catPath(c), freq: 'daily', pri: '0.8' })),
        ...buildProducts(pins, ads).map(pr => ({ loc: productPath(pr.term), freq: 'daily', pri: '0.7' })),
        ...pins.map(p => ({ loc: pinPath(p), freq: 'weekly', pri: '0.8', mod: day(p.reviewed_at || p.created_at) })),
        ...ads.filter(isPublicAd)
          .map(a => ({ loc: adPath(a), freq: 'weekly', pri: '0.6', mod: day(a.updated_at || a.created_at) })),
        { loc: '/hakkimizda', freq: 'monthly', pri: '0.4' },
        { loc: '/iletisim', freq: 'monthly', pri: '0.4' },
        { loc: '/kullanim-sartlari', freq: 'yearly', pri: '0.2' },
        { loc: '/gizlilik', freq: 'yearly', pri: '0.2' },
      ];
      sitemapCache = {
        at: Date.now(),
        xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u =>
          `<url><loc>${esc(site + u.loc)}</loc>${u.mod ? `<lastmod>${u.mod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`,
      };
    }
    res.type('application/xml').set('Cache-Control', 'public, max-age=600').send(sitemapCache.xml);
  });

  app.get('/llms.txt', async (req, res) => {
    const [pins, ads] = await Promise.all([db.getApprovedPins(), db.getAds()]);
    const live = ads.filter(isPublicAd).length;
    const cats = Object.entries(pins.reduce((m, p) => ({ ...m, [p.category]: (m[p.category] || 0) + 1 }), {}))
      .filter(([, n]) => n >= MIN_CATEGORY_PINS).sort((a, b) => b[1] - a[1]);
    const prods = buildProducts(pins, ads).slice(0, 30);
    res.type('text/markdown; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(`# NewHal

> Mersin Hal Kompleksi'ndeki ${pins.length} komisyoncu, tüccar, müstahsil, manav, market ve nakliyeciyi haritada gösteren ücretsiz işletme rehberi ve alım satım ilanı sitesi. Türkçe.

## Ana sayfalar

- [Harita ve ana sayfa](${site}/): İşletmeleri haritada bulma, ilan verme, takip ve mesaj
- [Tüm işletmeler](${site}/isletmeler): Kategoriye göre ${pins.length} işletme; her birinin adres, telefon ve ürün sayfası
- [İlanlar](${site}/ilanlar): ${live} güncel alım satım ilanı
- [Ürünler ve hizmetler](${site}/urunler): Ürün başına satıcılar ve ilanlar
- [Hakkımızda](${site}/hakkimizda)
- [İletişim](${site}/iletisim)

## Kategoriler

${cats.map(([c, n]) => `- [${c}](${site}${catPath(c)}): ${n} işletme`).join('\n')}

## Ürünler ve hizmetler

${prods.map(x => `- [${x.name}](${site}${productPath(x.term)}): ${x.sellers.length + x.groupSellers.length} işletme, ${x.ads.length} ilan`).join('\n')}

## Konum

- ${HAL_PLACE}, ${HAL_AREA.replace('ilçesinde', 'ilçesi')}, Türkiye
`);
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /auth/\n\nSitemap: ${site}/sitemap.xml\n`);
  });

  return { pinPath, adPath, isPublicAd, organization };
};

module.exports.adPath = adPath;
module.exports.isPublicAd = isPublicAd;
module.exports.stripPhones = stripPhones;
