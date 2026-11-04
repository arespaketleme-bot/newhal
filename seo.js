/* ═══════════════════════════════════════════════════════════════
   NewHal — arama motoru sayfaları
   /isletme/:id-ad   her işletmenin sunucuda hazırlanan sayfası
   /isletmeler       tüm işletmeler, kategoriye göre
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
  .top img { width: 36px; height: 36px; border-radius: 10px; }
  nav.crumbs { font-size: 13px; color: #94a3b8; margin-bottom: 10px; }
  nav.crumbs a { color: #94a3b8; }
  h1 { color: #fff; font-size: 28px; line-height: 1.2; margin: 0 0 6px; }
  h2 { color: #fff; font-size: 19px; margin: 28px 0 10px; }
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
<a class="top" href="/"><img src="/icons/icon-192.png" alt="" />NewHal · Mersin Hal Kompleksi Rehberi</a>
${body}
<footer><a href="/">Ana sayfa</a> · <a href="/isletmeler">Tüm işletmeler</a> · <a href="/gizlilik">Gizlilik</a></footer>
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
    ].filter(Boolean).join(' ').slice(0, 300);

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
<span class="cat">${esc(pin.category)}</span>
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
<p>Bu bilgiler NewHal kullanıcıları tarafından eklenmiştir. Dükkan sizinse haritada açıp <b>"Bu dükkan benim"</b> diyerek bilgilerinizi kendiniz güncelleyebilirsiniz.</p>`;

    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: pinPath(pin), image: images[0], jsonLd: [business, crumbs], body }));
  });

  // ── Tüm işletmeler ──
  app.get('/isletmeler', async (req, res) => {
    const [pins, icons] = await Promise.all([db.getApprovedPins(), categoryIcons()]);
    const groups = {};
    pins.forEach(p => (groups[p.category] = groups[p.category] || []).push(p));
    const names = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    names.forEach(n => groups[n].sort((a, b) => a.title.localeCompare(b.title, 'tr')));

    const title = `Mersin Hal Kompleksi İşletmeleri (${pins.length}) | NewHal`;
    const description = `Mersin Hal Kompleksi'ndeki ${pins.length} işletmenin listesi: ${names.slice(0, 5).join(', ')}. Adres, telefon ve ürün bilgileri NewHal haritasında.`;
    const list = {
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'Mersin Hal Kompleksi İşletmeleri',
      itemListElement: pins.slice(0, 200).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: site + pinPath(p), name: p.title })),
    };
    const body = `
<nav class="crumbs"><a href="/">NewHal</a> › İşletmeler</nav>
<h1>Mersin Hal Kompleksi İşletmeleri</h1>
<p>Haldeki ${pins.length} işletmenin tamamı. Bir işletmeye tıklayarak adres, telefon ve ürünlerini görebilir, haritada yerini bulabilirsiniz.</p>
<div class="btns"><a class="btn" href="/">🗺️ Haritada keşfet</a></div>
${names.map(n => `<h2>${esc(icons[n] || '📦')} ${esc(n)} (${groups[n].length})</h2>
<ul class="list">${groups[n].map(p => `<li><a href="${pinPath(p)}">${esc(p.title)}</a></li>`).join('')}</ul>`).join('\n')}`;

    res.set('Cache-Control', 'public, max-age=300').type('html')
      .send(layout({ site, title, description, path: '/isletmeler', jsonLd: [{ '@context': 'https://schema.org', ...organization }, list], body }));
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
        ...pins.map(p => ({ loc: pinPath(p), freq: 'weekly', pri: '0.8', mod: day(p.reviewed_at || p.created_at) })),
        ...ads.filter(a => a.active !== false && !a.pending)
          .map(a => ({ loc: `/?ilan=${encodeURIComponent(a.id)}`, freq: 'weekly', pri: '0.6', mod: day(a.updated_at || a.created_at) })),
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

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /auth/\n\nSitemap: ${site}/sitemap.xml\n`);
  });

  return { pinPath, organization };
};
