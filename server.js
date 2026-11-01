require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const db      = require('./database');
const bcrypt  = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'newhal_secret';

app.use(cors());
app.use(express.json());
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
  res.json(await db.getAllUsers());
});

// ── PUBLIC: Google Auth Routes ────────────────────────────────
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

app.get('/auth/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: '/?error=google_auth_failed' }),
  function(req, res) {
    const token = jwt.sign(
      { id: req.user.id, name: req.user.name, email: req.user.email, role: 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.redirect(`/?googleAuth=success&token=${token}&name=${encodeURIComponent(req.user.name)}`);
  }
);

// ── PUBLIC: Onaylı iğneleri getir ────────────────────────────
// IP adresleri kişisel veri: herkese açık yanıtlardan çıkarılır, sadece admin görür
const stripIp = ({ ip, ...rest }) => rest;

app.get('/api/pins', async (req, res) => {
  const pins = await db.getApprovedPins();
  res.json(pins.map(p => ({ ...p, comments: (p.comments || []).map(stripIp) })));
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
  res.json({ visits: await db.getVisits() });
});

// ── PUBLIC: Yeni iğne ekle (onay bekliyor) ───────────────────
app.post('/api/pins', requireAuth, async (req, res) => {
  const { title, address, phone, website, email, lat, lng, category } = req.body;
  if (!title || !address || !lat || !lng) {
    return res.status(400).json({ error: 'Ünvan, adres ve konum zorunlu' });
  }
  const pin = await db.addPin({ title, address, phone, website, email, lat, lng, category });
  res.status(201).json({ id: pin.id, message: 'İğne başarıyla gönderildi, onay bekleniyor.' });
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

// ── ADMIN: Sohbet Geçmişini Temizle ──────────────────────────────
app.delete('/api/admin/chat', requireAdmin, async (req, res) => {
  await db.clearChat();
  res.json({ message: 'Sohbet geçmişi temizlendi' });
});

// ── Sayfa yönlendirme ─────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ NewHal sunucusu çalışıyor!`);
  console.log(`🌐 Ana site   : http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin\n`);
});
