require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const db      = require('./database');
const bcrypt  = require('bcryptjs');
const webpush = require('web-push');
const emailNotifications = require('./email-notifications');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app        = express();
// newhal.com/halim adresi Halim programini kendi adresiyle gosterir
app.use(require('./halim-vekil')());
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'newhal_secret';
const cleanReferralCode = value => /^NH[1-9]\d{0,17}$/i.test(String(value || '').trim())
  ? String(value).trim().toUpperCase() : '';
const todayInIstanbul = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
let vapidConfigured = false;
let vapidPublicKey = '';
const vapidInitialization = (async () => {
  let keys = await db.getPrivateJson('web-push-vapid.json');
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    if (!(await db.savePrivateJson('web-push-vapid.json', keys))) throw new Error('VAPID anahtarı güvenli depoya yazılamadı');
  }
  webpush.setVapidDetails('mailto:arespaketleme@gmail.com', keys.publicKey, keys.privateKey);
  vapidPublicKey = keys.publicKey;
  vapidConfigured = true;
})().catch(err => {
  console.error('Tarayıcı bildirim anahtarları yüklenemedi:', err.message);
});

app.use(cors());
// Fotoğraf yükleme kendi (daha büyük) sınırıyla ayrıca okunur
const jsonSmall = express.json();
app.use((req, res, next) => (req.path === '/api/uploads' ? next() : jsonSmall(req, res, next)));
// "/?ilan=<kimlik>" bağlantısı paylaşılınca Facebook/WhatsApp önizlemesi ilanın kendi resmi ve başlığıyla çıksın
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Eski adres (newhal.onrender.com) ile açılan sayfalar kalıcı olarak newhal.com'a gider
const OLD_HOST = 'newhal.onrender.com';
const NEW_ORIGIN = 'https://newhal.com';
app.use((req, res, next) => {
  if (req.hostname === OLD_HOST && req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) {
    return res.redirect(301, NEW_ORIGIN + req.originalUrl);
  }
  next();
});

app.use(async (req, res, next) => {
  if (req.method !== 'GET' || req.path !== '/' || !req.query.ilan) return next();
  try {
    const ad = (await db.getAds()).find(a => a.id === String(req.query.ilan) && a.active !== false && !a.pending);
    if (!ad) return next();
    const siteUrl = process.env.SITE_URL || 'https://newhal.com';
    const summary = (ad.title || ad.body || 'İlan').replace(/\s+/g, ' ').trim();
    const title = `#${ad.no} · ${summary.slice(0, 70)} | NewHal İlanlar`;
    const desc = (ad.body || ad.title || 'Mersin Hal Kompleksi ilanı').replace(/\s+/g, ' ').trim().slice(0, 200);
    const image = (ad.images || [])[0]
      || (ad.video && ad.video.type === 'youtube' ? `https://i.ytimg.com/vi/${ad.video.id}/hqdefault.jpg` : `${siteUrl}/img/ilan-logo.jpg`);
    const url = `${siteUrl}/?ilan=${encodeURIComponent(ad.id)}`;
    let html = fs.readFileSync(INDEX_HTML, 'utf8');
    const setMeta = (prop, value) => {
      html = html.replace(new RegExp(`(<meta property="${prop}" content=")[^"]*(")`), `$1${escAttr(value)}$2`);
    };
    setMeta('og:url', url); setMeta('twitter:url', url);
    setMeta('og:title', title); setMeta('twitter:title', title);
    setMeta('og:description', desc); setMeta('twitter:description', desc);
    setMeta('og:image', image); setMeta('twitter:image', image);
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escAttr(title)}</title>`);
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${escAttr(desc)}$2`);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escAttr(url)}$2`);
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  } catch (err) {
    next();
  }
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(passport.initialize());

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('HATA: GOOGLE_CLIENT_ID veya GOOGLE_CLIENT_SECRET ortam değişkenleri tanımlı değil.');
  process.exit(1);
}

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
    proxy: true // In case it runs behind a proxy (e.g. Render)
  },
  async function(accessToken, refreshToken, profile, cb) {
    try {
      const user = await db.findOrCreateGoogleUser({
        googleId: profile.id,
        name: profile.displayName,
        email: profile.emails && profile.emails.length > 0 ? profile.emails[0].value : '',
        avatar: profile.photos && profile.photos.length > 0 ? profile.photos[0].value : ''
      });
      return cb(null, user);
    } catch (err) {
      return cb(err);
    }
  }
));

// ── Auth Middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Bu işlemi yapmak için giriş yapmalısınız' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Oturum süresi dolmuş, lütfen tekrar giriş yapın' });
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token gerekli' });
  try {
    req.admin = jwt.verify(header.split(' ')[1], JWT_SECRET);
    if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Yetkisiz erişim' });
    next();
  } catch {
    return res.status(401).json({ error: 'Geçersiz token' });
  }
}

async function sendBrowserPushMany(userIds, payload) {
  try {
    await vapidInitialization;
    if (!vapidConfigured || !userIds.length) return;
    const { data: subscriptions, error } = await db.supabase.from('web_push_subscriptions')
      .select('endpoint,subscription').in('user_id', [...new Set(userIds)]);
    if (error) {
      console.error('Tarayıcı bildirim abonelikleri alınamadı:', error.message);
      return;
    }
    await Promise.all((subscriptions || []).map(async item => {
      try {
        await webpush.sendNotification(item.subscription, JSON.stringify(payload), { TTL: 60 });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.supabase.from('web_push_subscriptions').delete().eq('endpoint', item.endpoint);
        } else {
          console.error('Tarayıcı bildirimi gönderilemedi:', err.statusCode || err.message);
        }
      }
    }));
  } catch (err) {
    console.error('Tarayıcı bildirimi gönderilemedi:', err.statusCode || err.message);
  }
}

const sendBrowserPush = (userId, payload) => sendBrowserPushMany([userId], payload);

// ── PUBLIC: Admin Girişi ──────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username !== (process.env.ADMIN_USERNAME || 'admin') ||
    password !== (process.env.ADMIN_PASSWORD || 'newhal2024')
  ) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  }
  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username });
});

// ── ADMIN: Tüm kullanıcıları getir ───────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const balances = new Map();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.supabase.from('newhal_points_ledger')
    .select('user_id,amount,created_by').order('id', { ascending: true }).range(offset, offset + 999);
    if (error) return res.status(500).json({ error: 'Kullanıcı puanları alınamadı' });
    (data || []).forEach(row => balances.set(row.user_id, (balances.get(row.user_id) || 0) + (row.created_by === 'economy:vitrin_purchase' ? -Math.abs(Number(row.amount || 0)) : Number(row.amount || 0))));
    if (!data || data.length < 1000) break;
  }
  const users = await db.getAllUsers();
  const phoneNumbers = await accounts.getAdminPhones(users.map(user => user.id));
  res.json(users.map(user => {
    const pointsBalance = balances.get(user.id) || 0;
    return { ...user, phone_number: phoneNumbers[user.id] || '', points_balance: pointsBalance, level: Math.floor(pointsBalance / 1000) + 1 };
  }));
});

app.post('/api/admin/users/:id/points', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const amount = Number(req.body.amount);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Geçersiz kullanıcı' });
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000) {
    return res.status(400).json({ error: 'Yüklenecek puan 1 ile 100.000 arasında olmalı' });
  }
  const { data: user, error: userError } = await db.supabase.from('users').select('id').eq('id', userId).maybeSingle();
  if (userError || !user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const { error } = await db.supabase.from('newhal_points_ledger').insert({
    user_id: userId,
    amount,
    reason: 'admin_credit',
    idempotency_key: `admin-credit:${crypto.randomUUID()}`,
    created_by: String(req.admin.username || 'admin').slice(0, 80),
  });
  if (error) {
    console.error('Admin Para Puan yüklemesi yapılamadı:', error.message);
    return res.status(500).json({ error: 'Para Puan yüklenemedi' });
  }
  res.json({ userId, amount });
});

app.get('/api/push/public-key', requireAuth, async (req, res) => {
  await vapidInitialization;
  if (!vapidConfigured) return res.status(503).json({ error: 'Tarayıcı bildirimi şu anda kullanılamıyor' });
  res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscriptions', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
  if (!vapidConfigured) return res.status(503).json({ error: 'Tarayıcı bildirimi şu anda kullanılamıyor' });
  const subscription = req.body || {};
  const endpoint = String(subscription.endpoint || '');
  const keys = subscription.keys || {};
  let pushHost = '';
  try {
    const parsed = new URL(endpoint);
    pushHost = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || endpoint.length > 2048) throw new Error('endpoint');
  } catch {
    return res.status(400).json({ error: 'Tarayıcı bildirimi aboneliği geçersiz' });
  }
  const supportedHost = pushHost === 'fcm.googleapis.com'
    || pushHost.endsWith('.push.services.mozilla.com')
    || pushHost.endsWith('.push.apple.com')
    || pushHost.endsWith('.notify.windows.com');
  if (!supportedHost) return res.status(400).json({ error: 'Desteklenmeyen tarayıcı bildirimi servisi' });
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return res.status(400).json({ error: 'Tarayıcı bildirimi anahtarları eksik' });
  }
  const { error } = await db.supabase.from('web_push_subscriptions').upsert({
    user_id: req.user.id,
    endpoint,
    subscription,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) {
    console.error('Tarayıcı bildirimi aboneliği kaydedilemedi:', error.message);
    return res.status(500).json({ error: 'Tarayıcı bildirimi açılamadı' });
  }
  res.json({ subscribed: true });
});

app.delete('/api/push/subscriptions', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
  const endpoint = String(req.body.endpoint || '');
  if (!endpoint) return res.status(400).json({ error: 'Abonelik bulunamadı' });
  const { error } = await db.supabase.from('web_push_subscriptions').delete()
    .eq('user_id', req.user.id).eq('endpoint', endpoint);
  if (error) return res.status(500).json({ error: 'Tarayıcı bildirimi kapatılamadı' });
  res.json({ subscribed: false });
});

app.post('/api/admin/notifications/broadcast', requireAdmin, async (req, res) => {
  const title = String(req.body.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 1500);
  if (!title || !body) return res.status(400).json({ error: 'Başlık ve mesaj zorunludur' });

  const allUsers = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.supabase.from('users').select('id,email').order('id', { ascending: true }).range(offset, offset + 999);
    if (error) return res.status(500).json({ error: 'Kullanıcı listesi alınamadı' });
    allUsers.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const ids = allUsers.map(user => user.id);
  if (!ids.length) return res.json({ sent: 0 });

  let sent = 0;
  for (let offset = 0; offset < ids.length; offset += 500) {
    const rows = ids.slice(offset, offset + 500).map(recipient_id => ({
      recipient_id, actor_id: null, type: 'announcement', title, body,
    }));
    const { error } = await db.supabase.from('user_notifications').insert(rows);
    if (error) {
      console.error('Toplu bildirim gönderilemedi:', error.message);
      return res.status(500).json({ error: 'Bildirim gönderimi tamamlanamadı', sent, total: ids.length });
    }
    await sendBrowserPushMany(rows.map(row => row.recipient_id), {
      title, body, url: '/?openNotifications=1', tag: `announcement-${Date.now()}`,
    });
    sent += rows.length;
  }
  const emailResults = await emailNotifications.sendNotificationEmails(allUsers, {
    subject: `NewHal duyurusu: ${title}`, title, body, path: '/?openNotifications=1',
  });
  res.json({ sent, email: emailResults });
});

// ── PUBLIC: Google Auth Routes ────────────────────────────────
app.get('/auth/google', (req, res, next) => {
  res.cookie('newhal_referral', cleanReferralCode(req.query.ref), {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/',
  });
  next();
}, passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: '/?error=google_auth_failed' }),
  async function(req, res) {
    const cookie = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('newhal_referral='));
    let referralCode = '';
    try { referralCode = cleanReferralCode(cookie ? decodeURIComponent(cookie.slice('newhal_referral='.length)) : ''); } catch {}
    let pointsAwarded = false;
    try {
      const { data, error } = await db.supabase.rpc('newhal_award_daily_login', {
        p_user_id: req.user.id,
        p_day_key: todayInIstanbul(),
      });
      if (error) throw error;
      pointsAwarded = data === true;
    } catch (err) {
      console.error('Google giriş puanı verilemedi:', err.message);
    }
    if (req.user._newhalCreated && referralCode) {
      const referrerId = Number(referralCode.slice(2));
      if (Number.isSafeInteger(referrerId) && referrerId !== Number(req.user.id)) {
        try {
          const { error } = await db.supabase.rpc('newhal_award_referral', {
            p_referrer_id: referrerId,
            p_referred_id: req.user.id,
          });
          if (error) console.error('Google kayıt referans puanı verilemedi:', error.message);
        } catch (err) {
          console.error('Google kayıt referans puanı verilemedi:', err.message);
        }
      }
    }
    res.clearCookie('newhal_referral', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    const token = jwt.sign(
      { id: req.user.id, name: req.user.name, email: req.user.email, role: 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    if (req.user._newhalCreated) {
      notifyNewMember(req.user).catch(err => console.error('Yeni üye Telegram bildirimi gönderilemedi:', err.message));
    }
    res.redirect(`/?googleAuth=success&token=${token}&name=${encodeURIComponent(req.user.name)}${pointsAwarded ? '&points=100' : ''}`);
  }
);

// ── PUBLIC: Onaylı iğneleri getir ────────────────────────────
// IP adresleri kişisel veri: herkese açık yanıtlardan çıkarılır, sadece admin görür
const stripIp = ({ ip, ...rest }) => rest;

function optionalViewerId(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  try {
    const user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    return user.role === 'user' && Number.isSafeInteger(Number(user.id)) ? Number(user.id) : null;
  } catch {
    return null;
  }
}

const DEFAULT_BUSINESS_LEVEL_RULES = Object.freeze({ interactionsPerLevel: 5 });
let businessLevelRulesCache = { ...DEFAULT_BUSINESS_LEVEL_RULES };
let businessLevelRulesCacheAt = 0;

async function getBusinessLevelRules() {
  if (Date.now() - businessLevelRulesCacheAt < 30_000) return businessLevelRulesCache;
  try {
    const saved = await db.getPrivateJson('business-level-rules.json');
    const interactionsPerLevel = Number(saved && saved.interactionsPerLevel);
    businessLevelRulesCache = Number.isInteger(interactionsPerLevel) && interactionsPerLevel >= 1 && interactionsPerLevel <= 10000
      ? { interactionsPerLevel }
      : { ...DEFAULT_BUSINESS_LEVEL_RULES };
  } catch (err) {
    console.error('İşletme seviye kuralı okunamadı:', err.message);
  }
  businessLevelRulesCacheAt = Date.now();
  return businessLevelRulesCache;
}

function businessLevel(commentCount, likeCount, adminBonus = 0, interactionsPerLevel = DEFAULT_BUSINESS_LEVEL_RULES.interactionsPerLevel) {
  return Math.floor((Number(commentCount || 0) + Number(likeCount || 0)) / interactionsPerLevel) + 1 + Math.max(0, Number(adminBonus) || 0);
}

async function decoratePinsWithEngagement(pins, viewerId = null) {
  const [engagements, rules] = await Promise.all([
    db.getPinEngagement(pins.map(p => p.id), viewerId),
    getBusinessLevelRules(),
  ]);
  return pins.map(pin => {
    const engagement = engagements.get(Number(pin.id)) || { likeCount: 0, likedByViewer: false };
    const comments = pin.comments || [];
    return {
      ...pin,
      like_count: engagement.likeCount,
      liked_by_me: engagement.likedByViewer,
      level: businessLevel(comments.length, engagement.likeCount, pin.admin_level_bonus, rules.interactionsPerLevel),
    };
  });
}

app.get('/api/pins', async (req, res) => {
  const [pins, claims] = await Promise.all([db.getApprovedPins(), getClaims()]);
  const decoratedPins = await decoratePinsWithEngagement(pins, optionalViewerId(req));
  res.json(decoratedPins.map(p => ({
    ...p,
    verified: !!claims.verified[p.id],
    comments: (p.comments || []).map(stripIp),
  })));
});

// ── PUBLIC: Online & ziyaretçi sayacı ─────────────────────────
// Online sayısı bellekte tutulur: her sekme 30 sn'de bir sinyal gönderir,
// son 70 sn içinde sinyal göndermeyen sekme çevrimdışı sayılır.
const ONLINE_WINDOW_MS = 70 * 1000;
const MAX_PRESENCE     = 10000;
const presence = new Map(); // sekme id → son görülme zamanı

function countOnline() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  for (const [id, seen] of presence) {
    if (seen < cutoff) presence.delete(id);
  }
  return presence.size;
}

app.post('/api/presence', async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
    return res.status(400).json({ error: 'Geçersiz oturum' });
  }
  if (presence.has(id) || presence.size < MAX_PRESENCE) presence.set(id, Date.now());
  res.json({ online: countOnline(), visits: await db.getVisits() });
});

// Tarayıcı oturumu başına bir kez çağrılır
app.post('/api/visit', async (req, res) => {
  await db.incrementVisits();
  const visits = await db.getVisits();
  res.json({ visits });
  notifyNewVisitor(req, visits).catch(err => console.error('Telegram bildirimi gönderilemedi:', err.message));
});

// ── Yeni ziyaretçi → Telegram bildirimi ────────────────────────
// Bot bilgisi gizli depoda (telegram.json: { bot_token, chat_id }); koda ve GitHub'a yazılmaz.
const TG_CONFIG_FILE = 'telegram.json';
const TG_SAME_VISITOR_MS = 6 * 60 * 60 * 1000;   // aynı IP'ye 6 saatte bir bildirim
const TG_MAX_PER_HOUR = 30;
const IP_LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IP_LOCATION_CACHE_MAX = 2000;
let tgConfig;                                     // undefined: henüz okunmadı, null: ayarlı değil
const tgLastByIp = new Map();
const ipLocationCache = new Map();                 // IP → { value, expiresAt }
let tgHour = { at: 0, sent: 0, skipped: 0 };

async function getTelegramConfig() {
  if (tgConfig === undefined) tgConfig = await db.getPrivateJson(TG_CONFIG_FILE);
  return tgConfig;
}

const tgEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// IP konumu yaklaşık şehir/ülke bilgisidir; Telegram bildirimi gecikmesin diye
// başarısız lookup'lar sessizce atlanır ve başarılı sonuçlar 24 saat saklanır.
async function getIpLocation(ip) {
  const cached = ipLocationCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) ipLocationCache.delete(ip);

  try {
    // İlk servis cevap vermezse yedek servise sorulur
    let data = null;
    try {
      const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'NewHal-Visitor-Notification/1.0' },
      });
      const d = r.ok ? await r.json() : null;
      if (d && d.success) data = d;
    } catch {}
    if (!data) {
      try {
        const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country&lang=tr`, {
          signal: AbortSignal.timeout(4000),
        });
        const d = r.ok ? await r.json() : null;
        if (d && d.status === 'success') data = { city: d.city, region: d.regionName, country: d.country };
      } catch {}
    }
    if (!data) {
      console.warn('[ziyaret] konum bulunamadı:', ip);
      return null;
    }

    const location = [data.city, data.region, data.country]
      .map(value => String(value || '').trim())
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(', ');
    if (!location) return null;

    if (ipLocationCache.size >= IP_LOCATION_CACHE_MAX) ipLocationCache.delete(ipLocationCache.keys().next().value);
    ipLocationCache.set(ip, { value: location, expiresAt: Date.now() + IP_LOCATION_CACHE_TTL_MS });
    return location;
  } catch {
    return null;
  }
}

