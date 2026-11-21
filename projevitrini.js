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

module.exports = function projeVitrini(app, { db }) {
  const router = express.Router();
  const yoneticiSifresi = () => process.env.VITRIN_ADMIN_SIFRE || process.env.ADMIN_PASSWORD || '';

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
  });

  // ---- Yönetici ----
  router.use('/api/admin', (req, res, next) => {
    if (!yoneticiSifresi()) return res.status(503).json({ hata: 'Yönetici şifresi ayarlanmamış.' });
    if (!yoneticiMi(req)) return res.status(401).json({ hata: 'Şifre yanlış.' });
    next();
  });

  router.get('/api/admin/durum', (req, res) => {
    res.json({
      bekleyenler: durum.basvurular,
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

  router.post('/api/admin/proje/:id/kaldir', (req, res) => {
    if (!projeListesi().some((p) => p.id === req.params.id)) return res.status(404).json({ hata: 'Proje bulunamadı.' });
    durum.gizlenenler.push(req.params.id);
    kaydet();
    res.json({ tamam: true });
  });

  app.use('/projevitrini', router);
};
