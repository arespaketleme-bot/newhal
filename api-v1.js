'use strict';
// NewHal herkese açık ilan API'si (sürüm 1) — belgesi: /api
//   GET /api/v1                 API'nin kendisi hakkında bilgi
//   GET /api/v1/ilanlar         ilan listesi (arama, sayfalama, sıralama, süzgeç)
//   GET /api/v1/ilanlar/:no     tek ilan (ilan numarası ya da kimliği)
//   GET /api/v1/openapi.json    OpenAPI 3 tanımı
// Yalnızca yayındaki ilanlar ve dışarıya açık alanlar verilir; üye numarası, Facebook
// kaynağı, iç zaman damgaları ve yorum içerikleri verilmez. IP başına dakikada sınırlıdır.

const RATE_PER_MIN = 120;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const normalize = t => String(t || '').toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Metindeki Türkiye telefon numaraları (05xx..., +90 5xx..., 0324...) ayrı alan olarak verilir
function phonesIn(text) {
  const out = [];
  // Önünde ve arkasında rakam olmamalı: uzun sayıların (IBAN, sipariş no) içinden numara uydurulmaz
  for (const m of String(text || '').matchAll(/(?<![\d+])(?:\+?90[\s.-]?)?\(?0?\s?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?![\d])/g)) {
    let d = m[0].replace(/\D/g, '');
    if (d.startsWith('90')) d = d.slice(2);
    if (!d.startsWith('0')) d = '0' + d;
    if (d.length === 11 && !out.includes(d)) out.push(d);
  }
  return out.slice(0, 5);
}