async function sendTelegram(html) {
  const cfg = await getTelegramConfig();
  if (!cfg || !cfg.bot_token || !cfg.chat_id) return false;
  const r = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(d.description || `HTTP ${r.status}`);
  return true;
}

async function notifyNewMember(user) {
  const time = new Date().toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  await sendTelegram([
    '🆕 <b>NewHal’e yeni üye katıldı</b>',
    '',
    `👤 ${tgEsc(user && user.name)}`,
    `🔢 Üye no: ${tgEsc(user && user.id)}`,
    `🕒 ${tgEsc(time)}`,
  ].join('\n'));
}

// Tarayıcı bilgisinden kısa cihaz tanımı: "📱 Android · Chrome"
function describeDevice(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Bilinmiyor';
  const app = /Instagram/.test(ua) ? 'Instagram içi' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook içi' : /WhatsApp/.test(ua) ? 'WhatsApp içi' : null;
  const browser = app || (/SamsungBrowser/.test(ua) ? 'Samsung İnternet' : /OPR|Opera/.test(ua) ? 'Opera' : /Edg\//.test(ua) ? 'Edge'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Diğer');
  const kind = /iPad|Tablet/.test(ua) ? '📟 Tablet' : /Mobi|iPhone|Android/.test(ua) ? '📱 Telefon' : '💻 Bilgisayar';
  return `${kind} · ${os} · ${browser}`;
}

function describeReferrer(ref) {
  if (!ref) return 'Doğrudan (adres yazarak ya da yer imiyle)';
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    if (/google\./.test(host)) return 'Google araması';
    if (/facebook|fb\.com|m\.facebook/.test(host)) return 'Facebook';
    if (/instagram/.test(host)) return 'Instagram';
    if (/whatsapp|wa\.me/.test(host)) return 'WhatsApp';
    if (/t\.co$|twitter|x\.com/.test(host)) return 'X (Twitter)';
    if (/^newhal\.com$|newhal\.onrender\.com/.test(host)) return 'Site içi';
    return host;
  } catch {
    return 'Bilinmiyor';
  }
}

async function notifyNewVisitor(req, visits) {
  const info = (req.body && typeof req.body === 'object') ? req.body : {};
  if (info.admin) return;                                   // yöneticinin kendi girişi
  const ua = req.headers['user-agent'] || '';
  if (/bot|crawl|spider|preview|facebookexternalhit|headless/i.test(ua)) return;
  const ip = String(getIp(req)).split(',')[0].trim();
  const now = Date.now();
  if (now - (tgLastByIp.get(ip) || 0) < TG_SAME_VISITOR_MS) return;
  tgLastByIp.set(ip, now);
  if (now - tgHour.at > 60 * 60 * 1000) tgHour = { at: now, sent: 0, skipped: 0 };
  if (tgHour.sent >= TG_MAX_PER_HOUR) { tgHour.skipped++; return; }

  // Giriş yapmış kullanıcının adı (varsa)
  let who = null;
  const auth = req.headers.authorization;
  if (auth) { try { who = jwt.verify(auth.split(' ')[1], JWT_SECRET).name; } catch {} }

  const page = String(info.page || '/').slice(0, 200);
  const ilan = (page.match(/[?&]ilan=([0-9a-f-]{36})/i) || [])[1];
  let pageText = page === '/' ? 'Ana sayfa' : page;
  if (ilan) {
    const ad = (await db.getAds()).find(a => a.id === ilan);
    if (ad) pageText = `İlan #${ad.no} · ${(ad.title || ad.body || '').split('\n')[0].slice(0, 50)}`;
  }
  const location = await getIpLocation(ip);
  const time = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const lines = [
    `👋 <b>NewHal'e yeni ziyaretçi</b> · #${tgEsc(visits)}. ziyaret`,
    '',
    `🕒 ${tgEsc(time)}`,
    `🌐 IP: <code>${tgEsc(ip)}</code> · <a href="https://ipinfo.io/${encodeURIComponent(ip)}">konumu gör</a>`,
    location ? `📍 Konum: ${tgEsc(location)}` : null,
    `${tgEsc(describeDevice(ua))}${info.app ? ' · 📲 uygulamadan' : ''}`,
    `↪️ Geldiği yer: ${tgEsc(describeReferrer(info.referrer))}`,
    info.referrer ? `🔙 Geldiği adres: ${tgEsc(String(info.referrer).slice(0, 300))}` : null,
    `🔗 Girdiği link: ${tgEsc('https://newhal.com' + page)}`,
    `📄 Açtığı sayfa: ${tgEsc(pageText)}`,
  ].filter(line => line !== null);
  if (info.screen) lines.push(`🖥 Ekran: ${tgEsc(String(info.screen).slice(0, 15))}${info.lang ? ` · Dil: ${tgEsc(String(info.lang).slice(0, 10))}` : ''}`);
  if (who) lines.push(`👤 Giriş yapmış: ${tgEsc(who)}`);
  if (tgHour.skipped) { lines.push('', `ℹ️ Son bir saatte ${tgHour.skipped} ziyaretçi daha bildirim sınırı yüzünden atlandı.`); tgHour.skipped = 0; }
  tgHour.sent++;
  await sendTelegram(lines.join('\n'));
}

// Eski IP kayıtlarını temizle
setInterval(() => {
  const cutoff = Date.now() - TG_SAME_VISITOR_MS;
  for (const [ip, at] of tgLastByIp) if (at < cutoff) tgLastByIp.delete(ip);
}, 60 * 60 * 1000).unref();

// ── Konumdan adres bulma (OpenStreetMap Nominatim) ────────────
// Nominatim kuralları: saniyede en fazla 1 istek, uygulama adı belirtilir, sonuçlar saklanır.
const GEO_CACHE_MAX = 1000;
const GEO_PER_IP_MIN = 20;
const geoCache = new Map();          // "36.82940,34.65724" → adres
const geoByIp = new Map();           // IP → son bir dakikadaki istek zamanları
let geoQueue = Promise.resolve();
let geoLastAt = 0;

function formatOsmAddress(d) {
  const a = (d && d.address) || {};
  const street = a.road ? `${a.road}${a.house_number ? ` No:${a.house_number}` : ''}` : '';
  const place = d.name && d.name !== a.road ? d.name : '';
  const area = a.neighbourhood || a.suburb || a.quarter || a.village || '';
  const district = a.town || a.county || a.city_district || '';
  const province = a.province || a.city || a.state || '';
  const tail = [a.postcode, [district, province].filter((v, i, arr) => v && arr.indexOf(v) === i).join('/')].filter(Boolean).join(' ');
  const parts = [place, street, area, tail].filter(Boolean);
  return parts.filter((p, i) => parts.indexOf(p) === i).join(', ').slice(0, 250);
}

