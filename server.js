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

function cleanAd(body, { allowVideoFile = true } = {}) {
  const title = String(body.title || '').trim().slice(0, AD_TITLE_MAX);
  const text  = String(body.body || '').trim().slice(0, AD_BODY_MAX);
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

const adMedia = ad => [...(ad.images || []), ad.video && ad.video.type === 'file' ? ad.video.url : null];

// İlanın resim/video dosyalarını hangi depodaysa oradan siler
async function deleteAdFiles(ad) {
  const files = adMedia(ad).filter(Boolean);
  await db.deleteAdMedia(files);
  await db.deletePinImages(files);
}

// Herkese açık ilan: ekleyenin hesap kimliği gösterilmez
const publicAd = ({ owner, ...ad }) => (owner ? { ...ad, owner_name: owner.name } : ad);

app.get('/api/ads', async (req, res) => {
  const ads = (await db.getAds()).filter(a => a.active !== false && !a.pending);
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
  const created = {
    id: crypto.randomUUID(), ...ad, featured: false, active: true,
    owner: { id: req.user.id, name: req.user.name || 'Kullanıcı' }, created_at: new Date().toISOString(),
  };
  if (!(await db.saveAds([created, ...ads]))) return res.status(500).json({ error: 'İlan kaydedilemedi' });
  res.status(201).json({ id: created.id, message: 'İlanınız yayınlandı' });
});

app.get('/api/my-ads', requireAuth, async (req, res) => {
  const ads = (await db.getAds()).filter(a => a.owner && a.owner.id === req.user.id);
  res.json(ads.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(a => ({
    id: a.id, title: a.title, body: a.body, images: a.images, video: a.video, created_at: a.created_at,
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
  const ads = await db.getAds();
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
  const created = { id: crypto.randomUUID(), ...ad, featured: !!req.body.featured, active: true, created_at: new Date().toISOString() };
  if (!(await db.saveAds([created, ...ads]))) return res.status(500).json({ error: 'İlan kaydedilemedi' });
  res.status(201).json(created);
});

// Yayından kaldır / yeniden yayınla
app.patch('/api/admin/ads/:id', requireAdmin, async (req, res) => {
  const ads = await db.getAds();
  const ad = ads.find(a => a.id === req.params.id);
  if (!ad) return res.status(404).json({ error: 'İlan bulunamadı' });
  // Yayında/gizli ve vitrin durumu ayrı ayrı değiştirilebilir
  if ('active' in req.body) ad.active = !!req.body.active;
  if (ad.active) delete ad.pending;   // yayına alınan kullanıcı ilanı artık onaylıdır
  if ('featured' in req.body) ad.featured = !!req.body.featured;
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
const SITE_URL        = process.env.SITE_URL || 'https://newhal.onrender.com';

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

app.delete('/api/admin/facebook', requireAdmin, async (req, res) => {
  await db.deletePrivateJson(FB_CONFIG_FILE);
  res.json({ connected: false });
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

// ── Sayfa yönlendirme ─────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/gizlilik', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gizlilik.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ NewHal sunucusu çalışıyor!`);
  console.log(`🌐 Ana site   : http://localhost:${PORT}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin\n`);
});
