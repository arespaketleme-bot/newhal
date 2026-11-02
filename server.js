require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('./database');
const bcrypt  = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'newhal_secret';

app.use(cors());
// Fotoğraf yükleme kendi (daha büyük) sınırıyla ayrıca okunur
const jsonSmall = express.json();
app.use((req, res, next) => (req.path === '/api/uploads' ? next() : jsonSmall(req, res, next)));
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

// ── Sayfa yönlendirme ─────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ NewHal sunucusu çalışıyor!`);
  console.log(`🌐 Ana site   : http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin\n`);
});