function osmReverse(lat, lng) {
  // İstekler sıraya girer, aralarında en az 1,1 saniye olur
  const run = geoQueue.then(async () => {
    const wait = 1100 - (Date.now() - geoLastAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    geoLastAt = Date.now();
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=tr`;
    const r = await fetch(url, { headers: { 'User-Agent': 'NewHal/1.0 (https://newhal.com)' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  geoQueue = run.catch(() => {});
  return run;
}

app.get('/api/geocode/reverse', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Geçersiz konum' });
  }
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (geoCache.has(key)) return res.json({ address: geoCache.get(key) });

  const ip = String(getIp(req)).split(',')[0].trim();
  const minuteAgo = Date.now() - 60 * 1000;
  const recent = (geoByIp.get(ip) || []).filter(t => t > minuteAgo);
  if (recent.length >= GEO_PER_IP_MIN) return res.status(429).json({ error: 'Çok sık istek, biraz bekleyin' });
  recent.push(Date.now());
  geoByIp.set(ip, recent);

  try {
    const address = formatOsmAddress(await osmReverse(lat.toFixed(6), lng.toFixed(6)));
    if (geoCache.size >= GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
    geoCache.set(key, address);
    res.json({ address });
  } catch (err) {
    console.error('Adres bulunamadı:', err.message);
    res.status(502).json({ error: 'Adres bulunamadı' });
  }
});

setInterval(() => {
  const minuteAgo = Date.now() - 60 * 1000;
  for (const [ip, times] of geoByIp) if (!times.some(t => t > minuteAgo)) geoByIp.delete(ip);
}, 10 * 60 * 1000).unref();

// ── PUBLIC: Yeni iğne ekle (onay bekliyor) ───────────────────
app.post('/api/pins', requireAuth, async (req, res) => {
  const { title, address, phone, website, email, lat, lng, category } = req.body;
  if (!title || !address || !lat || !lng) {
    return res.status(400).json({ error: 'Ünvan, adres ve konum zorunlu' });
  }
  const pin = await db.addPin({
    title, address, phone, website, email, lat, lng, category,
    sells: cleanProducts(req.body.sells),
    seeks: cleanProducts(req.body.seeks),
    images: cleanImages(req.body.images),
    ownerId: req.user.role === 'user' ? req.user.id : null,
  });
  res.status(201).json({ id: pin.id, message: 'İğne başarıyla gönderildi, onay bekleniyor.' });
});

// ── Ürünler & Fotoğraflar ─────────────────────────────────────
const MAX_PRODUCTS     = 30;
const MAX_PRODUCT_LEN  = 40;
const MAX_IMAGES       = 5;
const MAX_IMAGE_BYTES  = 2 * 1024 * 1024;
const UPLOADS_PER_HOUR = 30;

// Dizi ya da virgülle ayrılmış metin kabul eder; boşları ve tekrarları atar
function cleanProducts(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const item = String(raw).trim().slice(0, MAX_PRODUCT_LEN);
    const key = item.toLocaleLowerCase('tr-TR');
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_PRODUCTS) break;
  }
  return out;
}

// Sadece kendi fotoğraf depomuzdaki adresler kabul edilir
function cleanImages(input) {
  if (!Array.isArray(input)) return [];
  const prefix = db.pinImageUrlPrefix();
  return [...new Set(input.filter(u => typeof u === 'string' && u.startsWith(prefix) && !u.includes('..')))]
    .slice(0, MAX_IMAGES);
}

function detectImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

const uploadLog = new Map(); // kullanıcı → son bir saatteki yükleme zamanları

app.post('/api/uploads', express.json({ limit: '3mb' }), requireAuth, async (req, res) => {
  const who = String(req.user.id || req.user.username || 'anon');
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = (uploadLog.get(who) || []).filter(t => t > hourAgo);
  if (recent.length >= UPLOADS_PER_HOUR) {
    return res.status(429).json({ error: 'Çok fazla fotoğraf yüklediniz, biraz sonra tekrar deneyin' });
  }

  const match = /^data:image\/[a-z]+;base64,(.+)$/.exec(String((req.body && req.body.data) || ''));
  if (!match) return res.status(400).json({ error: 'Geçersiz fotoğraf' });
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'Fotoğraf en fazla 2 MB olabilir' });
  const kind = detectImageType(buffer);
  if (!kind) return res.status(400).json({ error: 'Sadece JPG, PNG veya WEBP yüklenebilir' });

  const filePath = `${who.replace(/[^a-zA-Z0-9_-]/g, '')}/${Date.now()}-${crypto.randomUUID()}.${kind.ext}`;
  const url = await db.uploadPinImage(filePath, buffer, kind.type);
  if (!url) return res.status(500).json({ error: 'Fotoğraf yüklenemedi' });

  recent.push(Date.now());
  uploadLog.set(who, recent);
  res.status(201).json({ url });
});

// İşletme sahibi (ekleyen kişi) veya admin ürünleri ve fotoğrafları günceller
app.put('/api/pins/:id/catalog', requireAuth, async (req, res) => {
  const pin = await db.getPin(req.params.id);
  if (!pin) return res.status(404).json({ error: 'İşletme bulunamadı' });
  const isAdmin = req.user.role === 'admin';
  const isOwner = req.user.role === 'user' && pin.owner_id && pin.owner_id === req.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Bu işletmeyi sadece ekleyen kişi düzenleyebilir' });

  const images = cleanImages(req.body.images);
  const updated = await db.updatePinCatalog(pin.id, {
    sells: cleanProducts(req.body.sells),
    seeks: cleanProducts(req.body.seeks),
    images,
  });
  if (!updated) return res.status(500).json({ error: 'Güncellenemedi' });
  await db.deletePinImages((pin.images || []).filter(u => !images.includes(u)));
  res.json({ message: 'Ürünler ve fotoğraflar güncellendi', pin: updated });
});

// İşletme sahibi veya admin dükkan bilgilerini günceller (konum sadece admin panelinden)
app.put('/api/pins/:id/info', requireAuth, async (req, res) => {
  const pin = await db.getPin(req.params.id);
  if (!pin) return res.status(404).json({ error: 'İşletme bulunamadı' });
  const isAdmin = req.user.role === 'admin';
  const isOwner = req.user.role === 'user' && pin.owner_id && pin.owner_id === req.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Bu dükkanı sadece sahibi düzenleyebilir' });

  const field = (name, max) => String(req.body[name] || '').trim().slice(0, max);
  const title = field('title', 120), address = field('address', 250);
  if (!title || !address) return res.status(400).json({ error: 'Dükkan adı ve adres boş olamaz' });
  const categories = await db.getCategories();
  const category = categories.some(c => c.name === req.body.category) ? req.body.category : pin.category;

  const updated = await db.updatePin(pin.id, {
    title, address, category,
    phone: field('phone', 40), website: field('website', 200), email: field('email', 120),
    lat: pin.lat, lng: pin.lng,
  });
  if (!updated) return res.status(500).json({ error: 'Güncellenemedi' });
  res.json({ message: 'Dükkan bilgileri güncellendi', pin: updated });
});

// ── "Bu dükkan benim": sahiplenme istekleri ───────────────────
// Gizli depoda tutulur (claims.json): { requests: [...], verified: { pinId: { userId, name, at } } }
const CLAIMS_FILE = 'claims.json';
const MAX_OPEN_CLAIMS = 3;          // bir kişinin aynı anda bekleyen isteği
let claimsCache = null;

async function getClaims() {
  if (!claimsCache) {
    const data = await db.getPrivateJson(CLAIMS_FILE);
    claimsCache = {
      requests: Array.isArray(data && data.requests) ? data.requests : [],
      verified: (data && data.verified && typeof data.verified === 'object') ? data.verified : {},
    };
  }
  return claimsCache;
}

async function saveClaims(claims) {
  claims.requests = claims.requests.slice(-1000);
  claimsCache = claims;
  return db.savePrivateJson(CLAIMS_FILE, claims);
}

app.post('/api/pins/:id/claim', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Sahiplenmek için Google ile giriş yapın' });
  const pin = await db.getPin(req.params.id);
  if (!pin || pin.status !== 'approved') return res.status(404).json({ error: 'İşletme bulunamadı' });

  const phone = String(req.body.phone || '').trim().slice(0, 40);
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Size ulaşabileceğimiz bir telefon numarası yazın' });

  const claims = await getClaims();
  if (claims.verified[pin.id]) {
    return res.status(409).json({ error: claims.verified[pin.id].userId === req.user.id ? 'Bu dükkan zaten sizin' : 'Bu dükkanın onaylı bir sahibi var. Yanlışlık varsa hata bildirin.' });
  }
  const open = claims.requests.filter(r => r.userId === req.user.id && r.status === 'pending');
  if (open.some(r => r.pinId === pin.id)) return res.status(409).json({ error: 'Bu dükkan için isteğiniz zaten inceleniyor' });
  if (open.length >= MAX_OPEN_CLAIMS) return res.status(429).json({ error: 'İncelenen isteğiniz çok, önce onlar sonuçlansın' });

  const request = {
    id: crypto.randomUUID(), pinId: pin.id, pinTitle: pin.title,
    userId: req.user.id, userName: req.user.name || '', userEmail: req.user.email || '',
    phone, note, status: 'pending', createdAt: new Date().toISOString(),
  };
  claims.requests.push(request);
  if (!await saveClaims(claims)) return res.status(500).json({ error: 'İstek kaydedilemedi, tekrar deneyin' });
  res.status(201).json({ message: 'İsteğiniz alındı', request: { pinId: request.pinId, status: request.status } });

  sendTelegram([
    '🏷️ <b>Yeni dükkan sahiplenme isteği</b>',
    '',
    `🏪 ${tgEsc(pin.title)}`,
    `👤 ${tgEsc(request.userName)} · ${tgEsc(request.userEmail)}`,
    `📞 ${tgEsc(phone)}`,
    note ? `📝 ${tgEsc(note)}` : null,
    '',
    'Onaylamak için: yönetim paneli → Dükkan Sahipleri',
  ].filter(l => l !== null).join('\n')).catch(err => console.error('Telegram bildirimi gönderilemedi:', err.message));
});

app.get('/api/my-claims', requireAuth, async (req, res) => {
  const claims = await getClaims();
  res.json(claims.requests
    .filter(r => r.userId === req.user.id)
    .map(r => ({ pinId: r.pinId, status: r.status, reason: r.reason || '', createdAt: r.createdAt })));
});

app.get('/api/admin/claims', requireAdmin, async (req, res) => {
  const claims = await getClaims();
  const verified = Object.entries(claims.verified).map(([pinId, v]) => ({ pinId: Number(pinId), ...v }));
  res.json({ requests: [...claims.requests].reverse(), verified });
});

app.patch('/api/admin/claims/:id/approve', requireAdmin, async (req, res) => {
  const claims = await getClaims();
  const request = claims.requests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'İstek bulunamadı' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Bu istek zaten sonuçlanmış' });
  const pin = await db.setPinOwner(request.pinId, request.userId);
  if (!pin) return res.status(404).json({ error: 'Dükkan sahibi atanamadı (dükkan ya da kullanıcı silinmiş olabilir)' });

  const now = new Date().toISOString();
  request.status = 'approved';
  request.reviewedAt = now;
  claims.verified[request.pinId] = { title: request.pinTitle, userId: request.userId, name: request.userName, email: request.userEmail, phone: request.phone, at: now };
  for (const r of claims.requests) {
    if (r !== request && r.pinId === request.pinId && r.status === 'pending') {
      Object.assign(r, { status: 'rejected', reason: 'Dükkan başka bir sahibe verildi', reviewedAt: now });
    }
  }
  await saveClaims(claims);
  await db.logActivity(`'${pin.title}' dükkanı ${request.userName} adına onaylandı`, true);
  res.json({ message: 'Dükkan sahibi onaylandı' });
});

app.patch('/api/admin/claims/:id/reject', requireAdmin, async (req, res) => {
  const claims = await getClaims();
  const request = claims.requests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'İstek bulunamadı' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Bu istek zaten sonuçlanmış' });
  Object.assign(request, { status: 'rejected', reason: String(req.body.reason || '').trim().slice(0, 200), reviewedAt: new Date().toISOString() });
  await saveClaims(claims);
  res.json({ message: 'İstek reddedildi' });
});

// Onaylı sahipliği kaldırır: rozet gider, dükkan sahipsiz kalır
app.delete('/api/admin/claims/verified/:pinId', requireAdmin, async (req, res) => {
  const claims = await getClaims();
  const pinId = Number(req.params.pinId);
  if (!claims.verified[pinId]) return res.status(404).json({ error: 'Bu dükkanın onaylı sahibi yok' });
  delete claims.verified[pinId];
  await saveClaims(claims);
  await db.setPinOwner(pinId, null);
  res.json({ message: 'Sahiplik kaldırıldı' });
});

// ── ADMIN: Tüm iğneleri getir ─────────────────────────────────
app.get('/api/admin/pins', requireAdmin, async (req, res) => {
  const pins = await db.getPins(req.query.status || null);
  res.json(await decoratePinsWithEngagement(pins));
});

app.get('/api/admin/business-level-rules', requireAdmin, async (req, res) => {
  res.json(await getBusinessLevelRules());
});

app.put('/api/admin/business-level-rules', requireAdmin, async (req, res) => {
  const interactionsPerLevel = Number(req.body && req.body.interactionsPerLevel);
  if (!Number.isInteger(interactionsPerLevel) || interactionsPerLevel < 1 || interactionsPerLevel > 10000) {
    return res.status(400).json({ error: 'Seviye için etkileşim sayısı 1 ile 10.000 arasında tam sayı olmalı' });
  }
  const rules = { interactionsPerLevel };
  if (!(await db.savePrivateJson('business-level-rules.json', rules))) {
    return res.status(500).json({ error: 'Seviye kuralı kaydedilemedi' });
  }
  businessLevelRulesCache = rules;
  businessLevelRulesCacheAt = Date.now();
  res.json(rules);
});

app.patch('/api/admin/pins/:id/level', requireAdmin, async (req, res) => {
  const pin = await db.getPin(req.params.id);
  if (!pin || pin.status !== 'approved') return res.status(404).json({ error: 'İşletme bulunamadı' });
  const { bonus, error } = await db.adjustPinLevelBonus(pin.id, 1);
  if (error) return res.status(500).json({ error: 'İşletme seviyesi artırılamadı' });
  const [updatedPin] = await decoratePinsWithEngagement([{ ...pin, admin_level_bonus: Number(bonus) || 0 }]);
  res.json({ id: pin.id, level: updatedPin.level, admin_level_bonus: updatedPin.admin_level_bonus });
});

// ── ADMIN: İğne onayla ───────────────────────────────────────
app.patch('/api/admin/pins/:id/approve', requireAdmin, async (req, res) => {
  const pin = await db.approvePin(req.params.id);
  if (!pin) return res.status(404).json({ error: 'İğne bulunamadı' });
  res.json({ message: 'İğne onaylandı' });
});

// ── ADMIN: İğne reddet ───────────────────────────────────────
app.patch('/api/admin/pins/:id/reject', requireAdmin, async (req, res) => {
  const pin = await db.rejectPin(req.params.id, req.body.reason || '');
  if (!pin) return res.status(404).json({ error: 'İğne bulunamadı' });
  res.json({ message: 'İğne reddedildi' });
});

// ── ADMIN: İğne sil ──────────────────────────────────────────
app.delete('/api/admin/pins/:id', requireAdmin, async (req, res) => {
  const ok = await db.deletePin(req.params.id);
  if (!ok) return res.status(404).json({ error: 'İğne bulunamadı' });
  res.json({ message: 'İğne silindi' });
});

// ── ADMIN: İğne güncelle ─────────────────────────────────────
app.put('/api/admin/pins/:id', requireAdmin, async (req, res) => {
  const { title, address, phone, website, email, category, lat, lng } = req.body;
  if (!title || !address || !lat || !lng) {
    return res.status(400).json({ error: 'Ünvan, adres ve konum zorunlu' });
  }
  const pin = await db.updatePin(req.params.id, { title, address, phone, website, email, category, lat, lng });
  if (!pin) return res.status(404).json({ error: 'İğne bulunamadı' });
  res.json({ message: 'İğne güncellendi', pin });
});

// ── ADMIN: İstatistik ─────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  res.json(await db.getStats());
});

// ── PUBLIC: Dinamik Kategoriler ──────────────────────────────
app.get('/api/categories', async (req, res) => {
  res.json(await db.getCategories());
});

app.post('/api/categories', requireAuth, async (req, res) => {
  const { name, icon } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Kategori adı zorunlu' });
  }
  const iconLength = typeof icon === 'string' ? icon.trim().length : 0;
  if (name.trim().length > 40 || iconLength > 32) {
    return res.status(400).json({ error: 'Kategori adı en fazla 40, emoji en fazla 32 karakter olabilir' });
  }
  const result = await db.addCategory({ name, icon });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json(result);
});

// ── ADMIN: Kategori Sil ───────────────────────────────────────
app.delete('/api/admin/categories/:name', requireAdmin, async (req, res) => {
  const result = await db.deleteCategory(req.params.name);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ message: 'Kategori silindi' });
});

// ── ADMIN: Kategori Güncelle ──────────────────────────────────
app.put('/api/admin/categories/:name', requireAdmin, async (req, res) => {
  const { name, icon } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Kategori adı zorunlu' });
  }
  const iconLength = typeof icon === 'string' ? icon.trim().length : 0;
  if (name.trim().length > 40 || iconLength > 32) {
    return res.status(400).json({ error: 'Kategori adı en fazla 40, emoji en fazla 32 karakter olabilir' });
  }
  const result = await db.updateCategory(req.params.name, { name, icon });
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ message: 'Kategori güncellendi', category: result });
});


// ── PUBLIC: Chat Endpoints ────────────────────────────────────
app.get('/api/chat', async (req, res) => {
  res.json((await db.getChatMessages()).map(stripIp));
});

function getIp(req) {
  let ip = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || req.ip || '127.0.0.1';
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    ip = '127.0.0.1';
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}

app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mesaj boş olamaz' });
  }
  const ip = getIp(req);
  const newMsg = await db.addChatMessage({
    nickname: req.user.name || 'Kullanıcı',
    ip,
    message: message.trim(),
  });
  res.status(201).json(stripIp(newMsg));
});

// ── PUBLIC: Yorum Ekleme ──────────────────────────────────────
app.post('/api/pins/:id/comments', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Yorum boş olamaz' });
  }
  const ip = getIp(req);
  const comment = await db.addPinComment(req.params.id, {
    nickname: req.user.name || 'Kullanıcı',
    ip,
    message: message.trim()
  });
  if (!comment) return res.status(404).json({ error: 'İşletme bulunamadı' });
  res.status(201).json(stripIp(comment));
});

// ── PUBLIC: İşletme beğenisi ──────────────────────────────────
app.post('/api/pins/:id/likes', requireAuth, async (req, res) => {
  const pin = await db.getPin(req.params.id);
  if (!pin || pin.status !== 'approved') return res.status(404).json({ error: 'İşletme bulunamadı' });
  if (Number(pin.owner_id) === Number(req.user.id)) {
    return res.status(400).json({ error: 'Kendi işletmenizi beğenemezsiniz' });
  }
  const { error } = await db.setPinLike(pin.id, req.user.id, true);
  if (error) return res.status(500).json({ error: 'Beğeni kaydedilemedi' });
  const [engagement, commentCount] = await Promise.all([
    db.getPinEngagement([pin.id], req.user.id),
    db.getPinCommentCount(pin.id),
  ]);
  const rules = await getBusinessLevelRules();
  const result = engagement.get(Number(pin.id)) || { likeCount: 0, likedByViewer: false };
  res.json({ liked: result.likedByViewer, like_count: result.likeCount, level: businessLevel(commentCount, result.likeCount, pin.admin_level_bonus, rules.interactionsPerLevel) });
});

app.delete('/api/pins/:id/likes', requireAuth, async (req, res) => {
  const pin = await db.getPin(req.params.id);
  if (!pin || pin.status !== 'approved') return res.status(404).json({ error: 'İşletme bulunamadı' });
  const { error } = await db.setPinLike(pin.id, req.user.id, false);
  if (error) return res.status(500).json({ error: 'Beğeni kaldırılamadı' });
  const [engagement, commentCount] = await Promise.all([
    db.getPinEngagement([pin.id], req.user.id),
    db.getPinCommentCount(pin.id),
  ]);
  const rules = await getBusinessLevelRules();
  const result = engagement.get(Number(pin.id)) || { likeCount: 0, likedByViewer: false };
  res.json({ liked: result.likedByViewer, like_count: result.likeCount, level: businessLevel(commentCount, result.likeCount, pin.admin_level_bonus, rules.interactionsPerLevel) });
});

// ── PUBLIC: Hata Bildirme ──────────────────────────────────────
app.post('/api/pins/:id/reports', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Bildirim içeriği boş olamaz' });
  }
  const ip = getIp(req);
  const report = await db.addReport({
    pinId: req.params.id,
    ip,
    message: message.trim()
  });
  res.status(201).json(stripIp(report || {}));
});

// ── ADMIN: Hata Bildirimlerini Listele ──────────────────────────
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  res.json(await db.getReports());
});

// ── ADMIN: Hata Bildirimini Sil ────────────────────────────────
app.delete('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  const ok = await db.deleteReport(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Bildirim bulunamadı' });
  res.json({ message: 'Bildirim silindi' });
});

// ── İlanlar (sadece admin ekler, herkes görür) ────────────────
const AD_TITLE_MAX   = 120;
const AD_BODY_MAX    = 2000;
const AD_MAX_IMAGES  = 5;
const AD_UPLOAD_RULES = {
  image: { types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, maxBytes: 5 * 1024 * 1024 },
  video: { types: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }, maxBytes: 50 * 1024 * 1024 },
};

// YouTube bağlantısından video kimliğini çıkarır (watch, youtu.be, shorts, embed)
function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// İlan metninin ilk dolu satırı başlık, kalanı metin olur
function splitAdText(title, body) {
  const lines = [String(title || ''), String(body || '')].join('\n').replace(/\r/g, '').split('\n');
  const first = lines.findIndex(l => /[\p{L}\p{N}]/u.test(l));   // süs çizgileri başlık olmaz
  if (first === -1) return { title: '', body: '' };
  return {
    title: lines[first].trim().slice(0, AD_TITLE_MAX),
    body: lines.slice(first + 1).join('\n').replace(/^\s*\n/, '').trim().slice(0, AD_BODY_MAX),
  };
}

function cleanAd(body, { allowVideoFile = true } = {}) {
  const { title, body: text } = splitAdText(body.title, body.body);
  const prefix = db.adMediaUrlPrefix();
  const prefixes = [prefix, db.pinImageUrlPrefix()];
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter(u => typeof u === 'string' && prefixes.some(pre => u.startsWith(pre)) && !u.includes('..'))
    .slice(0, AD_MAX_IMAGES);
  let video = null;
  if (allowVideoFile && body.video && body.video.type === 'file' && typeof body.video.url === 'string' && body.video.url.startsWith(prefix)) {
    video = { type: 'file', url: body.video.url };
  } else if (body.video && body.video.type === 'youtube') {
    const id = youtubeId(body.video.url);
    if (id) video = { type: 'youtube', id };
  }
  return { title, body: text, images, video };
}

// ── Vitrin süresi ──────────────────────────────────────────────
const FEATURED_DEFAULT_DAYS = 7;
const FEATURED_MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const featuredDays = v => Math.min(FEATURED_MAX_DAYS, Math.max(1, Math.round(Number(v) || FEATURED_DEFAULT_DAYS)));
const DEFAULT_AD_STORY_SETTINGS = Object.freeze({ enabled: true, days: 7, groupSize: 10 });
let adStorySettingsCache = { ...DEFAULT_AD_STORY_SETTINGS };
let adStorySettingsCacheAt = 0;

async function getAdStorySettings() {
  if (Date.now() - adStorySettingsCacheAt < 30_000) return adStorySettingsCache;
  try {
    const saved = await db.getPrivateJson('ad-story-settings.json');
    const days = Number(saved && saved.days);
    const groupSize = Number(saved && saved.groupSize);
    adStorySettingsCache = {
      enabled: saved && typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_AD_STORY_SETTINGS.enabled,
      days: Number.isInteger(days) && days >= 1 && days <= 30 ? days : DEFAULT_AD_STORY_SETTINGS.days,
      groupSize: Number.isInteger(groupSize) && groupSize >= 1 && groupSize <= 50 ? groupSize : DEFAULT_AD_STORY_SETTINGS.groupSize,
    };
  } catch (err) {
    console.error('Haftalık ilan hikayesi ayarları okunamadı:', err.message);
  }
  adStorySettingsCacheAt = Date.now();
  return adStorySettingsCache;
}

// Süresiz vitrin ilanına varsayılan süre verir, süresi dolanı vitrinden indirir; değişiklik olduysa kaydeder
async function getAdsWithFeaturedExpiry() {
  const ads = await db.getAds();
  const now = Date.now();
  let changed = false;
  for (const ad of ads) {
    if (ad.featured && !ad.featured_until) {
      ad.featured_until = new Date(now + FEATURED_DEFAULT_DAYS * DAY_MS).toISOString();
      changed = true;
    }
    if (ad.featured && Date.parse(ad.featured_until) <= now) {
      ad.featured = false;
      ad.featured_ended_at = ad.featured_until;
      delete ad.featured_until;
      changed = true;
    }
  }
  if (changed) await db.saveAds(ads);
  return ads;
}

// Vitrine koy ya da süresini uzat: bitiş, (şimdi ya da mevcut bitiş) + gün
function setFeatured(ad, on, days) {
  if (!on) {
    ad.featured = false;
    delete ad.featured_until;
    return;
  }
  const from = ad.featured && ad.featured_until ? Math.max(Date.now(), Date.parse(ad.featured_until)) : Date.now();
  ad.featured = true;
  ad.featured_until = new Date(from + featuredDays(days) * DAY_MS).toISOString();
}

// ── Dükkan hikayesi: işletmenin ilanı 24 saat haritada dükkanın üzerinde görünür ──
const STORY_MS = DAY_MS;

// İlanı dükkana bağlar (ya da bağı kaldırır); dükkan değiştiyse 24 saat yeniden başlar
function setAdStory(ad, pin) {
  if (!pin) {
    delete ad.pinId;
    delete ad.story_until;
    return;
  }
  if (ad.pinId === pin.id && ad.story_until) return;
  ad.pinId = pin.id;
  ad.story_until = new Date(Date.now() + STORY_MS).toISOString();
}

// Kullanıcı yalnız kendi dükkanını seçebilir; seçmediyse ilk dükkanı kullanılır
async function userStoryPin(userId, requested) {
  if (requested === 0 || requested === '0' || requested === 'none') return null;
  const mine = await db.getPinsByOwner(userId);
  if (!mine.length) return null;
  return mine.find(p => p.id === Number(requested)) || mine[0];
}

async function adminStoryPin(requested) {
  if (!requested) return null;
  const pin = await db.getPin(requested);
  return pin && pin.status === 'approved' ? pin : null;
}

const adMedia = ad => [...(ad.images || []), ad.video && ad.video.type === 'file' ? ad.video.url : null];

// İlanın resim/video dosyalarını hangi depodaysa oradan siler
async function deleteAdFiles(ad) {
  const files = adMedia(ad).filter(Boolean);
  await db.deleteAdMedia(files);
  await db.deletePinImages(files);
}

// Herkese açık ilan: ekleyenin hesap kimliği gösterilmez
const publicAd = ({ owner, ...ad }) => (owner ? { ...ad, owner_name: owner.name, owner_id: owner.id } : ad);

// İlan etkileşimleri ilanların kendisi gibi özel veri deposunda tutulur. Böylece
// ilanlar için yeni bir SQL migration gerekmez ve eski ilanlar da desteklenir.
const AD_INTERACTIONS_FILE = 'ad-interactions.json';
const AD_COMMENT_MAX_LENGTH = 500;
let adInteractionsCache = null;

async function getAdInteractions() {
  if (adInteractionsCache) return adInteractionsCache;
  const saved = await db.getPrivateJson(AD_INTERACTIONS_FILE);
  adInteractionsCache = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return adInteractionsCache;
}

async function saveAdInteractions(interactions) {
  adInteractionsCache = interactions;
  if (!(await db.savePrivateJson(AD_INTERACTIONS_FILE, interactions))) {
    throw new Error('İlan etkileşimleri kaydedilemedi');
  }
}

function adEngagement(ad, interactions, viewerId) {
  const entry = interactions[ad.id] || {};
  const likes = entry.likes && typeof entry.likes === 'object' ? entry.likes : {};
  const comments = Array.isArray(entry.comments) ? entry.comments : [];
  return {
    ...ad,
    like_count: Object.keys(likes).length,
    liked_by_me: !!(viewerId && likes[String(viewerId)]),
    comments: comments.map(comment => ({
      id: comment.id, name: comment.name || 'Kullanıcı', message: comment.message,
      created_at: comment.created_at,
    })),
  };
}

async function publicAdsWithEngagement(ads, viewerId) {
  const interactions = await getAdInteractions();
  return ads.map(ad => ad.weather ? ad : adEngagement(ad, interactions, viewerId));
}

async function activeAdForEngagement(id) {
  const ads = await getAdsWithFeaturedExpiry();
  return ads.find(ad => ad.id === id && ad.active !== false && !ad.pending);
}

// Mersin Hal için her gün otomatik hava durumu hikayesi.
const WEATHER_TZ = 'Europe/Istanbul';
let mersinWeatherStory = null;
let mersinWeatherLoading = null;
let mersinWeatherLastAttempt = 0;

function localWeatherDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WEATHER_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function weatherDescription(code) {
  const value = String(code || '').toLowerCase();
  if (value.includes('thunder')) return ['Gök gürültülü fırtına', '⛈️'];
  if (value.includes('snow') || value.includes('sleet')) return ['Karlı', '🌨️'];
  if (value.includes('rain') || value.includes('shower')) return ['Yağmurlu', '🌧️'];
  if (value.includes('fog')) return ['Sisli', '🌫️'];
  if (value.includes('partlycloudy')) return ['Parçalı bulutlu', '⛅'];
  if (value.includes('cloudy')) return ['Bulutlu', '☁️'];
  if (value.startsWith('fair')) return ['Az bulutlu', '🌤️'];
  if (value.startsWith('clearsky')) return ['Açık', '☀️'];
  return ['Hava durumu', '🌤️'];
}

// Görsel kartın ikon türü (istemcideki çizimlerle aynı adlar)
function weatherKind(code) {
  const value = String(code || '').toLowerCase();
  if (value.includes('thunder')) return 'storm';
  if (value.includes('snow') || value.includes('sleet')) return 'snow';
  if (value.includes('rain') || value.includes('shower')) return 'rain';
  if (value.includes('fog')) return 'fog';
  if (value.includes('partlycloudy') || value.startsWith('fair')) return 'partly';
  if (value.includes('cloudy')) return 'cloudy';
  if (value.startsWith('clearsky')) return 'clear';
  return 'partly';
}

async function loadMersinWeatherStory() {
  const day = localWeatherDay();
  if (mersinWeatherStory && mersinWeatherStory.weather.date === day) return mersinWeatherStory;
  if (mersinWeatherLoading) return mersinWeatherLoading;
  if (Date.now() - mersinWeatherLastAttempt < 5 * 60 * 1000) return null;
  mersinWeatherLastAttempt = Date.now();
  mersinWeatherLoading = (async () => {
    const pins = await db.getApprovedPins();
    const pin = pins.find(item => String(item.title || '').trim().toLocaleLowerCase('tr-TR') === 'mersin hal');
    if (!pin) throw new Error('Mersin Hal işletmesi bulunamadı');
    const params = new URLSearchParams({ lat: Number(pin.lat).toFixed(4), lon: Number(pin.lng).toFixed(4) });
    const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?${params}`, {
      headers: { 'User-Agent': 'NewHal/1.0 (https://newhal.com)' }, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Hava durumu servisi ${response.status} yanıtı verdi`);
    const forecast = await response.json();
    const timeseries = forecast.properties && forecast.properties.timeseries;
    const todayPoints = Array.isArray(timeseries) ? timeseries.filter(point => localWeatherDay(new Date(point.time)) === day) : [];
    const temperatures = todayPoints.map(point => Number(point.data?.instant?.details?.air_temperature)).filter(Number.isFinite);
    if (!todayPoints.length || !temperatures.length) {
      throw new Error('Günlük hava tahmini eksik geldi');
    }
    const midday = todayPoints.reduce((best, point) => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: WEATHER_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(point.time)));
      const bestHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: WEATHER_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(best.time)));
      return Math.abs(hour - 12) < Math.abs(bestHour - 12) ? point : best;
    });
    const middayDetails = midday.data?.next_1_hours || midday.data?.next_6_hours || midday.data?.next_12_hours;
    const [description, icon] = weatherDescription(middayDetails?.summary?.symbol_code);
    const formattedDate = new Intl.DateTimeFormat('tr-TR', { timeZone: WEATHER_TZ, day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00+03:00`));
    const winds = todayPoints.map(point => Number(point.data?.instant?.details?.wind_speed)).filter(Number.isFinite);
    // Görsel kart için: günün hava tipi ve 06–21 arası 3 saatte bir sıcaklık
    const pointHour = point => Number(new Intl.DateTimeFormat('en-GB', { timeZone: WEATHER_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(point.time)));
    const pointSymbol = point => (point.data?.next_1_hours || point.data?.next_6_hours || point.data?.next_12_hours)?.summary?.symbol_code;
    const hours = todayPoints
      .filter(point => { const h = pointHour(point); return h >= 6 && h <= 21 && h % 3 === 0; })
      .map(point => ({ hour: pointHour(point), temp: Math.round(Number(point.data?.instant?.details?.air_temperature)), kind: weatherKind(pointSymbol(point)) }))
      .filter(item => Number.isFinite(item.temp))
      .slice(0, 6);
    const weather = {
      date: day, formattedDate, description, icon, kind: weatherKind(middayDetails?.summary?.symbol_code),
      high: Math.round(Math.max(...temperatures)), low: Math.round(Math.min(...temperatures)),
      wind: winds.length ? Math.round(Math.max(...winds) * 3.6) : null,
      hours
    };
    const nextMidnight = new Date(new Date(`${day}T21:00:00.000Z`).getTime() + DAY_MS);
    mersinWeatherStory = {
      id: `mersin-weather-${day}`, pinId: pin.id, created_at: new Date().toISOString(), story_until: nextMidnight.toISOString(),
      active: true, featured: true, title: 'Mersin Günlük Hava Durumu',
      body: `${description} · En yüksek ${weather.high}°C, en düşük ${weather.low}°C${weather.wind === null ? '' : ` · En yüksek rüzgâr ${weather.wind} km/sa`} · Tahmin düzenlenmiştir · MET Norway, CC BY 4.0`,
      images: [], weather
    };
    return mersinWeatherStory;
  })().catch(err => {
    console.error('Mersin hava durumu hikayesi hazırlanamadı:', err.message);
    return null;
  }).finally(() => { mersinWeatherLoading = null; });
  return mersinWeatherLoading;
}

function scheduleMersinWeatherRefresh() {
  const day = localWeatherDay();
  // Türkiye saatiyle 00.05'te yeni günlük hikayeyi hazırla.
  const next = new Date(`${day}T21:05:00.000Z`).getTime();
  const delay = Math.max(1000, next - Date.now());
  setTimeout(async () => {
    mersinWeatherStory = null;
    mersinWeatherLastAttempt = 0;
    await loadMersinWeatherStory();
    scheduleMersinWeatherRefresh();
  }, delay).unref?.();
}

app.get('/api/ad-story-settings', async (req, res) => {
  res.json(await getAdStorySettings());
});

app.get('/api/ads', async (req, res) => {
  const ads = (await getAdsWithFeaturedExpiry()).filter(a => a.active !== false && !a.pending);
  const weatherStory = await loadMersinWeatherStory();
  if (weatherStory && Date.parse(weatherStory.story_until) > Date.now()) ads.push(weatherStory);
  const withEngagement = await publicAdsWithEngagement(ads, optionalViewerId(req));
  res.json(withEngagement.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicAd));
});

