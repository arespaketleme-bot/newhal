// newhal.com/projevitrini: projeleri görüntülenmeye göre büyüyen toplar olarak gösteren vitrin.
// Kaynak proje: ANTIGRAVITY/Projeler/Proje_Vitrini. Sayfalar projevitrini/ klasöründe.
// Veriler (sayaç, başvuru, onay) herkese kapalı depoda tek dosyada tutulur.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const KLASOR = path.join(__dirname, 'projevitrini');
const DOSYA = 'projevitrini.json';
const TEKRAR_SAYMA_MS = 30 * 60 * 1000; // aynı kişi aynı projeyi 30 dk içinde bir kez sayılır
const BASVURU_SINIRI = 5; // bir kişi saatte en fazla 5 başvuru
const RENKLER = ['#ff6b4a', '#4a9dff', '#c86bff', '#2fd08a', '#ffc53d', '#ff4f8b', '#3dd6d0', '#ff9f43', '#8a7dff', '#9be15d'];

module.exports = function projeVitrini(app, { db, webpush, vapidAnahtari }) {
  const router = express.Router();
  const yoneticiSifresi = () => process.env.VITRIN_ADMIN_SIFRE || process.env.ADMIN_PASSWORD || '';

  // ---- Ziyaretçilere tarayıcı bildirimi ----
  // Newhal'in bildirim anahtarları kullanılır; vitrin abonelikleri ayrı dosyada durur.
  const ABONE_DOSYA = 'projevitrini-abonelikler.json';
  const ABONE_SINIRI = 20000;
  let abonelikler = null;
  let aboneYukleniyor = null;
  async function aboneHazirla() {
    if (abonelikler) return abonelikler;
    if (!aboneYukleniyor) {
      aboneYukleniyor = db.getPrivateJson(ABONE_DOSYA)
        .then((v) => (abonelikler = Array.isArray(v) ? v : []))
        .finally(() => { aboneYukleniyor = null; });
    }
    return aboneYukleniyor;
  }
  let aboneZamanlayici = null;
  function aboneKaydet() {
    clearTimeout(aboneZamanlayici);
    aboneZamanlayici = setTimeout(() => {
      db.savePrivateJson(ABONE_DOSYA, abonelikler).catch((e) => console.error('Vitrin abonelikleri kaydedilemedi:', e.message));
    }, 1000);
  }
  function aboneDogrula(s) {
    if (!s || typeof s !== 'object') return null;
    const endpoint = String(s.endpoint || '');
    const keys = s.keys || {};
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return null;
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
    return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
  }
  async function herkeseBildir(icerik) {
    try {
      if (!webpush || !vapidAnahtari || !(await vapidAnahtari())) return;
      const liste = await aboneHazirla();
      const gidecek = liste.slice();
      const olu = new Set();
      for (let i = 0; i < gidecek.length; i += 25) {
        await Promise.all(gidecek.slice(i, i + 25).map(async (s) => {
          try {
            await webpush.sendNotification(s, JSON.stringify(icerik), { TTL: 24 * 3600 });
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) olu.add(s.endpoint);
          }
        }));
      }
      if (olu.size) {
        abonelikler = abonelikler.filter((s) => !olu.has(s.endpoint));
        aboneKaydet();
      }
      console.log(`Vitrin bildirimi: ${gidecek.length - olu.size} kişiye gitti, ${olu.size} eski abonelik silindi.`);
    } catch (e) {
      console.error('Vitrin bildirimi gönderilemedi:', e.message);
    }
  }

  // ---- Durum: depodan bir kez yüklenir, değişince kısa gecikmeyle geri yazılır ----
  let durum = null;
  let yukleniyor = null;
  async function hazirla() {
    if (durum) return durum;
    if (!yukleniyor) {
      yukleniyor = db.getPrivateJson(DOSYA).then((v) => {
        durum = { sayaclar: {}, basvurular: [], onaylananlar: [], gizlenenler: [], duzenlemeler: {}, ...(v || {}) };
        return durum;
      }).finally(() => { yukleniyor = null; });
    }
    return yukleniyor; // depo okunamazsa hata fırlatır; boş sanıp üzerine yazmayız
  }
  let kayitZamanlayici = null;
  function kaydet() {
    clearTimeout(kayitZamanlayici);
    kayitZamanlayici = setTimeout(() => {
      db.savePrivateJson(DOSYA, durum).catch((e) => console.error('Proje vitrini kaydedilemedi:', e.message));
    }, 1500);
  }

  // ---- Telegram bildirimleri ----
  // Bot bilgisi yönetim sayfasından girilir, herkese kapalı depoda ayrı dosyada durur, sayfaya hiç gönderilmez.
  const TG_DOSYA = 'projevitrini-telegram.json';
  const SITE = (process.env.SITE_URL || 'https://newhal.com').replace(/\/$/, '');
  let tg = null; // { token, sohbet, sohbetAdi, botAdi, ziyaret: true, proje: true }
  let tgYuklendi = false;
  async function tgHazirla() {
    if (tgYuklendi) return tg;
    const v = await db.getPrivateJson(TG_DOSYA);
    tg = v && v.token ? v : null;
    if (!tg && process.env.VITRIN_TELEGRAM_TOKEN && process.env.VITRIN_TELEGRAM_SOHBET) {
      tg = { token: process.env.VITRIN_TELEGRAM_TOKEN, sohbet: process.env.VITRIN_TELEGRAM_SOHBET, ziyaret: true, proje: true };
    }
    tgYuklendi = true;
    return tg;
  }
  const tgKacir = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  async function tgCagir(token, yontem, govde) {
    const r = await fetch(`https://api.telegram.org/bot${token}/${yontem}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(govde || {}),
      signal: AbortSignal.timeout(10000),
    });
    const v = await r.json().catch(() => ({}));
    if (!v.ok) throw new Error(v.description || 'Telegram cevap vermedi');
    return v.result;
  }
  // Saatte en fazla 40 mesaj: kalabalık bir günde telefonun susmazsa diye
  let tgSaat = { bas: 0, adet: 0, uyarildi: false };
  async function tgGonder(tur, metin) {
    try {
      const ayar = await tgHazirla();
      if (!ayar || ayar[tur] === false) return;
      const simdi = Date.now();
      if (simdi - tgSaat.bas > 3600e3) tgSaat = { bas: simdi, adet: 0, uyarildi: false };
      if (tgSaat.adet >= 40) {
        if (tgSaat.uyarildi) return;
        tgSaat.uyarildi = true;
        metin = 'Bu saat çok hareketli. Bildirimler bir saatliğine durduruldu.';
      }
      tgSaat.adet++;
      await tgCagir(ayar.token, 'sendMessage', { chat_id: ayar.sohbet, text: metin, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
      console.error('Vitrin Telegram bildirimi gitmedi:', e.message);
    }
  }
  const saat = () => new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });
  function cihaz(ua) {
    ua = String(ua || '');
    const tur = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Telefon' : 'Bilgisayar';
    const sistem = /iPhone|iPad|Mac OS/i.test(ua) ? 'Apple' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : '';
    return sistem ? `${tur} (${sistem})` : tur;
  }
  function nereden(ref) {
    try {
      const h = new URL(ref).hostname.replace(/^www\./, '');
      return h && !/newhal\.com$/.test(h) ? h : '';
    } catch { return ''; }
  }

  const hazirProjeler = () => JSON.parse(fs.readFileSync(path.join(KLASOR, 'projeler.json'), 'utf8'));
  function projeListesi() {
    const gizli = new Set(durum.gizlenenler);
    return [...hazirProjeler(), ...durum.onaylananlar]
      .filter((p) => !gizli.has(p.id))
      .map((p) => ({ ...p, ...(durum.duzenlemeler[p.id] || {}) }))
      .map((p) => ({
        id: p.id, ad: p.ad, aciklama: p.aciklama, etiketler: p.etiketler || [], link: p.link || '#', renk: p.renk,
        goruntulenme: (p.baslangicGoruntulenme || 0) + (durum.sayaclar[p.id] || 0),
      }));
  }

  // ---- Yardımcılar ----
  const istemciIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  function yoneticiMi(req) {
    const dogru = yoneticiSifresi();
    if (!dogru) return false;
    const a = Buffer.from(String(req.headers['x-admin-sifre'] || ''));
    const b = Buffer.from(dogru);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const temizMetin = (v, en) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, en);
  function basvuruDogrula(g) {
    const ad = temizMetin(g.ad, 40);
    const aciklama = temizMetin(g.aciklama, 280);
    const iletisim = temizMetin(g.iletisim, 100);
    let link = temizMetin(g.link, 300);
    const etiketler = (Array.isArray(g.etiketler) ? g.etiketler : String(g.etiketler || '').split(','))
      .map((e) => temizMetin(e, 20)).filter(Boolean).slice(0, 4);
    if (ad.length < 2) return { hata: 'Proje adı en az 2 harf olmalı.' };
    if (aciklama.length < 10) return { hata: 'Açıklama en az 10 harf olmalı.' };
    if (link) {
      if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
      try {
        const u = new URL(link);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0;
        link = u.toString();
      } catch {
        return { hata: 'Link geçerli bir site adresi değil.' };
      }
    }
    const renk = /^#[0-9a-f]{6}$/i.test(g.renk) ? g.renk.toLowerCase() : RENKLER[Math.floor(Math.random() * RENKLER.length)];
    return { veri: { ad, aciklama, etiketler, link: link || '#', renk, iletisim } };
  }
  function kimlikUret(ad) {
    const harf = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
    const kok = ad.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (h) => harf[h])
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'proje';
    return kok + '-' + crypto.randomBytes(3).toString('hex');
  }

  const sonGorulme = new Map();
  const basvuruGecmisi = new Map();
  setInterval(() => {
    const simdi = Date.now();
    for (const [k, t] of sonGorulme) if (simdi - t > TEKRAR_SAYMA_MS) sonGorulme.delete(k);
    for (const [k, z] of basvuruGecmisi) {
      const kalan = z.filter((t) => simdi - t < 3600e3);
      kalan.length ? basvuruGecmisi.set(k, kalan) : basvuruGecmisi.delete(k);
    }
  }, 10 * 60 * 1000).unref();

  // ---- Sayfalar ----
  const sayfa = (ad) => (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(KLASOR, ad));
  router.get('/', (req, res, next) => {
    // Göreli adresler doğru çalışsın diye sonda eğik çizgi şart
    if (!req.originalUrl.split('?')[0].endsWith('/')) {
      const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return res.redirect(301, '/projevitrini/' + q);
    }
    sayfa('index.html')(req, res, next);
  });
  // Bildirim yardımcısı (yalnız /projevitrini/ altındaki sayfaları yönetir)
  router.get('/sw.js', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/javascript; charset=utf-8' });
    res.sendFile(path.join(KLASOR, 'sw.js'));
  });
  // Ana ekrana ekleme bilgisi (iPhone'da bildirim için gerekli)
  router.get('/manifest.webmanifest', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'application/manifest+json; charset=utf-8' });
    res.sendFile(path.join(KLASOR, 'manifest.webmanifest'));
  });
  router.get('/yonetim', (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    sayfa('yonetim.html')(req, res, next);
  });

  // ---- Herkese açık ----
  router.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      await hazirla();
      next();
    } catch {
      res.status(503).json({ hata: 'Vitrin şu an açılamıyor, biraz sonra tekrar dene.' });
    }
  });

  router.get('/api/projeler', (req, res) => res.json(projeListesi()));

  router.post('/api/projeler/:id/goruntule', (req, res) => {
    const id = req.params.id;
    const proje = projeListesi().find((p) => p.id === id);
    if (!proje) return res.status(404).json({ hata: 'proje yok' });
    const anahtar = istemciIp(req) + '|' + id;
    const simdi = Date.now();
    let sayildi = false;
    if (!sonGorulme.has(anahtar) || simdi - sonGorulme.get(anahtar) > TEKRAR_SAYMA_MS) {
      sonGorulme.set(anahtar, simdi);
      durum.sayaclar[id] = (durum.sayaclar[id] || 0) + 1;
      kaydet();
      sayildi = true;
    }
    res.json({ id, goruntulenme: proje.goruntulenme + (sayildi ? 1 : 0), sayildi });
  });

  router.post('/api/basvuru', (req, res) => {
    const ip = istemciIp(req);
    const gecmis = (basvuruGecmisi.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
    if (gecmis.length >= BASVURU_SINIRI) return res.status(429).json({ hata: 'Çok fazla başvuru yaptın. Biraz sonra tekrar dene.' });
    const govde = req.body || {};
    if (govde.web_sitesi) return res.json({ tamam: true }); // bot tuzağı: sessizce yut
    const { hata, veri } = basvuruDogrula(govde);
    if (hata) return res.status(400).json({ hata });
    gecmis.push(Date.now());
    basvuruGecmisi.set(ip, gecmis);
    durum.basvurular.push({ id: kimlikUret(veri.ad), ...veri, tarih: new Date().toISOString() });
    kaydet();
    res.json({ tamam: true });
    tgGonder('proje', [
      '🆕 <b>Vitrine yeni proje geldi</b>',
      '',
      `<b>${tgKacir(veri.ad)}</b>`,
      tgKacir(veri.aciklama),
      veri.etiketler.length ? `🏷 ${tgKacir(veri.etiketler.join(', '))}` : null,
      veri.link !== '#' ? `🔗 ${tgKacir(veri.link)}` : '🔗 link yok',
      veri.iletisim ? `✉️ ${tgKacir(veri.iletisim)}` : null,
      '',
      `Onaylamak için: ${SITE}/projevitrini/yonetim`,
    ].filter((s) => s !== null).join('\n'));
  });

  // Sayfa açılınca tarayıcı bildirir; aynı kişi 24 saatte bir kez sayılır
  const ziyaretciler = new Map();
  let gunluk = { gun: '', adet: 0 };
  router.post('/api/ziyaret', (req, res) => {
    res.json({ tamam: true });
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || /bot|crawl|spider|preview|headless|lighthouse/i.test(ua)) return;
    const ip = istemciIp(req);
    const simdi = Date.now();
    if (ziyaretciler.has(ip) && simdi - ziyaretciler.get(ip) < 24 * 3600e3) return;
    ziyaretciler.set(ip, simdi);
    const gun = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
    if (gunluk.gun !== gun) gunluk = { gun, adet: 0 };
    gunluk.adet++;
    const kaynak = nereden((req.body || {}).nereden);
    tgGonder('ziyaret', [
      '👀 <b>Proje Vitrini\'ne yeni ziyaretçi</b>',
      `${cihaz(ua)} · ${saat()}`,
      kaynak ? `Nereden: ${tgKacir(kaynak)}` : '',
      `Bugünün ${gunluk.adet}. ziyaretçisi`,
    ].filter(Boolean).join('\n'));
  });
  // Tarayıcı bildirimi aboneliği
  router.get('/api/bildirim/anahtar', async (req, res) => {
    const anahtar = webpush && vapidAnahtari ? await vapidAnahtari().catch(() => '') : '';
    if (!anahtar) return res.status(503).json({ hata: 'Bildirimler şu an kullanılamıyor.' });
    res.json({ publicKey: anahtar });
  });
  router.post('/api/bildirim/abone', async (req, res) => {
    const s = aboneDogrula((req.body || {}).abonelik);
    if (!s) return res.status(400).json({ hata: 'Abonelik bilgisi geçersiz.' });
    try {
      const liste = await aboneHazirla();
      const i = liste.findIndex((x) => x.endpoint === s.endpoint);
      if (i >= 0) liste[i] = s;
      else {
        if (liste.length >= ABONE_SINIRI) return res.status(503).json({ hata: 'Abone listesi dolu.' });
        liste.push(s);
      }
      aboneKaydet();
      res.json({ tamam: true });
    } catch {
      res.status(503).json({ hata: 'Şu an kaydedilemedi.' });
    }
  });
  router.post('/api/bildirim/iptal', async (req, res) => {
    const endpoint = String((req.body || {}).endpoint || '');
    try {
      await aboneHazirla();
      const once = abonelikler.length;
      abonelikler = abonelikler.filter((x) => x.endpoint !== endpoint);
      if (abonelikler.length !== once) aboneKaydet();
      res.json({ tamam: true });
    } catch {
      res.status(503).json({ hata: 'Şu an kaydedilemedi.' });
    }
  });

  setInterval(() => {
    const simdi = Date.now();
    for (const [k, t] of ziyaretciler) if (simdi - t > 24 * 3600e3) ziyaretciler.delete(k);
  }, 3600e3).unref();

  // ---- Yönetici ----
  router.use('/api/admin', (req, res, next) => {
    if (!yoneticiSifresi()) return res.status(503).json({ hata: 'Yönetici şifresi ayarlanmamış.' });
    if (!yoneticiMi(req)) return res.status(401).json({ hata: 'Şifre yanlış.' });
    next();
  });

  router.get('/api/admin/durum', async (req, res) => {
    const aboneler = await aboneHazirla().catch(() => null);
    res.json({
      bekleyenler: durum.basvurular,
      aboneSayisi: aboneler ? aboneler.length : null,
      yayindakiler: projeListesi().map((p) => ({ ...p, kaynak: durum.onaylananlar.some((o) => o.id === p.id) ? 'basvuru' : 'hazir' })),
    });
  });

  router.post('/api/admin/basvuru/:id/:islem(onayla|reddet)', (req, res) => {
    const i = durum.basvurular.findIndex((b) => b.id === req.params.id);
    if (i < 0) return res.status(404).json({ hata: 'Başvuru bulunamadı.' });
    const [b] = durum.basvurular.splice(i, 1);
    if (req.params.islem === 'onayla') {
      durum.onaylananlar.push({
        id: b.id, ad: b.ad, aciklama: b.aciklama, etiketler: b.etiketler, link: b.link, renk: b.renk,
        iletisim: b.iletisim, baslangicGoruntulenme: 0, onayTarihi: new Date().toISOString(),
      });
    }
    kaydet();
    res.json({ tamam: true });
    if (req.params.islem === 'onayla') {
      herkeseBildir({
        title: `Vitrine yeni proje: ${b.ad}`,
        body: b.aciklama,
        url: `/projevitrini/?proje=${encodeURIComponent(b.id)}`,
        tag: 'vitrin-' + b.id,
      });
    }
  });

  router.post('/api/admin/proje/:id/duzenle', (req, res) => {
    if (!projeListesi().some((p) => p.id === req.params.id)) return res.status(404).json({ hata: 'Proje bulunamadı.' });
    const { hata, veri } = basvuruDogrula(req.body || {});
    if (hata) return res.status(400).json({ hata });
    const { iletisim, ...yeni } = veri;
    durum.duzenlemeler[req.params.id] = yeni;
    kaydet();
    res.json({ tamam: true });
  });

  // Telegram bağlantısı: durum, bağla, ayar, deneme, kaldır
  const tgOzet = (t) => (t ? { bagli: true, botAdi: t.botAdi || '', sohbetAdi: t.sohbetAdi || '', ziyaret: t.ziyaret !== false, proje: t.proje !== false } : { bagli: false });
  router.get('/api/admin/telegram', async (req, res) => {
    try { res.json(tgOzet(await tgHazirla())); } catch { res.status(503).json({ hata: 'Ayar okunamadı.' }); }
  });
  router.post('/api/admin/telegram/bagla', async (req, res) => {
    const token = String((req.body || {}).token || '').trim();
    if (!/^\d{5,}:[\w-]{20,}$/.test(token)) return res.status(400).json({ hata: 'Bu bir bot anahtarına benzemiyor. BotFather\'ın verdiği uzun kodu olduğu gibi yapıştır.' });
    try {
      const bot = await tgCagir(token, 'getMe');
      const gelenler = await tgCagir(token, 'getUpdates', { limit: 100, timeout: 0 });
      const son = gelenler.map((g) => g.message || g.my_chat_member || g.channel_post).filter((m) => m && m.chat).pop();
      if (!son) return res.status(400).json({ hata: `Bot bulundu ama sana ulaşamıyor. Telegram'da @${bot.username} botunu aç, "Başlat"a bas, sonra burada tekrar "Bağla"ya bas.` });
      const c = son.chat;
      const yeni = {
        token, sohbet: c.id, botAdi: bot.username,
        sohbetAdi: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id),
        ziyaret: tg ? tg.ziyaret !== false : true, proje: tg ? tg.proje !== false : true,
      };
      await tgCagir(token, 'sendMessage', { chat_id: c.id, text: '✅ Proje Vitrini bildirimleri bu sohbete bağlandı. Yeni ziyaretçi ve yeni proje gelince buraya yazacağım.' });
      if (!(await db.savePrivateJson(TG_DOSYA, yeni))) return res.status(500).json({ hata: 'Ayar kaydedilemedi, tekrar dene.' });
      tg = yeni; tgYuklendi = true;
      res.json(tgOzet(tg));
    } catch (e) {
      res.status(400).json({ hata: /Unauthorized|Not Found/i.test(e.message) ? 'Bot anahtarı geçersiz. BotFather\'dan doğru kodu kopyaladığına bak.' : 'Telegram\'a ulaşılamadı: ' + e.message });
    }
  });
  router.post('/api/admin/telegram/ayar', async (req, res) => {
    const ayar = await tgHazirla().catch(() => null);
    if (!ayar) return res.status(400).json({ hata: 'Önce Telegram\'ı bağla.' });
    const b = req.body || {};
    if (typeof b.ziyaret === 'boolean') ayar.ziyaret = b.ziyaret;
    if (typeof b.proje === 'boolean') ayar.proje = b.proje;
    if (!(await db.savePrivateJson(TG_DOSYA, ayar))) return res.status(500).json({ hata: 'Kaydedilemedi.' });
    res.json(tgOzet(ayar));
  });
  router.post('/api/admin/telegram/dene', async (req, res) => {
    const ayar = await tgHazirla().catch(() => null);
    if (!ayar) return res.status(400).json({ hata: 'Önce Telegram\'ı bağla.' });
    try {
      await tgCagir(ayar.token, 'sendMessage', { chat_id: ayar.sohbet, text: '🔔 Deneme: Proje Vitrini bildirimleri çalışıyor.' });
      res.json({ tamam: true });
    } catch (e) {
      res.status(400).json({ hata: 'Mesaj gitmedi: ' + e.message });
    }
  });
  router.post('/api/admin/telegram/kaldir', async (req, res) => {
    if (!(await db.deletePrivateJson(TG_DOSYA))) return res.status(500).json({ hata: 'Kaldırılamadı.' });
    tg = null; tgYuklendi = !(process.env.VITRIN_TELEGRAM_TOKEN && process.env.VITRIN_TELEGRAM_SOHBET);
    res.json({ bagli: false });
  });

  router.post('/api/admin/proje/:id/kaldir', (req, res) => {
    if (!projeListesi().some((p) => p.id === req.params.id)) return res.status(404).json({ hata: 'Proje bulunamadı.' });
    durum.gizlenenler.push(req.params.id);
    kaydet();
    res.json({ tamam: true });
  });

  app.use('/projevitrini', router);
};