module.exports = function registerApiV1(app, { getAds, siteUrl, adPath, isPublicAd, getIp }) {
  // ── Hız sınırı (IP başına dakikada RATE_PER_MIN istek) ──
  const hits = new Map();
  setInterval(() => { const cut = Date.now() - 60000; for (const [ip, h] of hits) if (h.at < cut) hits.delete(ip); }, 60000).unref();
  function rateLimit(req, res, next) {
    const ip = String(getIp(req)).split(',')[0].trim();
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.at >= 60000) { h = { at: now, n: 0 }; hits.set(ip, h); }
    h.n++;
    const reset = Math.ceil((h.at + 60000 - now) / 1000);
    res.set({ 'X-RateLimit-Limit': String(RATE_PER_MIN), 'X-RateLimit-Remaining': String(Math.max(0, RATE_PER_MIN - h.n)), 'X-RateLimit-Reset': String(reset) });
    if (h.n > RATE_PER_MIN) {
      res.set('Retry-After', String(reset));
      return res.status(429).json({ hata: `Çok fazla istek. Dakikada en fazla ${RATE_PER_MIN} istek yapılabilir; ${reset} saniye sonra tekrar deneyin.` });
    }
    next();
  }

  const toApi = ad => {
    const text = [ad.title, ad.body].filter(Boolean).join('\n');
    const v = ad.video;
    const ai = ad.source && ad.source.ai;
    return {
      id: ad.id,
      no: ad.no,
      baslik: ad.title || '',
      aciklama: ad.body || '',
      telefonlar: phonesIn(text),
      resimler: (ad.images || []).filter(u => typeof u === 'string'),
      video: v ? { tur: v.type || null, url: v.url || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : null) } : null,
      vitrin: !!ad.featured,
      ilan_veren: ad.owner_name || null,
      begeni: Number(ad.like_count) || 0,
      yorum_sayisi: Array.isArray(ad.comments) ? ad.comments.length : 0,
      // Yapay zekanın ilandan çıkardığı bilgi (yalnızca İlan Ajanı'nın bulduğu ilanlarda)
      etiket: ai ? { tur: ai.kind || null, urun: ai.product || null, miktar: ai.quantity || null, fiyat: ai.price || null, yer: ai.location || null } : null,
      tarih: ad.created_at || null,
      guncelleme: ad.updated_at || null,
      link: siteUrl + adPath(ad),
    };
  };

  async function publicAds() {
    return (await getAds()).filter(isPublicAd);
  }

  app.get('/api/v1', rateLimit, (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      ad: 'NewHal İlan API', surum: 1, belge: `${siteUrl}/api`, openapi: `${siteUrl}/api/v1/openapi.json`,
      uclar: { ilanlar: `${siteUrl}/api/v1/ilanlar`, ilan: `${siteUrl}/api/v1/ilanlar/{no}` },
      sinir: `IP başına dakikada ${RATE_PER_MIN} istek`,
    });
  });

  app.get('/api/v1/ilanlar', rateLimit, async (req, res) => {
    try {
      const q = req.query;
      const page = Math.max(1, parseInt(q.sayfa, 10) || 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(q.adet, 10) || DEFAULT_PAGE_SIZE));
      const sort = ['yeni', 'eski', 'begeni'].includes(q.siralama) ? q.siralama : 'yeni';
      let list = await publicAds();
      const words = normalize(q.ara).split(' ').filter(Boolean).slice(0, 8);
      if (words.length) list = list.filter(a => { const t = normalize(`${a.title || ''} ${a.body || ''}`); return words.every(w => t.includes(w)); });
      if (q.vitrin === '1' || q.vitrin === 'true') list = list.filter(a => a.featured);
      if (q.resimli === '1' || q.resimli === 'true') list = list.filter(a => (a.images || []).length);
      if (q.tarihten) {
        const since = Date.parse(q.tarihten);
        if (Number.isNaN(since)) return res.status(400).json({ hata: '"tarihten" geçerli bir tarih olmalı (örn. 2026-11-20 ya da 2026-11-20T08:00:00Z)' });
        list = list.filter(a => Date.parse(a.created_at) >= since);
      }
      const byDate = (a, b) => String(b.created_at).localeCompare(String(a.created_at));
      list.sort(sort === 'eski' ? (a, b) => -byDate(a, b) : sort === 'begeni' ? (a, b) => (b.like_count || 0) - (a.like_count || 0) || byDate(a, b) : byDate);
      const total = list.length;
      const pages = Math.max(1, Math.ceil(total / size));
      const items = list.slice((page - 1) * size, page * size).map(toApi);
      const link = p => {
        const u = new URL(`${siteUrl}/api/v1/ilanlar`);
        for (const [k, v] of Object.entries(q)) if (k !== 'sayfa' && typeof v === 'string') u.searchParams.set(k, v);
        u.searchParams.set('sayfa', String(p));
        return u.href;
      };
      res.set('Cache-Control', 'public, max-age=60');
      res.json({
        toplam: total, sayfa: page, adet: size, sayfa_sayisi: pages,
        onceki: page > 1 ? link(page - 1) : null,
        sonraki: page < pages ? link(page + 1) : null,
        ilanlar: items,
      });
    } catch (err) {
      console.error('API ilan listesi hatası:', err.message);
      res.status(500).json({ hata: 'İlanlar şu an getirilemedi, biraz sonra tekrar deneyin' });
    }
  });

  app.get('/api/v1/ilanlar/:key', rateLimit, async (req, res) => {
    try {
      const key = String(req.params.key);
      const ads = await publicAds();
      const ad = /^\d+$/.test(key) ? ads.find(a => a.no === Number(key)) : ads.find(a => a.id === key);
      if (!ad) return res.status(404).json({ hata: 'İlan bulunamadı ya da artık yayında değil' });
      res.set('Cache-Control', 'public, max-age=60');
      res.json(toApi(ad));
    } catch (err) {
      console.error('API ilan hatası:', err.message);
      res.status(500).json({ hata: 'İlan şu an getirilemedi, biraz sonra tekrar deneyin' });
    }
  });

  // OpenAPI 3 tanımı: Postman, Swagger vb. araçlara doğrudan verilebilir
  app.get('/api/v1/openapi.json', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    const Ilan = {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'İlanın değişmeyen kimliği' },
        no: { type: 'integer', description: 'İlan numarası (sitede #12 gibi görünür)' },
        baslik: { type: 'string' }, aciklama: { type: 'string' },
        telefonlar: { type: 'array', items: { type: 'string' }, description: 'Metinde geçen telefonlar, 0 ile başlayan 11 hane' },
        resimler: { type: 'array', items: { type: 'string', format: 'uri' } },
        video: { type: 'object', nullable: true, properties: { tur: { type: 'string' }, url: { type: 'string' } } },
        vitrin: { type: 'boolean' }, ilan_veren: { type: 'string', nullable: true },
        begeni: { type: 'integer' }, yorum_sayisi: { type: 'integer' },
        etiket: { type: 'object', nullable: true, description: 'Yapay zekanın ilandan çıkardığı bilgi',
          properties: { tur: { type: 'string' }, urun: { type: 'string' }, miktar: { type: 'string' }, fiyat: { type: 'string' }, yer: { type: 'string' } } },
        tarih: { type: 'string', format: 'date-time' }, guncelleme: { type: 'string', format: 'date-time', nullable: true },
        link: { type: 'string', format: 'uri', description: 'İlanın NewHal sayfası' },
      },
    };
    const Hata = { type: 'object', properties: { hata: { type: 'string' } } };
    res.json({
      openapi: '3.0.3',
      info: { title: 'NewHal İlan API', version: '1.0.0', description: `Mersin Hal Kompleksi ilanları. IP başına dakikada ${RATE_PER_MIN} istek. Belge: ${siteUrl}/api` },
      servers: [{ url: siteUrl }],
      paths: {
        '/api/v1/ilanlar': { get: {
          summary: 'İlan listesi', parameters: [
            { name: 'ara', in: 'query', schema: { type: 'string' }, description: 'Başlık ve açıklamada arar; birden çok kelimenin hepsi geçmeli' },
            { name: 'sayfa', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'adet', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE } },
            { name: 'siralama', in: 'query', schema: { type: 'string', enum: ['yeni', 'eski', 'begeni'], default: 'yeni' } },
            { name: 'vitrin', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Yalnızca vitrindeki ilanlar' },
            { name: 'resimli', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Yalnızca fotoğraflı ilanlar' },
            { name: 'tarihten', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Bu tarihten sonra verilen ilanlar' },
          ],
          responses: {
            200: { description: 'Sayfalı liste', content: { 'application/json': { schema: { type: 'object', properties: {
              toplam: { type: 'integer' }, sayfa: { type: 'integer' }, adet: { type: 'integer' }, sayfa_sayisi: { type: 'integer' },
              onceki: { type: 'string', nullable: true }, sonraki: { type: 'string', nullable: true },
              ilanlar: { type: 'array', items: { $ref: '#/components/schemas/Ilan' } } } } } } },
            400: { description: 'Geçersiz parametre', content: { 'application/json': { schema: { $ref: '#/components/schemas/Hata' } } } },
            429: { description: 'Hız sınırı aşıldı', content: { 'application/json': { schema: { $ref: '#/components/schemas/Hata' } } } },
          } } },
        '/api/v1/ilanlar/{no}': { get: {
          summary: 'Tek ilan', parameters: [{ name: 'no', in: 'path', required: true, schema: { type: 'string' }, description: 'İlan numarası ya da kimliği' }],
          responses: {
            200: { description: 'İlan', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ilan' } } } },
            404: { description: 'Bulunamadı', content: { 'application/json': { schema: { $ref: '#/components/schemas/Hata' } } } },
          } } },
      },
      components: { schemas: { Ilan, Hata } },
    });
  });
};