app.post('/api/ads/:id/likes', requireAuth, async (req, res) => {
  const ad = await activeAdForEngagement(req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  if (ad.owner && String(ad.owner.id) === String(req.user.id)) return res.status(400).json({ error: 'Kendi ilanınızı beğenemezsiniz' });
  try {
    const interactions = await getAdInteractions();
    const entry = interactions[ad.id] || { likes: {}, comments: [] };
    entry.likes = entry.likes && typeof entry.likes === 'object' ? entry.likes : {};
    entry.likes[String(req.user.id)] = { name: req.user.name || 'Kullanıcı', created_at: new Date().toISOString() };
    interactions[ad.id] = entry;
    await saveAdInteractions(interactions);
    const reward = await awardEconomyPoints(req.user.id, 'ad_like', `ad-like:${ad.id}:${req.user.id}`);
    res.json({ liked: true, like_count: Object.keys(entry.likes).length, points_awarded: reward.amount });
  } catch (err) {
    console.error('İlan beğenisi kaydedilemedi:', err.message);
    res.status(500).json({ error: 'Beğeni kaydedilemedi' });
  }
});

app.delete('/api/ads/:id/likes', requireAuth, async (req, res) => {
  const ad = await activeAdForEngagement(req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  try {
    const interactions = await getAdInteractions();
    const entry = interactions[ad.id] || { likes: {}, comments: [] };
    entry.likes = entry.likes && typeof entry.likes === 'object' ? entry.likes : {};
    delete entry.likes[String(req.user.id)];
    interactions[ad.id] = entry;
    await saveAdInteractions(interactions);
    res.json({ liked: false, like_count: Object.keys(entry.likes).length });
  } catch (err) {
    console.error('İlan beğenisi silinemedi:', err.message);
    res.status(500).json({ error: 'Beğeni geri alınamadı' });
  }
});

app.post('/api/ads/:id/comments', requireAuth, async (req, res) => {
  const ad = await activeAdForEngagement(req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  const message = String(req.body?.message || '').trim();
  if (!message || message.length > AD_COMMENT_MAX_LENGTH) {
    return res.status(400).json({ error: `Yorum 1 ile ${AD_COMMENT_MAX_LENGTH} karakter arasında olmalı` });
  }
  try {
    const interactions = await getAdInteractions();
    const entry = interactions[ad.id] || { likes: {}, comments: [] };
    entry.comments = Array.isArray(entry.comments) ? entry.comments : [];
    const comment = { id: crypto.randomUUID(), name: req.user.name || 'Kullanıcı', message, created_at: new Date().toISOString() };
    entry.comments.unshift(comment);
    interactions[ad.id] = entry;
    await saveAdInteractions(interactions);
    const reward = await awardEconomyPoints(req.user.id, 'ad_comment', `ad-comment:${comment.id}`);
    res.status(201).json({ comment, comment_count: entry.comments.length, points_awarded: reward.amount });
  } catch (err) {
    console.error('İlan yorumu kaydedilemedi:', err.message);
    res.status(500).json({ error: 'Yorum kaydedilemedi' });
  }
});

// ── Kullanıcı ilanları: giriş yapan herkes verebilir, hemen yayınlanır (yönetici gizleyip silebilir) ──
const USER_MAX_ADS_PER_DAY = 10;
const ECONOMY_DEFAULTS = Object.freeze({ adCreated: 25, followGiven: 5, followedReceived: 10, adLike: 2, adComment: 5 });
let economyRulesCache = null;
let economyRulesCacheAt = 0;

function normalizeEconomyRules(input = {}) {
  const rules = {};
  for (const [key, fallback] of Object.entries(ECONOMY_DEFAULTS)) {
    const value = Number(input[key]);
    rules[key] = Number.isInteger(value) && value >= 0 && value <= 100000 ? value : fallback;
  }
  return rules;
}

async function getEconomyRules() {
  if (economyRulesCache && Date.now() - economyRulesCacheAt < 60_000) return economyRulesCache;
  economyRulesCache = normalizeEconomyRules(await db.getPrivateJson('economy-rules.json'));
  economyRulesCacheAt = Date.now();
  return economyRulesCache;
}

async function awardEconomyPoints(userId, reason, idempotencyKey) {
  const ruleForReason = { ad_created: 'adCreated', follow_given: 'followGiven', followed_received: 'followedReceived', ad_like: 'adLike', ad_comment: 'adComment' };
  const amount = (await getEconomyRules())[ruleForReason[reason]] || 0;
  if (!amount) return { awarded: false, amount: 0 };
  // Mevcut Para Puan muhasebe şemasıyla uyumlu kalır; ödül kaynağı denetim alanında korunur.
  const { error } = await db.supabase.from('newhal_points_ledger').insert({
    user_id: userId, amount, reason: 'admin_credit', idempotency_key: idempotencyKey, created_by: `economy:${reason}`,
  });
  if (error && error.code !== '23505') {
    console.error('Ekonomi puanı verilemedi:', error.message);
    return { awarded: false, amount: 0 };
  }
  return { awarded: !error, amount: error ? 0 : amount };
}

app.get('/api/admin/economy-rules', requireAdmin, async (req, res) => res.json(await getEconomyRules()));
app.put('/api/admin/economy-rules', requireAdmin, async (req, res) => {
  const rules = normalizeEconomyRules(req.body);
  for (const key of Object.keys(ECONOMY_DEFAULTS)) {
    if (!Number.isInteger(Number(req.body && req.body[key])) || Number(req.body[key]) < 0 || Number(req.body[key]) > 100000) {
      return res.status(400).json({ error: 'Her ekonomi kuralı 0 ile 100.000 arasında tam sayı olmalı' });
    }
  }
  if (!(await db.savePrivateJson('economy-rules.json', rules))) return res.status(500).json({ error: 'Ekonomi kuralları kaydedilemedi' });
  economyRulesCache = rules; economyRulesCacheAt = Date.now();
  res.json(rules);
});

app.get('/api/admin/economy-ledger', requireAdmin, async (req, res) => {
  const { data: rows, error } = await db.supabase.from('newhal_points_ledger')
    .select('user_id,amount,reason,created_by,created_at,idempotency_key')
    .or('created_by.like.economy:%,reason.in.(daily_login,referral)')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'Ekonomi kayıtları alınamadı' });
  const userIds = [...new Set((rows || []).map(row => row.user_id))];
  let users = [];
  if (userIds.length) {
    const result = await db.supabase.from('users').select('id,name,created_at').in('id', userIds);
    if (result.error) return res.status(500).json({ error: 'Kullanıcılar alınamadı' });
    users = result.data || [];
  }
  const usersById = new Map(users.map(user => [Number(user.id), user]));
  const entries = (rows || []).map(row => {
    const user = usersById.get(Number(row.user_id));
    const isWelcome = row.reason === 'daily_login' && user && Math.abs(Date.parse(row.created_at) - Date.parse(user.created_at)) < 5 * 60 * 1000;
    return { ...row, user_name: user?.name || `Kullanıcı #${row.user_id}`, activity: row.created_by?.replace(/^economy:/, '') || (isWelcome ? 'new_user' : row.reason) };
  });
  res.json({ total_distributed: entries.reduce((total, row) => total + Number(row.amount || 0), 0), entries });
});

// ── İlan takibi: üye kelime kaydeder, uyan yeni ilan yayına girince bildirim alır ──
const AD_ALERT_FILE = 'ad-alerts.json';
const AD_ALERT_MAX_WORDS = 10;
let adAlertCache = null;
async function getAdAlerts() {
  if (adAlertCache) return adAlertCache;
  const saved = await db.getPrivateJson(AD_ALERT_FILE);
  adAlertCache = saved && saved.users && typeof saved.users === 'object' ? saved : { users: {} };
  return adAlertCache;
}
const trLower = s => String(s || '').toLocaleLowerCase('tr-TR');
function cleanAlertWords(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const w = trLower(raw).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (w.length >= 2 && !out.includes(w)) out.push(w);
    if (out.length >= AD_ALERT_MAX_WORDS) break;
  }
  return out;
}
const requireMember = (req, res) => {
  if (req.user.role !== 'user' || !req.user.id) { res.status(403).json({ error: 'İlan takibi için giriş yapmalısınız' }); return false; }
  return true;
};
app.get('/api/ad-alerts', requireAuth, async (req, res) => {
  if (!requireMember(req, res)) return;
  const store = await getAdAlerts();
  res.json({ words: (store.users[String(req.user.id)] || {}).words || [], max: AD_ALERT_MAX_WORDS });
});
app.put('/api/ad-alerts', requireAuth, async (req, res) => {
  if (!requireMember(req, res)) return;
  const words = cleanAlertWords(req.body && req.body.words);
  const store = await getAdAlerts();
  const next = { users: { ...store.users } };
  if (words.length) next.users[String(req.user.id)] = { words, updated_at: new Date().toISOString() };
  else delete next.users[String(req.user.id)];
  if (!(await db.savePrivateJson(AD_ALERT_FILE, next))) return res.status(500).json({ error: 'Kaydedilemedi' });
  adAlertCache = next;
  res.json({ words, max: AD_ALERT_MAX_WORDS });
});

