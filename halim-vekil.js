'use strict';
// newhal.com/halim adresini Halim programina aktarir. Adres cubugunda newhal.com/halim kalir.
const { Readable } = require('stream');

const ATLANAN_ISTEK = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'accept-encoding', 'x-halim-adres', 'x-halim-onek', 'content-length', 'expect',
]);
const EN_BUYUK_GOVDE = 25 * 1024 * 1024;

// Form ve dosya once butun olarak okunur, her Node surumunde ayni calisir.
async function govdeOku(req) {
  const parcalar = [];
  let boy = 0;
  for await (const parca of req) {
    boy += parca.length;
    // Sinir asilinca kalan veri okunup atilir, tarayici yarida kesilmis baglanti yerine mesaj gorur.
    if (boy <= EN_BUYUK_GOVDE) parcalar.push(parca);
  }
  if (boy > EN_BUYUK_GOVDE) {
    const hata = new Error('Gonderilen veri cok buyuk');
    hata.durum = 413;
    throw hata;
  }
  return Buffer.concat(parcalar);
}
const ATLANAN_YANIT = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie',
  'strict-transport-security',
]);

function halimVekil({ hedef = process.env.HALIM_URL || 'https://halim-lc2m.onrender.com', onek = '/halim', adres } = {}) {
  hedef = hedef.replace(/\/+$/, '');

  function konumDuzelt(deger) {
    return deger.startsWith(hedef) ? onek + (deger.slice(hedef.length) || '/') : deger;
  }

  async function aktar(req, res, kalan) {
    const basliklar = {};
    for (const [ad, deger] of Object.entries(req.headers)) {
      if (!ATLANAN_ISTEK.has(ad) && deger !== undefined) basliklar[ad] = Array.isArray(deger) ? deger.join(', ') : deger;
    }
    basliklar['accept-encoding'] = 'identity';
    basliklar['x-halim-adres'] = adres || req.get('host');
    basliklar['x-halim-onek'] = onek;
    const govdeli = !['GET', 'HEAD'].includes(req.method);
    const yanit = await fetch(hedef + kalan, {
      method: req.method,
      headers: basliklar,
      body: govdeli ? await govdeOku(req) : undefined,
      redirect: 'manual',
    });
    res.status(yanit.status);
    yanit.headers.forEach((deger, ad) => {
      if (ATLANAN_YANIT.has(ad)) return;
      res.setHeader(ad, ad === 'location' ? konumDuzelt(deger) : deger);
    });
    // Halim'in oturum cerezi sadece /halim altinda gecerli olsun, newhal'in kendi cerezlerine karismasin.
    const cerezler = typeof yanit.headers.getSetCookie === 'function' ? yanit.headers.getSetCookie() : [];
    if (cerezler.length) res.setHeader('set-cookie', cerezler.map(c => c.replace(/;\s*Path=[^;]*/i, '') + `; Path=${onek}`));
    if (!yanit.body || req.method === 'HEAD') return res.end();
    Readable.fromWeb(yanit.body).on('error', () => res.destroy()).pipe(res);
  }

  return function (req, res, next) {
    const yol = req.originalUrl;
    if (yol !== onek && !yol.startsWith(onek + '/') && !yol.startsWith(onek + '?')) return next();
    let kalan = yol.slice(onek.length);
    if (!kalan.startsWith('/')) kalan = '/' + kalan;
    aktar(req, res, kalan).catch(err => {
      console.error('Halim aktarimi basarisiz:', err.message, err.cause ? String(err.cause) : '');
      if (!res.headersSent && err.durum === 413) {
        res.status(413).type('html').send('<!doctype html><meta charset="utf-8"><title>Halim</title>'
          + '<p style="font:18px sans-serif;padding:24px">Gönderilen dosya çok büyük. En fazla 20 MB olabilir.</p>');
      } else if (!res.headersSent) {
        res.status(502).type('html').send('<!doctype html><meta charset="utf-8"><title>Halim</title>'
          + '<p style="font:18px sans-serif;padding:24px">Halim şu anda açılamadı. Bir dakika sonra sayfayı yenile.</p>');
      } else {
        res.destroy();
      }
    });
  };
}

module.exports = halimVekil;
