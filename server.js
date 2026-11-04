require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const db      = require('./database');
const bcrypt  = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app        = express();
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
      .select('user_id,amount').order('id', { ascending: true }).range(offset, offset + 999);
    if (error) return res.status(500).json({ error: 'Kullanıcı puanları alınamadı' });
    (data || []).forEach(row => balances.set(row.user_id, (balances.get(row.user_id) || 0) + Number(row.amount || 0)));
    if (!data || data.length < 1000) break;
  }
  const users = await db.getAllUsers();
  res.json(users.map(user => ({ ...user, points_balance: balances.get(user.id) || 0 })));
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

app.post('/api/admin/notifications/broadcast', requireAdmin, async (req, res) => {
  const title = String(req.body.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 1500);
  if (!title || !body) return res.status(400).json({ error: 'Başlık ve mesaj zorunludur' });

  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.supabase.from('users').select('id').order('id', { ascending: true }).range(offset, offset + 999);
    if (error) return res.status(500).json({ error: 'Kullanıcı listesi alınamadı' });
    ids.push(...(data || []).map(user => user.id));
    if (!data || data.length < 1000) break;
  }
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
    sent += rows.length;
  }
  res.json({ sent });
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
    res.redirect(`/?googleAuth=success&token=${token}&name=${encodeURIComponent(req.user.name)}${pointsAwarded ? '&points=100' : ''}`);
  }
);

// ── PUBLIC: Onaylı iğneleri getir ────────────────────────────
// IP adresleri kişisel veri: herkese açık yanıtlardan çıkarılır, sadece admin görür
const stripIp = ({ ip, ...rest }) => rest;

app.get('/api/pins', async (req, res) => {
  const [pins, claims] = await Promise.all([db.getApprovedPins(), getClaims()]);
  res.json(pins.map(p => ({ ...p, verified: !!claims.verified[p.id], comments: (p.comments || []).map(stripIp) })));
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
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country`, {
      signal: AbortSignal.timeout(3000),
      headers: { 'User-Agent': 'NewHal-Visitor-Notification/1.0' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.success) return null;

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
  res.json(await db.getPins(req.query.status || null));
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
  if (name.trim().length > 40 || (icon && icon.trim().length > 8)) {
    return res.status(400).json({ error: 'Kategori adı en fazla 40, ikon en fazla 8 karakter olabilir' });
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
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1';
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

app.get('/api/ads', async (req, res) => {
  const ads = (await getAdsWithFeaturedExpiry()).filter(a => a.active !== false && !a.pending);
  res.json(ads.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicAd));
});

// ── Kullanıcı ilanları: giriş yapan herkes verebilir, hemen yayınlanır (yönetici gizleyip silebilir) ──
const USER_MAX_ADS_PER_DAY = 10;

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
  res.status(201).json({ id: created.id, story: !!created.pinId, message: 'İlanınız yayınlandı' });
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
    status: a.pending ? 'pending' : a.active === false ? 'hidden' : 'live',
  })));
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
  if (req.body.whatsapp_sent) ad.whatsapp_sent_at = new Date().toISOString();
  if (!(await db.saveAds(ads))) return res.status(500).json({ error: 'Kaydedilemedi' });
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
app.get('/.well-known/assetlinks.json', (req, res) => {
  const prints = [ANDROID_UPLOAD_SHA256, ...String(process.env.ANDROID_SHA256 || '').split(',')]
    .map(s => s.trim().toUpperCase()).filter(Boolean);
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [...new Set(prints)] },
  }]);
});

// ── Telefon + şifre ile hesap ve kullanıcı profilleri ──
const accounts = require('./accounts')(app, { db, supabase: db.supabase, jwt, JWT_SECRET, requireAuth, getIp });
require('./social')(app, { supabase: db.supabase, jwt, JWT_SECRET, requireAuth });

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

app.get('/gizlilik', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gizlilik.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ NewHal sunucusu çalışıyor!`);
  console.log(`🌐 Ana site   : http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin\n`);
});