// Yayına giren ilanı takip kelimeleriyle karşılaştır, uyan üyelere bildirim gönder (bir ilan için bir kez)
const adAlertSent = new Set();
async function notifyAdAlerts(ad) {
  try {
    if (!ad || ad.active === false || ad.pending || adAlertSent.has(ad.id)) return;
    adAlertSent.add(ad.id);
    const store = await getAdAlerts();
    const text = trLower(`${ad.title || ''} ${ad.body || ''}`);
    if (!text.trim()) return;
    const ownerId = ad.owner && ad.owner.id ? String(ad.owner.id) : null;
    const hits = [];
    for (const [uid, entry] of Object.entries(store.users)) {
      if (uid === ownerId) continue;
      const word = (entry.words || []).find(w => text.includes(w));
      if (word) hits.push({ id: Number(uid), word });
    }
    if (!hits.length) return;
    const snippet = String(ad.title || ad.body || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const rows = hits.map(h => ({
      recipient_id: h.id, actor_id: null, type: 'announcement',
      title: `🔔 Takip ettiğiniz "${h.word}" için yeni ilan`.slice(0, 120),
      body: `${ad.no ? `#${ad.no} · ` : ''}${snippet}\nİlanı görmek için: ${SITE_URL}/?ilan=${ad.id}`,
    }));
    const { error } = await db.supabase.from('user_notifications').insert(rows);
    if (error) console.error('İlan takibi bildirimi kaydedilemedi:', error.message);
    for (const h of hits) {
      void sendBrowserPush(h.id, {
        title: `NewHal: "${h.word}" için yeni ilan`, body: snippet, url: `/?ilan=${ad.id}`, tag: `ad-alert-${ad.id}`,
      });
    }
    console.log(`[ilan takibi] ${ad.no || ad.id}: ${hits.length} üyeye bildirim`);
  } catch (err) {
    console.error('İlan takibi bildirimi gönderilemedi:', err.message);
  }
}

app.post('/api/ads', requireAuth, async (req, res) => {
  if (req.user.role !== 'user' || !req.user.id) return res.status(403).json({ error: 'Google ile giriş yapmalısınız' });
  const ad = cleanAd(req.body, { allowVideoFile: false });
  if (!ad.title && !ad.body && !ad.images.length && !ad.video) {
    return res.status(400).json({ error: 'İlan boş olamaz: yazı ya da resim ekleyin' });
  }
  if (req.body.video && req.body.video.url && !ad.video) {
    return res.status(400).json({ error: 'YouTube bağlantısı anlaşılamadı' });
  }
  const ads = await db.getAds();
  const mine = ads.filter(a => a.owner && a.owner.id === req.user.id);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (mine.filter(a => a.created_at > dayAgo).length >= USER_MAX_ADS_PER_DAY) {
    return res.status(429).json({ error: `Günde en fazla ${USER_MAX_ADS_PER_DAY} ilan verebilirsiniz` });
  }
  // Ad, oturumdaki eski addan değil profildeki güncel addan alınır
  const { data: owner } = await db.supabase.from('users').select('name').eq('id', req.user.id).maybeSingle();
  const created = {
    id: crypto.randomUUID(), ...ad, featured: false, active: true,
    owner: { id: req.user.id, name: (owner && owner.name) || req.user.name || 'Kullanıcı' }, created_at: new Date().toISOString(),
  };
  setAdStory(created, await userStoryPin(req.user.id, req.body.pinId));
  if (!(await db.saveAds([created, ...ads]))) return res.status(500).json({ error: 'İlan kaydedilemedi' });
  void notifyAdAlerts(created);
  const reward = await awardEconomyPoints(req.user.id, 'ad_created', `ad:${created.id}`);
  res.status(201).json({ id: created.id, story: !!created.pinId, points_awarded: reward.amount, message: 'İlanınız yayınlandı' });
});

// Kullanıcının sahibi olduğu dükkanlar (ilanı hangi dükkan adına vereceğini seçer)
app.get('/api/my-shops', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.json([]);
  res.json(await db.getPinsByOwner(req.user.id));
});

app.get('/api/my-ads', requireAuth, async (req, res) => {
  const ads = (await db.getAds()).filter(a => a.owner && a.owner.id === req.user.id);
  res.json(ads.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(a => ({
    id: a.id, no: a.no, title: a.title, body: a.body, images: a.images, video: a.video, created_at: a.created_at,
    status: a.pending ? 'pending' : a.active === false ? 'hidden' : 'live', featured: !!a.featured,
    featured_request_status: a.featured_request_status || '',
  })));
});

const VITRIN_APPLICATION_POINTS = 1000;
const ledgerAmount = row => row.created_by === 'economy:vitrin_purchase' ? -Math.abs(Number(row.amount || 0)) : Number(row.amount || 0);

async function userPointsBalance(userId) {
  const { data, error } = await db.supabase.from('newhal_points_ledger').select('amount,created_by').eq('user_id', userId);
  if (error) throw error;
  return (data || []).reduce((sum, row) => sum + ledgerAmount(row), 0);
}

app.post('/api/my-ads/:id/vitrin-application', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
  const ads = await db.getAds();
  const ad = ads.find(item => item.id === req.params.id && item.owner && Number(item.owner.id) === Number(req.user.id));
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  if (ad.active === false || ad.pending) return res.status(400).json({ error: 'Yayında olan bir ilan için başvuru yapabilirsiniz' });
  if (ad.featured) return res.status(400).json({ error: 'Bu ilan zaten vitrinde' });
  if (ad.featured_request_status === 'pending') return res.status(409).json({ error: 'Bu ilan için vitrin başvurusu zaten bekliyor' });
  let balance;
  try { balance = await userPointsBalance(req.user.id); } catch { return res.status(500).json({ error: 'Para Puan bakiyesi alınamadı' }); }
  if (balance < VITRIN_APPLICATION_POINTS) return res.status(400).json({ error: `Vitrin başvurusu için ${VITRIN_APPLICATION_POINTS.toLocaleString('tr-TR')} Para Puan gerekir` });
  const { error } = await db.supabase.from('newhal_points_ledger').insert({
    user_id: req.user.id, amount: VITRIN_APPLICATION_POINTS, reason: 'admin_credit',
    idempotency_key: `vitrin-request:${ad.id}`, created_by: 'economy:vitrin_purchase',
  });
  if (error && error.code !== '23505') return res.status(500).json({ error: 'Para Puan kullanılamadı' });
  if (error) return res.status(409).json({ error: 'Bu ilan için vitrin başvurusu zaten yapıldı' });
  ad.featured_request_status = 'pending'; ad.featured_requested_at = new Date().toISOString();
  if (!(await db.saveAds(ads))) return res.status(500).json({ error: 'Başvuru kaydedilemedi' });
  res.status(201).json({ message: 'Vitrin başvurunuz alındı', points_spent: VITRIN_APPLICATION_POINTS, balance: balance - VITRIN_APPLICATION_POINTS });
});

app.delete('/api/my-ads/:id', requireAuth, async (req, res) => {
  const ads = await db.getAds();
  const ad = ads.find(a => a.id === req.params.id && a.owner && a.owner.id === req.user.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  if (!(await db.saveAds(ads.filter(a => a.id !== ad.id)))) return res.status(500).json({ error: 'Silinemedi' });
  await deleteAdFiles(ad);
  res.json({ message: 'İlan silindi' });
});

app.get('/api/admin/ads', requireAdmin, async (req, res) => {
  const ads = await getAdsWithFeaturedExpiry();
  res.json([...ads].sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

app.get('/api/admin/ad-story-settings', requireAdmin, async (req, res) => {
  res.json(await getAdStorySettings());
});

app.put('/api/admin/ad-story-settings', requireAdmin, async (req, res) => {
  const { enabled, days, groupSize } = req.body || {};
  if (typeof enabled !== 'boolean' || !Number.isInteger(days) || days < 1 || days > 30
    || !Number.isInteger(groupSize) || groupSize < 1 || groupSize > 50) {
    return res.status(400).json({ error: 'Gösterim seçimi, 1-30 gün ve grup başına 1-50 ilan girin' });
  }
  const settings = { enabled, days, groupSize };
  if (!(await db.savePrivateJson('ad-story-settings.json', settings))) {
    return res.status(500).json({ error: 'Hikaye ayarları kaydedilemedi' });
  }
  adStorySettingsCache = settings;
  adStorySettingsCacheAt = Date.now();
  res.json(settings);
});

// Resim/video tarayıcıdan doğrudan depoya yüklenir; sunucu sadece tek kullanımlık adres verir
app.post('/api/admin/ads/upload-url', requireAdmin, async (req, res) => {
  const rule = AD_UPLOAD_RULES[req.body.kind];
  const ext = rule && rule.types[req.body.type];
  if (!ext) return res.status(400).json({ error: 'Bu dosya türü yüklenemez' });
  if (!(req.body.size > 0) || req.body.size > rule.maxBytes) {
    return res.status(400).json({ error: `Dosya en fazla ${rule.maxBytes / 1024 / 1024} MB olabilir` });
  }
  const result = await db.createAdUploadUrl(`ads/${Date.now()}-${crypto.randomUUID()}.${ext}`);
  if (!result) return res.status(500).json({ error: 'Yükleme başlatılamadı' });
  res.json(result);
});

// Facebook gönderisinden kopyalanan resim adresini indirip ilan deposuna kaydeder.
// Güvenlik: yalnızca Facebook'un resim sunucularından, en fazla 5 MB, sadece resim.
const FB_IMAGE_HOST = /(^|\.)(fbcdn\.net|fbsbx\.com)$/i;
async function importFbImage(href) {
  let url;
  try { url = new URL(String(href || '')); } catch { throw new Error('Resim adresi geçersiz'); }
  if (url.protocol !== 'https:' || !FB_IMAGE_HOST.test(url.hostname)) throw new Error('Sadece Facebook resimleri alınabilir');
  const r = await fetch(url.href, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!r.ok) throw new Error(`Resim alınamadı (${r.status})`);
  const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
  const ext = AD_UPLOAD_RULES.image.types[type];
  if (!ext) throw new Error('Bu resim türü desteklenmiyor');
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > AD_UPLOAD_RULES.image.maxBytes) throw new Error('Resim çok büyük');
  const target = await db.createAdUploadUrl(`ads/${Date.now()}-${crypto.randomUUID()}.${ext}`);
  if (!target) throw new Error('Resim kaydedilemedi');
  const up = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: buf });
  if (!up.ok) throw new Error('Resim kaydedilemedi');
  return target.publicUrl;
}
app.post('/api/admin/ads/import-image', requireAdmin, async (req, res) => {
  try { res.json({ url: await importFbImage(req.body.url) }); }
  catch (err) { res.status(400).json({ error: err.message || 'Resim alınamadı' }); }
});

// ── Facebook linkinden ilan (Apify ile okunur) ─────────────────
// Apify anahtarı herkese kapalı depoda tutulur, tarayıcıya hiç gönderilmez.
const APIFY_FILE = 'apify.json';
async function getApifyToken() {
  const saved = await db.getPrivateJson(APIFY_FILE);
  return (saved && saved.token) || process.env.APIFY_TOKEN || process.env.APIFY_API_KEY || '';
}
app.get('/api/admin/apify', requireAdmin, async (req, res) => {
  const token = await getApifyToken();
  res.json({ configured: !!token, hint: token ? `…${token.slice(-4)}` : '' });
});
app.put('/api/admin/apify', requireAdmin, async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!/^apify_api_[A-Za-z0-9]{20,}$/.test(token)) return res.status(400).json({ error: 'Anahtar "apify_api_" ile başlamalı' });
  try {
    const r = await fetch(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(400).json({ error: 'Apify bu anahtarı kabul etmedi' });
  } catch { return res.status(502).json({ error: 'Apify şu an yanıt vermiyor, biraz sonra deneyin' }); }
  if (!(await db.savePrivateJson(APIFY_FILE, { token, saved_at: new Date().toISOString() }))) return res.status(500).json({ error: 'Kaydedilemedi' });
  res.json({ configured: true, hint: `…${token.slice(-4)}` });
});

