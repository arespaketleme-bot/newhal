/* ═══════════════════════════════════════════════════════════════
   NewHal — telefon + şifre ile hesap ve kullanıcı profilleri
   Hesap: users tablosunda google_id = "tel:+905xxxxxxxxx" olan satır
   Şifre özetleri: gizli depoda accounts.json  { [userId]: { phone, hash } }
   Profil bilgileri: gizli depoda profiles.json { [userId]: { about, contact_phone, show_phone } }
   ═══════════════════════════════════════════════════════════════ */

const bcrypt = require('bcryptjs');

const ACCOUNTS_FILE = 'accounts.json';
const PROFILES_FILE = 'profiles.json';
const NAME_MAX = 60;
const ABOUT_MAX = 400;
const PASSWORD_MIN = 6;
const LOGIN_TRIES = 8;               // 15 dakikada bir telefon için yanlış şifre hakkı
const REGISTER_PER_HOUR = 5;          // bir internet adresinden saatte yeni hesap

// "0532 123 45 67", "5321234567", "+90 532..." → "+905321234567"; anlaşılmazsa null
function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return /^[2-5]\d{9}$/.test(d) ? `+90${d}` : null;
}

const prettyPhone = p => p ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9, 11)} ${p.slice(11)}` : '';

function cleanName(input) {
  const name = String(input || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name.split(' ').filter(w => /\p{L}/u.test(w)).length >= 2 ? name : null;
}

module.exports = function registerAccounts(app, { db, supabase, jwt, JWT_SECRET, requireAuth, getIp, notifyNewMember, awardEconomyPoints }) {
  // Gizli depodaki iki dosya, okunduktan sonra bellekte tutulur
  const stores = {};
  async function load(file) {
    if (!stores[file]) stores[file] = (await db.getPrivateJson(file)) || {};
    return stores[file];
  }
  async function save(file, data) {
    stores[file] = data;
    return db.savePrivateJson(file, data);
  }

  const signToken = user => jwt.sign(
    { id: user.id, name: user.name, email: user.email || '', role: 'user' }, JWT_SECRET, { expiresIn: '30d' });

  const loginFails = new Map();   // telefon → yanlış deneme zamanları
  const registers = new Map();    // IP → kayıt zamanları
  const recent = (map, key, windowMs) => (map.get(key) || []).filter(t => t > Date.now() - windowMs);
  const dayKey = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const cleanReferralCode = value => /^NH[1-9]\d{0,17}$/i.test(String(value || '').trim())
    ? String(value).trim().toUpperCase() : '';

  async function awardDailyLogin(userId) {
    try {
      const { data, error } = await supabase.rpc('newhal_award_daily_login', {
        p_user_id: userId,
        p_day_key: dayKey(),
      });
      if (error) throw error;
      return data === true;
    } catch (error) {
      console.error('Günlük giriş puanı verilemedi:', error.message);
      return false;
    }
  }

  async function awardReferral(newUserId, referralCode) {
    const code = cleanReferralCode(referralCode);
    if (!code) return false;
    const referrerId = Number(code.slice(2));
    if (!Number.isSafeInteger(referrerId) || referrerId === Number(newUserId)) return false;
    try {
      const { data, error } = await supabase.rpc('newhal_award_referral', {
        p_referrer_id: referrerId,
        p_referred_id: newUserId,
      });
      if (error) throw error;
      return data === true;
    } catch (error) {
      console.error('Referans puanı verilemedi:', error.message);
      return false;
    }
  }

  // ── Kayıt ──
  app.post('/api/auth/register', async (req, res) => {
    const ip = String(getIp(req)).split(',')[0].trim();
    const tries = recent(registers, ip, 60 * 60 * 1000);
    if (tries.length >= REGISTER_PER_HOUR) return res.status(429).json({ error: 'Çok fazla kayıt denemesi, bir saat sonra tekrar deneyin' });

    const name = cleanName(req.body.name);
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ error: 'Adınızı ve soyadınızı yazın' });
    if (!phone) return res.status(400).json({ error: 'Geçerli bir telefon numarası yazın (05xx xxx xx xx)' });
    if (password.length < PASSWORD_MIN) return res.status(400).json({ error: `Şifre en az ${PASSWORD_MIN} karakter olmalı` });

    const { data: existing } = await supabase.from('users').select('id').eq('google_id', `tel:${phone}`).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Bu telefonla zaten bir hesap var. Giriş yapın.' });

    const { data: user, error } = await supabase.from('users')
      .insert({ google_id: `tel:${phone}`, name, email: '', avatar: '' }).select().single();
    if (error || !user) return res.status(500).json({ error: 'Hesap açılamadı, tekrar deneyin' });

    const accounts = await load(ACCOUNTS_FILE);
    accounts[user.id] = { phone, hash: await bcrypt.hash(password, 10), created_at: new Date().toISOString() };
    if (!(await save(ACCOUNTS_FILE, accounts))) {
      await supabase.from('users').delete().eq('id', user.id);
      return res.status(500).json({ error: 'Hesap açılamadı, tekrar deneyin' });
    }
    const pointsAwarded = await awardDailyLogin(user.id);
    const referralAwarded = await awardReferral(user.id, req.body.referralCode);
    // Hoş geldin hediyesi: yeni üyeye bir kez Para Puan
    const welcomeBonus = awardEconomyPoints
      ? (await awardEconomyPoints(user.id, 'welcome_bonus', `welcome:${user.id}`).catch(() => ({ amount: 0 }))).amount
      : 0;
    tries.push(Date.now());
    registers.set(ip, tries);
    res.status(201).json({ token: signToken(user), name: user.name, pointsAwarded, referralAwarded, welcomeBonus });
    if (notifyNewMember) {
      notifyNewMember(user).catch(err => console.error('Yeni üye Telegram bildirimi gönderilemedi:', err.message));
    }
  });

  // ── Giriş ──
  app.post('/api/auth/login', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Geçerli bir telefon numarası yazın' });
    const fails = recent(loginFails, phone, 15 * 60 * 1000);
    if (fails.length >= LOGIN_TRIES) return res.status(429).json({ error: 'Çok fazla yanlış deneme. 15 dakika sonra tekrar deneyin.' });

    const { data: user } = await supabase.from('users').select('*').eq('google_id', `tel:${phone}`).maybeSingle();
    const account = user && (await load(ACCOUNTS_FILE))[user.id];
    const ok = account && await bcrypt.compare(String(req.body.password || ''), account.hash);
    if (!ok) {
      fails.push(Date.now());
      loginFails.set(phone, fails);
      return res.status(401).json({ error: 'Telefon ya da şifre hatalı' });
    }
    loginFails.delete(phone);
    const pointsAwarded = await awardDailyLogin(user.id);
    res.json({ token: signToken(user), name: user.name, pointsAwarded });
  });

  // ── Kendi profilim ──
  app.get('/api/profile/me', requireAuth, async (req, res) => {
    if (req.user.role !== 'user') return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Hesap bulunamadı' });
    const [accounts, profiles, shops] = await Promise.all([load(ACCOUNTS_FILE), load(PROFILES_FILE), db.getPinsByOwner(user.id)]);
    const account = accounts[user.id];
    const profile = profiles[user.id] || {};
    const [pointsBalance, activities] = await Promise.all([getPointsBalance(user.id), getRecentActivities(user.id)]);
    const level = Math.floor(pointsBalance / 1000) + 1;
    const levelProgress = pointsBalance % 1000;
    res.json({
      id: user.id, name: user.name, avatar: user.avatar || '', email: user.email || '',
      points_balance: pointsBalance, level, level_progress: levelProgress, referral_code: `NH${user.id}`,
      login: account ? 'telefon' : 'google',
      login_phone: account ? prettyPhone(account.phone) : '',
      about: profile.about || '', contact_phone: profile.contact_phone || '', show_phone: !!profile.show_phone,
      created_at: user.created_at, shops, activities,
    });
  });

  async function getPointsBalance(userId) {
    let balance = 0;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('newhal_points_ledger').select('amount,created_by')
        .eq('user_id', userId).order('id', { ascending: true }).range(offset, offset + 999);
      if (error) {
        console.error('Para Puan bakiyesi alınamadı:', error.message);
        return balance;
      }
      (data || []).forEach(row => { balance += row.created_by === 'economy:vitrin_purchase' ? -Math.abs(Number(row.amount || 0)) : Number(row.amount || 0); });
      if (!data || data.length < 1000) break;
    }
    return balance;
  }

  async function getRecentActivities(userId) {
    const { data, error } = await supabase.from('newhal_points_ledger')
      .select('amount,reason,created_by,created_at').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(20);
    if (error) {
      console.error('Profil aktiviteleri alınamadı:', error.message);
      return [];
    }
    const labels = {
      ad_created: ['📢', 'İlan ekledi'], ad_like: ['♥', 'İlan beğendi'], ad_comment: ['💬', 'İlana yorum yaptı'],
      follow_given: ['👥', 'Bir üyeyi takip etti'], followed_received: ['👤', 'Yeni takipçi kazandı'],
      daily_login: ['☀️', 'Günlük giriş yaptı'], referral: ['🎁', 'Davet ödülü kazandı'], vitrin_purchase: ['⭐', 'Vitrin başvurusu yaptı'],
    };
    return (data || []).map(row => {
      const type = String(row.created_by || '').replace(/^economy:/, '') || row.reason;
      const [icon, label] = labels[type] || ['💰', 'Para Puan kazandı'];
      return { type, icon, label, points: type === 'vitrin_purchase' ? -Math.abs(Number(row.amount || 0)) : Number(row.amount || 0), created_at: row.created_at };
    });
  }

  app.put('/api/profile/me', requireAuth, async (req, res) => {
    if (req.user.role !== 'user') return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Adınızı ve soyadınızı yazın' });
    const about = String(req.body.about || '').trim().slice(0, ABOUT_MAX);
    const rawPhone = String(req.body.contact_phone || '').trim();
    const contactPhone = rawPhone ? normalizePhone(rawPhone) : '';
    if (rawPhone && !contactPhone) return res.status(400).json({ error: 'İletişim telefonu anlaşılamadı' });
    const avatarIn = String(req.body.avatar || '');
    const avatar = !avatarIn || avatarIn.startsWith(db.pinImageUrlPrefix()) || /^https:\/\/lh\d\.googleusercontent\.com\//.test(avatarIn) ? avatarIn : undefined;

    const update = { name, ...(avatar !== undefined ? { avatar } : {}) };
    const { data: user, error } = await supabase.from('users').update(update).eq('id', req.user.id).select().single();
    if (error || !user) return res.status(500).json({ error: 'Profil kaydedilemedi' });

    // İlanlarda görünen ad da yeni ada geçer
    const ads = await db.getAds();
    const mine = ads.filter(a => a.owner && a.owner.id === user.id && a.owner.name !== user.name);
    if (mine.length) { mine.forEach(a => { a.owner.name = user.name; }); await db.saveAds(ads); }

    const profiles = await load(PROFILES_FILE);
    profiles[user.id] = { about, contact_phone: contactPhone, show_phone: !!req.body.show_phone && !!contactPhone };
    await save(PROFILES_FILE, profiles);
    res.json({ token: signToken(user), name: user.name, avatar: user.avatar || '' });
  });

  app.put('/api/profile/password', requireAuth, async (req, res) => {
    const accounts = await load(ACCOUNTS_FILE);
    const account = accounts[req.user.id];
    if (!account) return res.status(400).json({ error: 'Google ile giriş yapan hesapların şifresi yoktur' });
    if (!(await bcrypt.compare(String(req.body.old || ''), account.hash))) return res.status(401).json({ error: 'Mevcut şifre hatalı' });
    const next = String(req.body.new || '');
    if (next.length < PASSWORD_MIN) return res.status(400).json({ error: `Yeni şifre en az ${PASSWORD_MIN} karakter olmalı` });
    account.hash = await bcrypt.hash(next, 10);
    await save(ACCOUNTS_FILE, accounts);
    res.json({ message: 'Şifre değiştirildi' });
  });

  // ── Herkese açık profil ──
  app.get('/api/users/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const { data: user } = await supabase.from('users').select('id, name, avatar, created_at').eq('id', id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const [profiles, shops] = await Promise.all([load(PROFILES_FILE), db.getPinsByOwner(id)]);
    const profile = profiles[id] || {};
    res.json({
      id: user.id, name: user.name, avatar: user.avatar || '', created_at: user.created_at,
      about: profile.about || '',
      phone: profile.show_phone && profile.contact_phone ? prettyPhone(profile.contact_phone) : '',
      shops,
    });
  });

  // Hesap silinince şifre ve profil kayıtları da silinir
  async function forgetUser(userId) {
    for (const file of [ACCOUNTS_FILE, PROFILES_FILE]) {
      const data = await load(file);
      if (data[userId]) { delete data[userId]; await save(file, data); }
    }
  }

  // Admin kullanıcı listesinde iletişim telefonu varsa onu, yoksa telefonla giriş numarasını göster.
  async function getAdminPhones(userIds) {
    const [accounts, profiles] = await Promise.all([load(ACCOUNTS_FILE), load(PROFILES_FILE)]);
    return Object.fromEntries(userIds.map(id => {
      const profilePhone = profiles[id] && profiles[id].contact_phone;
      const loginPhone = accounts[id] && accounts[id].phone;
      return [id, prettyPhone(profilePhone || loginPhone || '')];
    }));
  }

  return { forgetUser, getAdminPhones };
};
