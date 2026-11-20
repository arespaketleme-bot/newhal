'use strict';
// NewHal iPhone uygulaması için sunucu tarafı:
//  1) Google girişi: uygulama girişi Safari penceresinde yapar; dönüşte tek kullanımlık
//     kısa ömürlü bir kod verilir, uygulama bu kodu oturumla değiştirir (oturum anahtarı
//     "newhal://" adresinde açıkta dolaşmaz).
//  2) iPhone bildirimleri (APNs): cihaz kimlikleri saklanır, tarayıcı bildirimi giden her
//     yere iPhone bildirimi de gider. Apple anahtarı ortam değişkenlerinden okunur:
//       APNS_KEY      .p8 dosyasının içeriği (satır sonları \n olarak da yazılabilir)
//       APNS_KEY_ID   anahtar kimliği (10 karakter)
//       APNS_TEAM_ID  Apple geliştirici ekip kimliği (10 karakter)
//       APNS_BUNDLE_ID  uygulama kimliği (varsayılan com.newhal.app)
//       APNS_ENV      production (App Store / TestFlight, varsayılan) ya da development
//     Ayarlı değilse iPhone bildirimi sessizce atlanır, site çalışmaya devam eder.
const http2 = require('http2');
const crypto = require('crypto');

const APP_CODE_TTL_MS = 3 * 60 * 1000;
const TOKENS_FILE = 'ios-push-tokens.json';
const TOKEN_RX = /^[0-9a-f]{64,200}$/i;
const MAX_TOKENS_PER_USER = 5;