// Apify sonucundan gönderi resimlerini toplar: profil resimleri ve küçük simgeler atlanır
function fbPostImages(item) {
  const found = [];
  const seen = new Set();
  const skipKeys = new Set(['user', 'profilePic', 'pageName', 'comments', 'topComments', 'author', 'collaborators', 'pageAdLibrary']);
  const walk = (v, depth) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') {
      if (!/^https:\/\/[^/]*fbcdn\.net\//.test(v)) return;
      if (/t39\.30808-1\/|\/rsrc\.php|emoji|ctp=s\d{2}x\d{2}|p\d{2}x\d{2}[^\d]/.test(v)) return;
      const id = (v.match(/\/(\d+_\d+_\d+_[a-z])\.(jpg|png|webp)/) || [])[1] || v.split('?')[0];
      if (seen.has(id)) return;
      seen.add(id);
      found.push(v);
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    if (typeof v === 'object') {
      // Önce büyük resim adresi: photo_image.uri, image.uri
      for (const k of ['photo_image', 'image', 'full_image']) if (v[k] && v[k].uri) walk(v[k].uri, depth + 1);
      for (const [k, x] of Object.entries(v)) if (!skipKeys.has(k)) walk(x, depth + 1);
    }
  };
  walk(item.media, 0);
  walk(item.attachments, 0);
  if (!found.length && item.sharedPost) { walk(item.sharedPost.media, 0); walk(item.sharedPost.attachments, 0); }
  return found;
}

app.post('/api/admin/ads/from-facebook', requireAdmin, async (req, res) => {
  let link;
  try { link = new URL(String(req.body.url || '').trim()); } catch { return res.status(400).json({ error: 'Facebook linki geçersiz' }); }
  if (!/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i.test(link.hostname)) return res.status(400).json({ error: 'Bu bir Facebook linki değil' });
  const token = await getApifyToken();
  if (!token) return res.status(400).json({ error: 'Önce Apify anahtarını kaydedin' });
  const isGroup = /\/groups\//i.test(link.pathname);
  const actor = isGroup ? 'apify~facebook-groups-scraper' : 'apify~facebook-posts-scraper';
  let items;
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=150`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrls: [{ url: link.href }], resultsLimit: 1, viewOption: 'CHRONOLOGICAL' }),
      signal: AbortSignal.timeout(170000),
    });
    items = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = items && items.error && items.error.message;
      console.error('Apify Facebook okuma hatası:', r.status, msg);
      return res.status(502).json({ error: r.status === 402 ? 'Apify bakiyesi yetersiz' : 'Gönderi okunamadı, linki kontrol edin' });
    }
  } catch (err) {
    console.error('Apify Facebook okuma hatası:', err.message);
    return res.status(504).json({ error: 'Gönderi zamanında okunamadı, tekrar deneyin' });
  }
  const item = Array.isArray(items) ? items.find(x => x && !x.error) : null;
  if (!item) return res.status(404).json({ error: isGroup ? 'Gönderi okunamadı. Grup kapalıysa gönderi dışarıdan görülemez.' : 'Gönderi bulunamadı ya da herkese açık değil' });
  const text = String(item.text || item.message || (item.sharedPost && item.sharedPost.text) || '').trim();
  const urls = fbPostImages(item).slice(0, 5);
  const images = [];
  let failed = 0;
  for (const u of urls) {
    try { images.push(await importFbImage(u)); } catch { failed++; }
  }
  res.json({ text, images, failed, source: item.url || link.href, author: (item.user && item.user.name) || '' });
});

app.post('/api/admin/ads', requireAdmin, async (req, res) => {
  const ad = cleanAd(req.body);
  if (!ad.title && !ad.body && !ad.images.length && !ad.video) {
    return res.status(400).json({ error: 'İlan boş olamaz: yazı, resim ya da video ekleyin' });
  }
  if (req.body.video && req.body.video.type === 'youtube' && !ad.video) {
    return res.status(400).json({ error: 'YouTube bağlantısı anlaşılamadı' });
  }
  const ads = await db.getAds();
  const created = { id: crypto.randomUUID(), ...ad, featured: false, active: true, created_at: new Date().toISOString() };
  if (req.body.featured) setFeatured(created, true, req.body.featured_days);
  setAdStory(created, await adminStoryPin(req.body.pinId));
  if (!(await db.saveAds([created, ...ads]))) return res.status(500).json({ error: 'İlan kaydedilemedi' });
  void notifyAdAlerts(created);
  res.status(201).json(created);
});

// İlanı düzenle: içerik değişir; numara, tarih, ekleyen, paylaşım bilgileri korunur
app.put('/api/admin/ads/:id', requireAdmin, async (req, res) => {
  const ads = await db.getAds();
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  const next = cleanAd(req.body);
  if (!next.title && !next.body && !next.images.length && !next.video) {
    return res.status(400).json({ error: 'İlan boş olamaz: yazı, resim ya da video ekleyin' });
  }
  if (req.body.video && req.body.video.type === 'youtube' && !next.video) {
    return res.status(400).json({ error: 'YouTube bağlantısı anlaşılamadı' });
  }
  const before = adMedia(ad).filter(Boolean);
  Object.assign(ad, next, { updated_at: new Date().toISOString() });
  if (!req.body.featured) setFeatured(ad, false);
  else if (!ad.featured) setFeatured(ad, true, req.body.featured_days);
  if ('pinId' in req.body) setAdStory(ad, await adminStoryPin(req.body.pinId));
  if (!(await db.saveAds(ads))) return res.status(500).json({ error: 'İlan kaydedilemedi' });
  // Artık kullanılmayan resim/video dosyalarını depodan sil
  const now = new Set(adMedia(ad).filter(Boolean));
  await deleteAdFiles({ images: before.filter(u => !now.has(u)) });
  res.json(ad);
});

// Yayından kaldır / yeniden yayınla
app.patch('/api/admin/ads/:id', requireAdmin, async (req, res) => {
  const ads = await db.getAds();
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  // Yayında/gizli ve vitrin durumu ayrı ayrı değiştirilebilir
  if ('active' in req.body) ad.active = !!req.body.active;
  if (ad.active) delete ad.pending;   // yayına alınan kullanıcı ilanı artık onaylıdır
  if ('featured' in req.body) setFeatured(ad, !!req.body.featured, req.body.featured_days);
  if (req.body.featured) { ad.featured_request_status = 'approved'; ad.featured_approved_at = new Date().toISOString(); }
  if (req.body.whatsapp_sent) ad.whatsapp_sent_at = new Date().toISOString();
  if (!(await db.saveAds(ads))) return res.status(500).json({ error: 'Kaydedilemedi' });
  if (req.body.active === true) void notifyAdAlerts(ad);
  res.json(ad);
});

app.delete('/api/admin/ads/:id', requireAdmin, async (req, res) => {
  const ads = await db.getAds();
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  if (!(await db.saveAds(ads.filter(a => a.id !== ad.id)))) return res.status(500).json({ error: 'Silinemedi' });
  await deleteAdFiles(ad);
  res.json({ message: 'İlan silindi' });
});

// ── Facebook sayfasına ilan gönderme ──────────────────────────
// Sayfa bağlantısı (kalıcı sayfa anahtarı) herkese kapalı depoda tutulur, tarayıcıya hiç gönderilmez.
const FB_GRAPH        = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v24.0'}`;
const FB_GRAPH_VIDEO  = `https://graph-video.facebook.com/${process.env.FB_GRAPH_VERSION || 'v24.0'}`;
const FB_PAGE_USERNAME = process.env.FB_PAGE_USERNAME || 'halkompleksi33';
const FB_CONFIG_FILE  = 'facebook.json';
const SITE_URL        = process.env.SITE_URL || 'https://newhal.com';

async function fbRequest(url, params, method = 'POST') {
  const body = new URLSearchParams(params);
  const res = method === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ? json.error.message : `Facebook yanıt vermedi (${res.status})`);
  return json;
}

function adFacebookMessage(ad) {
  const parts = [ad.title, ad.body].filter(Boolean);
  parts.push(`📍 NewHal · Mersin Hal Kompleksi Rehberi\n${SITE_URL}`);
  return parts.join('\n\n');
}

// İlanın türüne göre doğru Facebook gönderisini oluşturur; gönderi kimliğini döner
async function publishAdToFacebook(ad, fb) {
  const token = fb.page_token;
  const page = fb.page_id;
  const message = adFacebookMessage(ad);
  const images = ad.images || [];

  if (ad.video && ad.video.type === 'file') {
    const r = await fbRequest(`${FB_GRAPH_VIDEO}/${page}/videos`, {
      file_url: ad.video.url, description: message, title: ad.title || '', access_token: token,
    });
    return { post_id: r.id, kind: 'video' };
  }
  if (ad.video && ad.video.type === 'youtube') {
    const r = await fbRequest(`${FB_GRAPH}/${page}/feed`, {
      message, link: `https://www.youtube.com/watch?v=${ad.video.id}`, access_token: token,
    });
    return { post_id: r.id, kind: 'link' };
  }
  if (images.length === 1) {
    const r = await fbRequest(`${FB_GRAPH}/${page}/photos`, { url: images[0], message, access_token: token });
    return { post_id: r.post_id || r.id, kind: 'photo' };
  }
  if (images.length > 1) {
    // Önce resimler yayınlanmadan yüklenir, sonra tek gönderide birleştirilir
    const ids = [];
    for (const url of images) {
      const r = await fbRequest(`${FB_GRAPH}/${page}/photos`, { url, published: 'false', access_token: token });
      ids.push(r.id);
    }
    const params = { message, access_token: token };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const r = await fbRequest(`${FB_GRAPH}/${page}/feed`, params);
    return { post_id: r.id, kind: 'album' };
  }
  // Resimsiz ilan NewHal logosuyla fotoğraflı gönderi olarak paylaşılır
  const r = await fbRequest(`${FB_GRAPH}/${page}/photos`, { url: `${SITE_URL}/img/ilan-logo.jpg`, message, access_token: token });
  return { post_id: r.post_id || r.id, kind: 'photo' };
}

app.get('/api/admin/facebook', requireAdmin, async (req, res) => {
  const fb = await db.getPrivateJson(FB_CONFIG_FILE);
  res.json(fb ? { connected: true, page_name: fb.page_name, page_username: fb.page_username, connected_at: fb.connected_at }
              : { connected: false, page_username: FB_PAGE_USERNAME });
});

// Sayfa anahtarını bulup saklar. İki yol:
//  1) İşletme (Business) sistem kullanıcısı anahtarı: tek başına yeterli, süresi dolmaz.
//  2) Kısa süreli kullanıcı anahtarı + uygulama kimliği + gizli anahtar: kalıcı anahtara çevrilir
//     (uygulama gizli anahtarı saklanmaz).
app.post('/api/admin/facebook/connect', requireAdmin, async (req, res) => {
  const appId = String(req.body.appId || '').trim();
  const appSecret = String(req.body.appSecret || '').trim();
  const userToken = String(req.body.userToken || '').trim();
  if (!userToken) return res.status(400).json({ error: 'Erişim anahtarı gerekli' });
  if ((appId || appSecret) && (!/^\d{5,20}$/.test(appId) || !appSecret)) {
    return res.status(400).json({ error: 'Uygulama kimliği ve gizli anahtar birlikte girilmeli' });
  }
  try {
    let token = userToken;
    if (appId && appSecret) {
      const longLived = await fbRequest(`${FB_GRAPH}/oauth/access_token`, {
        grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: userToken,
      }, 'GET');
      token = longLived.access_token;
    }
    // Gönderi atma izni var mı? (yoksa sayfa bulunsa bile paylaşım reddedilir)
    const perms = await fbRequest(`${FB_GRAPH}/me/permissions`, { access_token: token }, 'GET');
    const granted = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);
    if (!granted.includes('pages_manage_posts')) {
      return res.status(400).json({ error: 'Bu anahtarda "pages_manage_posts" (sayfada gönderi paylaşma) izni yok. Anahtarı bu izni işaretleyerek yeniden oluşturun.' });
    }
    const pages = await fbRequest(`${FB_GRAPH}/me/accounts`, {
      fields: 'id,name,username,access_token,tasks', limit: '100', access_token: token,
    }, 'GET');
    const list = pages.data || [];
    const page = list.find(p => (p.username || '').toLowerCase() === FB_PAGE_USERNAME.toLowerCase())
      || (list.length === 1 ? list[0] : null);
    if (!page) {
      const names = list.map(p => p.name).join(', ') || 'hiç sayfa yok';
      return res.status(400).json({ error: `"${FB_PAGE_USERNAME}" sayfası bulunamadı. Bu hesabın yönettiği sayfalar: ${names}` });
    }
    if (page.tasks && !page.tasks.includes('CREATE_CONTENT')) {
      return res.status(400).json({ error: `"${page.name}" sayfasında gönderi paylaşma yetkiniz yok` });
    }
    const config = {
      page_id: page.id, page_name: page.name, page_username: page.username || FB_PAGE_USERNAME,
      page_token: page.access_token, connected_at: new Date().toISOString(),
    };
    if (!(await db.savePrivateJson(FB_CONFIG_FILE, config))) return res.status(500).json({ error: 'Bağlantı kaydedilemedi' });
    res.json({ connected: true, page_name: config.page_name, page_username: config.page_username });
  } catch (err) {
    res.status(400).json({ error: 'Facebook: ' + err.message });
  }
});

// ── İstatistikler: ilan görüntülenme/açılma/paylaşım ve aramalar (kimlik tutulmaz) ──
const STATS_FILE = 'stats.json';
const STATS_FLUSH_MS = 30 * 1000;
const SHARE_CHANNELS = ['whatsapp', 'facebook', 'x', 'telegram', 'copy', 'more'];
const SEARCH_SOURCES = ['map', 'ads'];
const STATS_EVENTS_PER_MIN = 300;
let stats = null;          // { ads: { id: { views, opens, shares: {kanal: n} } }, searches: { terim: { count, last, map, ads } } }
let statsDirty = false;
const statsRate = new Map(); // ip → { at, n }

async function loadStats() {
  if (!stats) stats = (await db.getPrivateJson(STATS_FILE)) || { ads: {}, searches: {} };
  stats.ads = stats.ads || {};
  stats.searches = stats.searches || {};
  return stats;
}

setInterval(async () => {
  if (!statsDirty || !stats) return;
  statsDirty = false;
  if (!(await db.savePrivateJson(STATS_FILE, stats))) statsDirty = true;
}, STATS_FLUSH_MS).unref();

// Arama terimi: küçük harf, fazla boşluksuz, telefon numarası ya da çok uzun metin değil
function cleanSearchTerm(q) {
  const t = String(q || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40) return null;
  if ((t.match(/\d/g) || []).length >= 6) return null;
  return t;
}

app.post('/api/stats', async (req, res) => {
  const events = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 50) : [];
  const ip = getIp(req);
  const now = Date.now();
  const rate = statsRate.get(ip);
  const bucket = rate && now - rate.at < 60000 ? rate : { at: now, n: 0 };
  bucket.n += events.length;
  statsRate.set(ip, bucket);
  if (bucket.n > STATS_EVENTS_PER_MIN) return res.status(429).end();

  const s = await loadStats();
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (['view', 'open', 'share'].includes(ev.type)) {
      const id = String(ev.adId || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
      const a = s.ads[id] || (s.ads[id] = { views: 0, opens: 0, shares: {} });
      if (ev.type === 'view') a.views++;
      else if (ev.type === 'open') a.opens++;
      else if (SHARE_CHANNELS.includes(ev.channel)) a.shares[ev.channel] = (a.shares[ev.channel] || 0) + 1;
      statsDirty = true;
    } else if (ev.type === 'search') {
      const term = cleanSearchTerm(ev.q);
      if (!term) continue;
      const t = s.searches[term] || (s.searches[term] = { count: 0, last: null });
      t.count++;
      t.last = new Date().toISOString();
      if (SEARCH_SOURCES.includes(ev.source)) t[ev.source] = (t[ev.source] || 0) + 1;
      statsDirty = true;
    }
  }
  res.status(204).end();
});

// Saatlik temizlik: bir saatten eski hız sınırı kayıtları
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [ip, r] of statsRate) if (r.at < cutoff) statsRate.delete(ip);
}, 60 * 60 * 1000).unref();

const totalShares = a => Object.values(a.shares || {}).reduce((x, y) => x + y, 0);

app.get('/api/admin/stats/ads', requireAdmin, async (req, res) => {
  const s = await loadStats();
  res.json(s.ads);
});

