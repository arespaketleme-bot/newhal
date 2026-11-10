'use strict';
// newhal.com/halim adresini Halim programina aktarir. Adres cubugunda newhal.com/halim kalir.
const { Readable } = require('stream');

const ATLANAN_ISTEK = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'accept-encoding', 'x-halim-adres', 'x-halim-onek',
]);
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
      body: govdeli ? req : undefined,
      duplex: govdeli ? 'half' : undefined,
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
      console.error('Halim aktarimi basarisiz:', err.message);
      if (!res.headersSent) {
        res.status(502).type('html').send('<!doctype html><meta charset="utf-8"><title>Halim</title>'
          + '<p style="font:18px sans-serif;padding:24px">Halim şu anda açılamadı. Bir dakika sonra sayfayı yenile.</p>');
      } else {
        res.destroy();
      }
    });
  };
}

module.exports = halimVekil;