module.exports = function registerIos(app, { db, jwt, requireAuth }) {
  // ── 1) Uygulama girişi: tek kullanımlık kod ──────────────────
  const appCodes = new Map();   // kod → { data, exp }

  function issueAppCode(data) {
    const now = Date.now();
    for (const [k, v] of appCodes) if (v.exp < now) appCodes.delete(k);
    const code = crypto.randomBytes(24).toString('base64url');
    appCodes.set(code, { data, exp: now + APP_CODE_TTL_MS });
    return code;
  }

  // Safari penceresinin son durağı: uygulamaya geri döner
  app.get('/app-giris', (req, res) => {
    const code = String(req.query.code || '');
    const error = req.query.error ? '1' : '';
    const target = error ? 'newhal://giris?error=1' : `newhal://giris?code=${encodeURIComponent(code)}`;
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.type('html').send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>NewHal'e dönülüyor</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,system-ui,sans-serif;background:#f4f7f5;color:#0f172a;text-align:center;padding:24px;box-sizing:border-box}
a{display:inline-block;margin-top:16px;padding:14px 26px;border-radius:999px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:700;text-decoration:none}</style>
</head><body><div><div style="font-size:48px">${error ? '⚠️' : '✅'}</div>
<h1 style="font-size:20px">${error ? 'Giriş tamamlanamadı' : 'Giriş yapıldı'}</h1>
<p>NewHal uygulamasına dönülüyor…</p>
<a href="${target}">NewHal'e dön</a></div>
<script>location.href = ${JSON.stringify(target)};</script>
</body></html>`);
  });

  // Uygulama kodu oturumla değiştirir (kod bir kez ve 3 dakika geçerli)
  app.post('/api/auth/app-code', (req, res) => {
    const code = String((req.body && req.body.code) || '');
    const item = appCodes.get(code);
    appCodes.delete(code);
    if (!item || item.exp < Date.now()) return res.status(400).json({ error: 'Giriş kodunun süresi doldu, lütfen tekrar deneyin' });
    res.set('Cache-Control', 'no-store');
    res.json(item.data);
  });

  // ── 2) iPhone bildirimleri ──────────────────────────────────
  let tokensCache = null;
  async function getTokens() {
    if (!tokensCache) {
      const saved = await db.getPrivateJson(TOKENS_FILE);
      tokensCache = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    }
    return tokensCache;
  }
  const saveTokens = () => db.savePrivateJson(TOKENS_FILE, tokensCache);

  app.post('/api/push/ios', requireAuth, async (req, res) => {
    const token = String((req.body && req.body.token) || '').trim();
    if (!TOKEN_RX.test(token)) return res.status(400).json({ error: 'Geçersiz cihaz kimliği' });
    const all = await getTokens();
    // Aynı cihaz başka hesapla kayıtlıysa oradan çıkarılır (telefonda hesap değişti)
    for (const uid of Object.keys(all)) all[uid] = all[uid].filter(t => t !== token);
    const uid = String(req.user.id);
    all[uid] = [token, ...(all[uid] || [])].slice(0, MAX_TOKENS_PER_USER);
    for (const k of Object.keys(all)) if (!all[k].length) delete all[k];
    if (!(await saveTokens())) return res.status(500).json({ error: 'Kaydedilemedi' });
    res.json({ ok: true });
  });

  app.delete('/api/push/ios', requireAuth, async (req, res) => {
    const token = String((req.body && req.body.token) || '').trim();
    const all = await getTokens();
    const uid = String(req.user.id);
    if (all[uid]) {
      all[uid] = all[uid].filter(t => t !== token);
      if (!all[uid].length) delete all[uid];
      await saveTokens();
    }
    res.json({ ok: true });
  });

  function apnsConfig() {
    const key = String(process.env.APNS_KEY || '').replace(/\\n/g, '\n').trim();
    const keyId = String(process.env.APNS_KEY_ID || '').trim();
    const teamId = String(process.env.APNS_TEAM_ID || '').trim();
    if (!key || !keyId || !teamId) return null;
    return {
      key, keyId, teamId,
      topic: String(process.env.APNS_BUNDLE_ID || 'com.newhal.app').trim(),
      host: process.env.APNS_HOST   // yalnızca test için
        || (process.env.APNS_ENV === 'development' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'),
    };
  }

  // Apple, yetki belgesinin 20–60 dakikada bir yenilenmesini ister
  let jwtCache = { token: '', at: 0 };
  function apnsJwt(cfg) {
    if (jwtCache.token && Date.now() - jwtCache.at < 40 * 60 * 1000) return jwtCache.token;
    const token = jwt.sign({ iss: cfg.teamId }, cfg.key, { algorithm: 'ES256', header: { alg: 'ES256', kid: cfg.keyId } });
    jwtCache = { token, at: Date.now() };
    return token;
  }

  function sendOne(session, cfg, deviceToken, body) {
    return new Promise(resolve => {
      const req = session.request({
        ':method': 'POST', ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${apnsJwt(cfg)}`, 'apns-topic': cfg.topic,
        'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json',
      });
      let status = 0, data = '';
      req.setTimeout(15000, () => { req.close(); resolve({ status: 0, reason: 'timeout' }); });
      req.on('response', h => { status = Number(h[':status']) || 0; });
      req.on('data', c => { data += c; });
      req.on('end', () => {
        let reason = '';
        try { reason = JSON.parse(data || '{}').reason || ''; } catch {}
        resolve({ status, reason });
      });
      req.on('error', err => resolve({ status: 0, reason: err.message }));
      req.end(body);
    });
  }

  // Tarayıcı bildirimiyle aynı içerik: { title, body, url, tag }
  async function sendApnsMany(userIds, payload) {
    const cfg = apnsConfig();
    if (!cfg || !userIds || !userIds.length) return;
    const all = await getTokens();
    const targets = [...new Set(userIds.map(String))].flatMap(uid => (all[uid] || []).map(t => ({ uid, t })));
    if (!targets.length) return;
    const body = JSON.stringify({
      aps: { alert: { title: String(payload.title || 'NewHal').slice(0, 120), body: String(payload.body || '').slice(0, 400) }, sound: 'default' },
      url: payload.url || '/?openNotifications=1',
      ...(payload.tag ? { tag: String(payload.tag).slice(0, 60) } : {}),
    });
    let session;
    try {
      session = http2.connect(cfg.host);
      session.on('error', () => {});
      let changed = false;
      for (const { uid, t } of targets) {
        const r = await sendOne(session, cfg, t, body);
        // Uygulama silinmiş ya da kimlik geçersiz: bir daha denenmez
        if (r.status === 410 || (r.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(r.reason))) {
          all[uid] = (all[uid] || []).filter(x => x !== t);
          if (!all[uid].length) delete all[uid];
          changed = true;
        } else if (r.status !== 200) {
          console.error('iPhone bildirimi gönderilemedi:', r.status, r.reason);
        }
      }
      if (changed) await saveTokens();
    } catch (err) {
      console.error('iPhone bildirimi gönderilemedi:', err.message);
    } finally {
      if (session) session.close();
    }
  }

  return { issueAppCode, sendApnsMany, apnsConfigured: () => !!apnsConfig() };
};