app.get('/api/admin/stats/overview', requireAdmin, async (req, res) => {
  const s = await loadStats();
  const ads = await getAdsWithFeaturedExpiry();
  const rows = ads.map(ad => {
    const a = s.ads[ad.id] || { views: 0, opens: 0, shares: {} };
    return { id: ad.id, no: ad.no, title: ad.title || (ad.body || '').split('\n')[0].slice(0, 80), image: (ad.images || [])[0] || null,
      featured: !!ad.featured, views: a.views, opens: a.opens, shares: totalShares(a), share_detail: a.shares };
  });
  const totals = rows.reduce((t, r) => ({ views: t.views + r.views, opens: t.opens + r.opens, shares: t.shares + r.shares }), { views: 0, opens: 0, shares: 0 });
  const searches = Object.entries(s.searches)
    .map(([term, v]) => ({ term, count: v.count, last: v.last, map: v.map || 0, ads: v.ads || 0 }))
    .sort((a, b) => b.count - a.count).slice(0, 30);
  res.json({ totals, topAds: rows.sort((a, b) => b.views - a.views).slice(0, 15), searches });
});

// ── WhatsApp mesaj şablonu (yönetici panelinden düzenlenir) ───
const WA_TEMPLATE_FILE = 'whatsapp.json';
const WA_TEMPLATE_MAX = 1500;

app.get('/api/admin/whatsapp-template', requireAdmin, async (req, res) => {
  const saved = await db.getPrivateJson(WA_TEMPLATE_FILE);
  res.json({ template: saved && saved.template ? saved.template : null });
});

app.put('/api/admin/whatsapp-template', requireAdmin, async (req, res) => {
  const template = String(req.body.template || '').trim().slice(0, WA_TEMPLATE_MAX);
  if (!template) return res.status(400).json({ error: 'Şablon boş olamaz' });
  if (!(await db.savePrivateJson(WA_TEMPLATE_FILE, { template, updated_at: new Date().toISOString() }))) {
    return res.status(500).json({ error: 'Şablon kaydedilemedi' });
  }
  res.json({ template });
});

const WA_INVITE_FILE = 'whatsapp_davet.json';
app.get('/api/admin/whatsapp-invite-template', requireAdmin, async (req, res) => {
  const saved = await db.getPrivateJson(WA_INVITE_FILE);
  res.json({ template: saved && saved.template ? saved.template : null });
});

app.put('/api/admin/whatsapp-invite-template', requireAdmin, async (req, res) => {
  const template = String(req.body.template || '').trim().slice(0, WA_TEMPLATE_MAX);
  if (!template) return res.status(400).json({ error: 'Şablon boş olamaz' });
  if (!(await db.savePrivateJson(WA_INVITE_FILE, { template, updated_at: new Date().toISOString() }))) {
    return res.status(500).json({ error: 'Şablon kaydedilemedi' });
  }
  res.json({ template });
});

app.delete('/api/admin/facebook', requireAdmin, async (req, res) => {
  await db.deletePrivateJson(FB_CONFIG_FILE);
  res.json({ connected: false });
});

// ── Facebook sayfasının hikayeleri sitede ─────────────────────
// Son 24 saatin hikayeleri; Facebook'un video adresleri süreli olduğu için 5 dakikada bir yenilenir
const FB_STORY_CACHE_MS = 5 * 60 * 1000;
const FB_STORY_MAX = 20;
let fbStoryCache = { at: 0, data: { stories: [] } };
let fbStoryLoading = null;

async function loadFacebookStories() {
  const fb = await db.getPrivateJson(FB_CONFIG_FILE);
  if (!fb || !fb.page_id || !fb.page_token) return { stories: [] };
  const token = encodeURIComponent(fb.page_token);
  const list = await (await fetch(`${FB_GRAPH}/${fb.page_id}/stories?access_token=${token}`, { signal: AbortSignal.timeout(10000) })).json();
  if (list.error) throw new Error(list.error.message);
  const dayAgo = Date.now() / 1000 - 24 * 60 * 60;
  const recent = (list.data || [])
    .filter(s => s.status === 'published' && Number(s.creation_time) > dayAgo && s.media_id)
    .slice(0, FB_STORY_MAX);
  const stories = (await Promise.all(recent.map(async s => {
    try {
      const isVideo = s.media_type === 'video';
      const fields = isVideo ? 'source,picture,length' : 'images,picture';
      const m = await (await fetch(`${FB_GRAPH}/${s.media_id}?fields=${fields}&access_token=${token}`, { signal: AbortSignal.timeout(10000) })).json();
      if (m.error) return null;
      const src = isVideo ? m.source : ((m.images || [])[0] || {}).source || m.picture;
      if (!src) return null;
      return {
        id: `fb_${s.post_id || s.media_id}`,
        type: isVideo ? 'video' : 'photo',
        src, thumb: m.picture || null, duration: m.length || null,
        url: s.url || null,
        created_at: new Date(Number(s.creation_time) * 1000).toISOString(),
      };
    } catch { return null; }
  }))).filter(Boolean).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { page: { name: fb.page_name, url: `https://www.facebook.com/${fb.page_username || fb.page_id}` }, stories };
}

app.get('/api/fb-stories', async (req, res) => {
  if (Date.now() - fbStoryCache.at > FB_STORY_CACHE_MS) {
    fbStoryLoading = fbStoryLoading || loadFacebookStories()
      .then(data => { fbStoryCache = { at: Date.now(), data }; })
      .catch(err => { console.error('Facebook hikayeleri alınamadı:', err.message); fbStoryCache.at = Date.now() - FB_STORY_CACHE_MS + 60 * 1000; })
      .finally(() => { fbStoryLoading = null; });
    await fbStoryLoading;
  }
  res.set('Cache-Control', 'public, max-age=60').json(fbStoryCache.data);
});

app.post('/api/admin/ads/:id/facebook', requireAdmin, async (req, res) => {
  const fb = await db.getPrivateJson(FB_CONFIG_FILE);
  if (!fb) return res.status(400).json({ error: 'Önce Facebook sayfasını bağlayın' });
  const ads = await db.getAds();
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  try {
    const result = await publishAdToFacebook(ad, fb);
    ad.facebook = { ...result, url: `https://www.facebook.com/${result.post_id}`, shared_at: new Date().toISOString() };
    await db.saveAds(ads);
    res.json(ad.facebook);
  } catch (err) {
    res.status(400).json({ error: 'Facebook: ' + err.message });
  }
});

// ── ADMIN: Kod denetimi raporu (sadece yöneticiye gösterilir) ──
const AUDIT_REPORT = {
  date: '8 Kasım 2026',
  note: 'Sitenin tüm kodu tarandı. Ziyaretçi yazılarıyla siteye zarar verme açığı bulunmadı; yazılar güvenli gösteriliyor.',
  items: [
    ['Önemli', 'İlan ekleyip silerek sınırsız Para Puan kazanılabiliyor.', 'Her ilan 25 puan veriyor, günde 10 ilan sınırı var. Ama sınır sadece duran ilanları sayıyor. İlanını silen biri tekrar ekleyip tekrar puan alabiliyor.'],
    ['Önemli', 'İlanlara yorum yazarak sınırsız puan kazanılabiliyor.', 'Her yorum 5 puan veriyor ve bir sınırı yok. 200 kısa yorum 1.000 puan ediyor, bu da bir vitrin başvurusu demek.'],
    ['Önemli', 'Sahte hesap açıp davet puanı toplanabiliyor.', 'Kayıtta telefon numarası doğrulanmıyor. Saatte 5 kayıt sınırı da kolayca aşılabiliyor. Biri kendi davet koduyla yüzlerce sahte hesap açıp puan toplayabilir.'],
    ['Önemli', 'Bir hata olunca site tamamen kapanabiliyor.', 'Sunucu tarafında yakalanmayan bir hata çıkınca site çöküp yeniden başlıyor. Veri bağlantısı bir an koparsa haritayı açan herkes birkaç saniye boş sayfa görebilir.'],
    ['Önemli', 'Yönetim girişi için kontrol edilmesi gereken bir şey var.', 'Sitenin barındırıldığı yerde (Render) yönetim kullanıcı adı ve şifresi tanımlı değilse site hazır gelen varsayılan şifreyle açılıyor. Yanlış şifre denemelerine de bir sınır yok.'],
    ['Orta', 'Vitrin başvurusu reddedilirse puan geri verilmiyor.', 'Ayrıca vitrin süresi biten bir ilan için tekrar başvuru yapılamıyor.'],
    ['Orta', 'Aynı anda yapılan işlemlerde ilan verisi kaybolabilir.', 'İki kişi aynı anda ilan verirse ya da beğeni yaparsa biri kaybolabilir. İlanlar tek bir dosyada tutulduğu için bu oluyor. Trafik şimdilik az, o yüzden nadir olur.'],
    ['Orta', 'Onaylanmamış işletmelere yorum yazılabiliyor.', 'Yorumların ve sohbet mesajlarının uzunluk sınırı da yok. Yorum yağdırarak bir işletmenin seviyesi yapay olarak yükseltilebilir.'],
    ['Küçük', 'Silinen hesabın bazı izleri kalıyor.', 'Hesabını silen kişinin ilanlara yazdığı yorumlar ve beğeniler adıyla birlikte duruyor.'],
  ].map(([level, title, detail]) => ({ level, title, detail })),
};
app.get('/api/admin/audit-report', requireAdmin, (req, res) => res.json(AUDIT_REPORT));

// ── Tıklama yoğunluk haritası ─────────────────────────────────
// Ekran 60x40 kareye bölünür; her karedeki tıklama sayısı cihaz türüne göre tutulur.
const HEATMAP_FILE = 'heatmap.json';
const HEATMAP_COLS = 60, HEATMAP_ROWS = 40;
const HEATMAP_PER_IP_MIN = 300;
let heatmap = null, heatmapDirty = false;
const heatmapRate = new Map();
const emptyHeat = () => ({ clicks: 0, grid: new Array(HEATMAP_COLS * HEATMAP_ROWS).fill(0) });
async function loadHeatmap() {
  if (!heatmap) {
    const saved = await db.getPrivateJson(HEATMAP_FILE);
    heatmap = { since: (saved && saved.since) || new Date().toISOString(), enabled: !saved || saved.enabled !== false };
    for (const d of ['desktop', 'mobile']) {
      const g = saved && saved[d];
      heatmap[d] = g && Array.isArray(g.grid) && g.grid.length === HEATMAP_COLS * HEATMAP_ROWS ? g : emptyHeat();
    }
  }
  return heatmap;
}
setInterval(async () => {
  if (!heatmapDirty || !heatmap) return;
  heatmapDirty = false;
  if (!(await db.savePrivateJson(HEATMAP_FILE, heatmap))) heatmapDirty = true;
}, 30 * 1000).unref();
setInterval(() => {
  const minuteAgo = Date.now() - 60 * 1000;
  for (const [ip, r] of heatmapRate) if (r.at < minuteAgo) heatmapRate.delete(ip);
}, 10 * 60 * 1000).unref();

app.post('/api/heatmap', express.text({ type: '*/*', limit: '20kb' }), async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const device = body && (body.device === 'mobile' ? 'mobile' : body.device === 'desktop' ? 'desktop' : null);
  const points = body && Array.isArray(body.points) ? body.points.slice(0, 100) : [];
  if (!device || !points.length) return res.status(204).end();
  if (!(await loadHeatmap()).enabled) return res.status(204).end();
  const ip = String(getIp(req)).split(',')[0].trim();
  const now = Date.now();
  const rate = heatmapRate.get(ip);
  const bucket = rate && now - rate.at < 60000 ? rate : { at: now, n: 0 };
  bucket.n += points.length;
  heatmapRate.set(ip, bucket);
  if (bucket.n > HEATMAP_PER_IP_MIN) return res.status(204).end();
  const h = await loadHeatmap();
  for (const p of points) {
    const x = Array.isArray(p) ? Number(p[0]) : NaN, y = Array.isArray(p) ? Number(p[1]) : NaN;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= HEATMAP_COLS || y >= HEATMAP_ROWS) continue;
    h[device].grid[y * HEATMAP_COLS + x]++;
    h[device].clicks++;
    heatmapDirty = true;
  }
  res.status(204).end();
});

app.get('/api/admin/heatmap', requireAdmin, async (req, res) => {
  res.json({ cols: HEATMAP_COLS, rows: HEATMAP_ROWS, ...(await loadHeatmap()) });
});

// Ziyaretçi sayfası toplamanın açık olup olmadığını buradan öğrenir
app.get('/api/heatmap/status', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60').json({ enabled: (await loadHeatmap()).enabled });
});

app.put('/api/admin/heatmap/enabled', requireAdmin, async (req, res) => {
  const h = await loadHeatmap();
  h.enabled = !!(req.body && req.body.enabled);
  if (!(await db.savePrivateJson(HEATMAP_FILE, h))) return res.status(500).json({ error: 'Kaydedilemedi' });
  heatmapDirty = false;
  res.json({ enabled: h.enabled });
});

app.delete('/api/admin/heatmap', requireAdmin, async (req, res) => {
  heatmap = { since: new Date().toISOString(), enabled: heatmap ? heatmap.enabled : true, desktop: emptyHeat(), mobile: emptyHeat() };
  if (!(await db.savePrivateJson(HEATMAP_FILE, heatmap))) return res.status(500).json({ error: 'Sıfırlanamadı' });
  heatmapDirty = false;
  res.json({ ok: true });
});

// ── PUBLIC: Ziyaretçi hareketleri (Aktivite Logları) ───────────
// Kişisel bilgi tutulmaz: sadece kısa eylem metni. IP başına dakikada 20 kayıt, tablo son 2000 kayıtla sınırlı.
const LOG_PER_IP_MIN = 20;
const LOG_KEEP = 2000;
const logRate = new Map();
let logWrites = 0;

// Yeni aktiviteler Telegram'a dakikada en fazla bir toplu mesajla gider (sohbet dolmasın, Telegram sınırına takılmasın)
const TG_LOG_MAX_QUEUE = 200;
const TG_LOG_MAX_CHARS = 3500;
let tgLogQueue = [];
let tgLogDropped = 0;
function queueLogForTelegram(message) {
  if (tgLogQueue.length >= TG_LOG_MAX_QUEUE) { tgLogDropped++; return; }
  const time = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
  tgLogQueue.push(`${tgEsc(time)} · ${tgEsc(message)}`);
}
async function flushLogsToTelegram() {
  if (!tgLogQueue.length) return;
  const lines = [];
  let size = 0;
  while (tgLogQueue.length && size + tgLogQueue[0].length < TG_LOG_MAX_CHARS) {
    size += tgLogQueue[0].length + 1;
    lines.push(tgLogQueue.shift());
  }
  const notes = tgLogDropped ? ['', `ℹ️ ${tgLogDropped} kayıt yoğunluk yüzünden atlandı.`] : [];
  tgLogDropped = 0;
  await sendTelegram(['🧾 <b>Yeni aktiviteler</b>', '', ...lines, ...notes].join(String.fromCharCode(10)));
}
setInterval(() => {
  flushLogsToTelegram().catch(err => console.error('Aktivite Telegram bildirimi gönderilemedi:', err.message));
}, 60 * 1000).unref();
app.post('/api/logs', async (req, res) => {
  const message = String((req.body && req.body.action) || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!message) return res.status(400).json({ error: 'Eylem boş' });
  const ip = String(getIp(req)).split(',')[0].trim();
  const minuteAgo = Date.now() - 60 * 1000;
  const recent = (logRate.get(ip) || []).filter(t => t > minuteAgo);
  if (recent.length >= LOG_PER_IP_MIN) return res.status(429).end();
  recent.push(Date.now());
  logRate.set(ip, recent);
  res.status(204).end();
  try {
    const row = await db.logActivity(message, false);
    queueLogForTelegram(message);
    if (row && ++logWrites % 100 === 0) await db.supabase.from('logs').delete().lt('id', row.id - LOG_KEEP);
  } catch (err) {
    console.error('Aktivite kaydedilemedi:', err.message);
  }
});
setInterval(() => {
  const minuteAgo = Date.now() - 60 * 1000;
  for (const [ip, times] of logRate) if (!times.some(t => t > minuteAgo)) logRate.delete(ip);
}, 10 * 60 * 1000).unref();

// ── Açılış ekranı (yönetimden ayarlanır) ───────────────────────
const WELCOME_FILE = 'welcome-popup.json';
const DEFAULT_WELCOME = {
  enabled: true,
  image: 'img/banner.png',
  title: 'NewHal Rehberine Hoş Geldiniz',
  text: "Mersin Hal Kompleksi'ndeki işletmeleri interaktif harita üzerinde keşfedin, yorum yapın ve kendi işletmenizi ekleyin.",
  button: 'Rehberi Keşfetmeye Başla',
  version: 1,
};
let welcomeCache = null;
async function getWelcomeSettings() {
  if (welcomeCache) return welcomeCache;
  const saved = await db.getPrivateJson(WELCOME_FILE);
  welcomeCache = { ...DEFAULT_WELCOME, ...(saved || {}) };
  return welcomeCache;
}
const welcomeText = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
app.get('/api/welcome', async (req, res) => {
  try { res.json(await getWelcomeSettings()); }
  catch (err) { console.error('Açılış ekranı okunamadı:', err.message); res.json(DEFAULT_WELCOME); }
});
app.put('/api/admin/welcome', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const current = await getWelcomeSettings();
    const title = welcomeText(body.title, 120);
    const button = welcomeText(body.button, 60);
    if (!title || !button) return res.status(400).json({ error: 'Başlık ve düğme yazısı boş olamaz' });
    const image = welcomeText(body.image, 500);
    if (image !== DEFAULT_WELCOME.image && !image.startsWith('https://')) return res.status(400).json({ error: 'Resim geçersiz' });
    const next = {
      enabled: body.enabled !== false,
      image,
      title,
      text: welcomeText(body.text, 500),
      button,
      version: Number(current.version || 1) + (body.showAgain ? 1 : 0),
    };
    if (!(await db.savePrivateJson(WELCOME_FILE, next))) return res.status(500).json({ error: 'Kaydedilemedi' });
    welcomeCache = next;
    res.json(next);
  } catch (err) {
    console.error('Açılış ekranı kaydedilemedi:', err.message);
    res.status(500).json({ error: 'Kaydedilemedi' });
  }
});

// ── Sponsorlu reklamlar (birden fazla sponsor; her biri yönetimden açılır/kapanır) ──
const SPONSOR_FILE = 'sponsor.json';
const SPONSOR_PLACES = ['grid', 'strip', 'detail', 'side'];   // ilan listesi, vitrin altı bant, işletme detayı, masaüstü sağ/sol
const SPONSOR_MAX = 4;
const SPONSOR_DEFAULT_IMAGE = 'img/sponsor-qmove.webp';
const DEFAULT_SPONSORS = [
  {
    id: 'qmove', enabled: true, name: 'QMove',
    title: 'Halden çıkan malınıza araç mı lazım?',
    text: 'QMove ile kamyonetten TIR’a uygun aracı bulun, fiyatı sipariş vermeden görün, yükünüzü canlı takip edin.',
    button: 'QMove’da Araç Bul', url: 'https://www.qmove.com/tr-tr/', image: SPONSOR_DEFAULT_IMAGE,
    places: { grid: true, strip: true, detail: true, side: true },
  },
  {
    id: 'mersinmanset', enabled: true, name: 'Mersin Manşet',
    title: 'Mersin’in son dakika haberleri',
    text: 'İlçelerden gelişmeler, belediye duyuruları, ekonomi, yaşam ve spor haberleri Mersin Manşet’te.',
    button: 'Haberleri Oku', url: 'https://mersinmanset.tr/', image: '',
    places: { grid: true, strip: true, detail: true, side: true },
  },
];
const withDefaultPlaces = s => ({ ...s, places: { grid: true, strip: true, detail: true, side: true, ...((s && s.places) || {}) } });
let sponsorCache = null;
async function getSponsorSettings() {
  if (sponsorCache) return sponsorCache;
  const saved = await db.getPrivateJson(SPONSOR_FILE);
  let sponsors;
  if (saved && Array.isArray(saved.sponsors)) sponsors = saved.sponsors;
  // Eski kayıt tek sponsordu (QMove): korunur, Mersin Manşet ikinci olarak eklenir
  else if (saved && saved.name) sponsors = [{ ...DEFAULT_SPONSORS[0], ...saved, id: 'qmove' }, DEFAULT_SPONSORS[1]];
  else sponsors = DEFAULT_SPONSORS;
  // Sağ/sol reklamda kapatma (×) düğmesi: kayıt yoksa açık
  sponsorCache = { sponsors: sponsors.map(withDefaultPlaces), sideClose: !(saved && saved.sideClose === false) };
  return sponsorCache;
}
// Eski sayfa sürümleri tek sponsor bekler: ilk açık sponsor üst düzeyde de verilir
const publicSponsorPayload = settings => ({ ...(settings.sponsors.find(s => s.enabled) || { enabled: false }), sponsors: settings.sponsors, sideClose: settings.sideClose !== false });
app.get('/api/sponsor', async (req, res) => {
  try { res.json(publicSponsorPayload(await getSponsorSettings())); }
  catch (err) { console.error('Sponsor ayarı okunamadı:', err.message); res.json({ enabled: false, sponsors: [] }); }
});
function cleanSponsor(body, index) {
  const name = welcomeText(body.name, 40);
  const title = welcomeText(body.title, 120);
  const button = welcomeText(body.button, 40);
  if (!name || !title || !button) return { error: `${index + 1}. sponsor: ad, başlık ve düğme yazısı boş olamaz` };
  let parsed = null;
  try { parsed = new URL(welcomeText(body.url, 500)); } catch {}
  if (!parsed || parsed.protocol !== 'https:') return { error: `${index + 1}. sponsor: bağlantı https:// ile başlamalı` };
  // Resim: yok, sitedeki varsayılan afiş ya da yüklenen (https) resim
  const image = welcomeText(body.image, 500);
  if (image && image !== SPONSOR_DEFAULT_IMAGE && !image.startsWith('https://')) return { error: `${index + 1}. sponsor: resim geçersiz` };
  const id = /^[a-z0-9-]{1,40}$/.test(String(body.id || '')) ? body.id : `sponsor-${crypto.randomUUID().slice(0, 8)}`;
  const places = {};
  for (const p of SPONSOR_PLACES) places[p] = !!(body.places && body.places[p]);
  return { sponsor: { id, enabled: body.enabled === true, name, title, text: welcomeText(body.text, 300), button, url: parsed.href, image, places } };
}
app.put('/api/admin/sponsor', requireAdmin, async (req, res) => {
  try {
    const list = Array.isArray(req.body && req.body.sponsors) ? req.body.sponsors : null;
    if (!list || !list.length || list.length > SPONSOR_MAX) return res.status(400).json({ error: `1 ile ${SPONSOR_MAX} arasında sponsor olmalı` });
    const sponsors = [];
    for (const [i, item] of list.entries()) {
      const result = cleanSponsor(item || {}, i);
      if (result.error) return res.status(400).json({ error: result.error });
      sponsors.push(result.sponsor);
    }
    if (new Set(sponsors.map(s => s.id)).size !== sponsors.length) return res.status(400).json({ error: 'Sponsor kimlikleri tekrar ediyor' });
    const next = { sponsors, sideClose: req.body.sideClose !== false };
    if (!(await db.savePrivateJson(SPONSOR_FILE, next))) return res.status(500).json({ error: 'Kaydedilemedi' });
    sponsorCache = next;
    res.json(publicSponsorPayload(next));
  } catch (err) {
    console.error('Sponsor ayarı kaydedilemedi:', err.message);
    res.status(500).json({ error: 'Kaydedilemedi' });
  }
});

// ── Kalma süresi ölçümü: kişi bilgisi tutulmaz, sadece kaynağa göre toplam sayılar ──
const ENGAGE_FILE = 'engagement.json';
const ENGAGE_LIMITS = [10, 30, 120, 600];
const ENGAGE_PER_IP_MIN = 30;
const ENGAGE_KAYNAK = { davet: 'Davet linki', tanitim: 'Tanıtım linki', ilan: 'İlan linki' };
const ENGAGE_KNOWN = ['Google araması', 'Facebook', 'Instagram', 'WhatsApp', 'X (Twitter)'];
let engagement = null, engagementDirty = false;
const engageRate = new Map();
async function loadEngagement() {
  if (!engagement) {
    const saved = await db.getPrivateJson(ENGAGE_FILE);
    engagement = saved && saved.sources ? saved : { since: new Date().toISOString(), sources: {} };
  }
  return engagement;
}
function engageSource(body) {
  const kaynak = String(body.kaynak || '');
  if (Object.prototype.hasOwnProperty.call(ENGAGE_KAYNAK, kaynak)) return ENGAGE_KAYNAK[kaynak];
  const label = describeReferrer(String(body.referrer || '').slice(0, 300));
  if (ENGAGE_KNOWN.includes(label)) return label;
  return body.referrer ? 'Diğer' : 'Doğrudan';
}
setInterval(async () => {
  if (!engagementDirty || !engagement) return;
  engagementDirty = false;
  if (!(await db.savePrivateJson(ENGAGE_FILE, engagement))) engagementDirty = true;
}, 30 * 1000).unref();
setInterval(() => {
  const minuteAgo = Date.now() - 60 * 1000;
  for (const [ip, r] of engageRate) if (r.at < minuteAgo) engageRate.delete(ip);
}, 10 * 60 * 1000).unref();

app.post('/api/engagement', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
  res.status(204).end();
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || typeof body !== 'object') return;
    const seconds = Number(body.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) return;
    const ua = req.headers['user-agent'] || '';
    if (/bot|crawl|spider|preview|facebookexternalhit|headless/i.test(ua)) return;
    const ip = String(getIp(req)).split(',')[0].trim();
    const now = Date.now();
    const rate = engageRate.get(ip);
    const bucket = rate && now - rate.at < 60000 ? rate : { at: now, n: 0 };
    bucket.n++;
    engageRate.set(ip, bucket);
    if (bucket.n > ENGAGE_PER_IP_MIN) return;
    const data = await loadEngagement();
    const source = engageSource(body);
    const row = data.sources[source] || (data.sources[source] = { total: 0, interacted: 0, seconds: 0, buckets: [0, 0, 0, 0, 0] });
    row.total++;
    if (body.interacted === true) row.interacted++;
    row.seconds += Math.min(seconds, 1800);
    const index = ENGAGE_LIMITS.findIndex(limit => seconds < limit);
    row.buckets[index === -1 ? ENGAGE_LIMITS.length : index]++;
    engagementDirty = true;
  } catch (err) {
    console.error('Kalma süresi kaydedilemedi:', err.message);
  }
});

app.get('/api/admin/engagement', requireAdmin, async (req, res) => {
  try { res.json(await loadEngagement()); }
  catch (err) { console.error('Kalma süresi okunamadı:', err.message); res.status(500).json({ error: 'Okunamadı' }); }
});

app.delete('/api/admin/engagement', requireAdmin, async (req, res) => {
  try {
    engagement = { since: new Date().toISOString(), sources: {} };
    if (!(await db.savePrivateJson(ENGAGE_FILE, engagement))) return res.status(500).json({ error: 'Sıfırlanamadı' });
    engagementDirty = false;
    res.json({ ok: true });
  } catch (err) {
    console.error('Kalma süresi sıfırlanamadı:', err.message);
    res.status(500).json({ error: 'Sıfırlanamadı' });
  }
});


// ── Paylaşım linkleri: WhatsApp'ta resimli önizleme çıkar, tıklayan siteye geçer ──
const SHARE_LINKS = {
  davet: { image: 'esnaf', kaynak: 'davet', title: 'Dükkanınız NewHal haritasında!', description: 'Dükkanınızı ücretsiz sahiplenin, ürünlerinizi ekleyin, müşteriler sizi kolayca bulsun.' },
  tanitim: { image: 'genel', kaynak: 'tanitim', title: 'Mersin Hali artık cebinizde!', description: 'Hal esnafı tek haritada. Esnafa tek dokunuşla ulaşın, ücretsiz ilan verin.' },
  'ilan-ver': { image: 'ilan', kaynak: 'ilan', title: 'İlanınız hal esnafına ulaşsın', description: 'Ücretsiz ilan verin, 1 dakikada yayında.' },
};
Object.entries(SHARE_LINKS).forEach(([slug, link]) => {
  app.get(`/${slug}`, (req, res) => {
    const target = `/?kaynak=${link.kaynak}`;
    res.type('html').send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${link.title}</title>
<meta name="robots" content="noindex">
<meta name="description" content="${link.description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NewHal">
<meta property="og:title" content="${link.title}">
<meta property="og:description" content="${link.description}">
<meta property="og:url" content="https://newhal.com/${slug}">
<meta property="og:image" content="https://newhal.com/img/promo/${link.image}.jpg">
<meta property="og:image:secure_url" content="https://newhal.com/img/promo/${link.image}.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1080">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${target}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body><a href="${target}">NewHal'e git</a></body></html>`);
  });
});

// ── ADMIN: Etkinlik Kayıtları ─────────────────────────────────
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  res.json(await db.getLogs());
});

app.delete('/api/admin/logs', requireAdmin, async (req, res) => {
  const ok = await db.clearLogs();
  if (!ok) return res.status(500).json({ error: 'Loglar temizlenemedi' });
  res.json({ message: 'Loglar temizlendi' });
});

// ── ADMIN: Sohbet Geçmişini Temizle ──────────────────────────────
app.delete('/api/admin/chat', requireAdmin, async (req, res) => {
  await db.clearChat();
  res.json({ message: 'Sohbet geçmişi temizlendi' });
});

// ── Android uygulaması (Google Play) ile site bağı ──
// Uygulamanın imza parmak izleri; Google Play'in kendi imza anahtarı da eklenince
// ANDROID_SHA256 ortam değişkenine virgülle yazılır.
const ANDROID_PACKAGE = 'com.newhal.app';
const ANDROID_UPLOAD_SHA256 = '8E:D1:A2:6D:8E:9E:67:D5:E3:52:01:2A:B4:32:B8:17:22:AF:2A:83:7D:0C:C4:04:BA:46:D9:0B:41:CF:DD:D8';
// Google Play'in dağıttığı Android App Bundle sürümlerinin imza sertifikası.
const ANDROID_PLAY_SHA256 = '23:65:24:47:69:8F:CF:93:9A:A2:38:B1:47:79:58:19:D8:47:30:F6:93:BE:28:E8:EF:5D:4C:00:5E:8E:F0:1F';
app.get('/.well-known/assetlinks.json', (req, res) => {
  const prints = [ANDROID_UPLOAD_SHA256, ANDROID_PLAY_SHA256, ...String(process.env.ANDROID_SHA256 || '').split(',')]
    .map(s => s.trim().toUpperCase()).filter(Boolean);
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [...new Set(prints)] },
  }]);
});

// ── Telefon + şifre ile hesap ve kullanıcı profilleri ──
const accounts = require('./accounts')(app, { db, supabase: db.supabase, jwt, JWT_SECRET, requireAuth, getIp, notifyNewMember });
require('./social')(app, {
  supabase: db.supabase, jwt, JWT_SECRET, requireAuth, sendBrowserPush,
  sendNotificationEmail: emailNotifications.sendNotificationEmail, awardEconomyPoints,
});

// ── Hesabımı sil: kullanıcının hesabı ve kişisel verileri kalıcı olarak silinir ──
// İlanları (resim/video dosyalarıyla) silinir; sahibi olduğu dükkanlar rehberde sahipsiz kalır.
app.delete('/api/profile/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'user' || !req.user.id) return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
  const userId = req.user.id;
  try {
    const ads = await db.getAds();
    const mine = ads.filter(a => a.owner && a.owner.id === userId);
    if (mine.length) {
      if (!(await db.saveAds(ads.filter(a => !mine.includes(a))))) throw new Error('İlanlar silinemedi');
      for (const ad of mine) await deleteAdFiles(ad);
    }
    for (const pin of await db.getPinsByOwner(userId)) await db.setPinOwner(pin.id, null);
    await db.supabase.from('pins').update({ owner_id: null }).eq('owner_id', userId);

    const claims = await getClaims();
    claims.requests = claims.requests.filter(r => r.userId !== userId);
    for (const [pinId, v] of Object.entries(claims.verified)) if (v.userId === userId) delete claims.verified[pinId];
    await saveClaims(claims);

    await accounts.forgetUser(userId);
    const { error } = await db.supabase.from('users').delete().eq('id', userId);
    if (error) throw new Error(error.message);
    await db.logActivity(`Bir kullanıcı hesabını sildi (${mine.length} ilan silindi)`, true);
    res.json({ message: 'Hesabınız ve verileriniz silindi' });
  } catch (err) {
    console.error('Hesap silinemedi:', err.message);
    res.status(500).json({ error: 'Hesap silinemedi, tekrar deneyin' });
  }
});

// ── Arama motoru sayfaları (işletme sayfaları, site haritası) ──
require('./seo')(app, { db, getClaims, siteUrl: SITE_URL });

// ── Sayfa yönlendirme ─────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/hesap-silme', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hesap-silme.html'));
});

for (const sayfa of ['hakkimizda', 'iletisim', 'kullanim-sartlari']) {
  app.get(`/${sayfa}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${sayfa}.html`));
  });
}

app.get('/gizlilik', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gizlilik.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ NewHal sunucusu çalışıyor!`);
  console.log(`🌐 Ana site   : http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin\n`);
  loadMersinWeatherStory();
  scheduleMersinWeatherRefresh();
});
