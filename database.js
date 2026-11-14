const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('HATA: SUPABASE_URL veya SUPABASE_KEY ortam değişkenleri tanımlı değil.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const PIN_IMAGE_BUCKET = 'pin-images';
const AD_MEDIA_BUCKET  = 'ad-media';   // ilan resim ve videoları (herkese açık okuma)
// Depoda dosya gerçekten yok mu (ilk kullanım), yoksa geçici bir hata mı?
const isStorageNotFound = e => !!e && (/not.?found/i.test(String(e.message || '')) || String(e.statusCode) === '404');
const APP_DATA_BUCKET  = 'app-data';   // ilan listesi (özel)
const ADS_FILE         = 'ads.json';
const ADS_CACHE_MS     = 60 * 1000;
const AD_FIRST_NO      = 1000;
let adsCache = null;

// Numarası olmayan ilanlara eskiden yeniye sıralı numara verir (#1000, #1001 ...); değişiklik olduysa true
function assignAdNumbers(list) {
  let next = Math.max(AD_FIRST_NO - 1, ...list.map(a => a.no || 0)) + 1;
  let changed = false;
  [...list].filter(a => !a.no)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .forEach(a => { a.no = next++; changed = true; });
  return changed;
}

const db = {
  /** Kullanıcı İşlemleri */
  async getAllUsers() {
    const { data } = await supabase.from('users').select('*').order('id', { ascending: false });
    return data || [];
  },

  async findOrCreateGoogleUser({ googleId, name, email, avatar }) {
    let { data: user } = await supabase.from('users').select('*').eq('google_id', googleId).single();
    if (!user && email) {
      const { data: userByEmail } = await supabase.from('users').select('*').eq('email', email).single();
      if (userByEmail) {
        const { data: updatedUser } = await supabase.from('users').update({ google_id: googleId, avatar }).eq('id', userByEmail.id).select().single();
        return updatedUser ? { ...updatedUser, _newhalCreated: false } : null;
      }
    }
    let created = false;
    if (!user) {
      const { data: newUser, error } = await supabase.from('users').insert({
        google_id: googleId,
        name: name || 'İsimsiz Kullanıcı',
        email: email || '',
        avatar: avatar || ''
      }).select().single();
      if (error) console.error('Google kullanıcısı kaydedilemedi:', error.message);
      user = newUser;
      created = !!newUser;
    }
    return user ? { ...user, _newhalCreated: created } : null;
  },

  /** Kategoriler */
  async getCategories() {
    const { data } = await supabase.from('categories').select('*').order('id', { ascending: true });
    return data || [];
  },

  async addCategory({ name, icon }) {
    const { data: existing } = await supabase.from('categories').select('*').ilike('name', name).single();
    if (existing) return { error: 'Bu kategori zaten mevcut' };

    const { data } = await supabase.from('categories').insert({
      name: name.trim(),
      icon: icon ? icon.trim() : '📦'
    }).select().single();
    return data;
  },

  async updateCategory(oldName, { name, icon }) {
    if (oldName.toLowerCase() === 'genel' && name.toLowerCase() !== 'genel') {
      return { error: 'Varsayılan Genel kategorisinin adı değiştirilemez' };
    }

    if (oldName.toLowerCase() !== name.toLowerCase()) {
      const { data: existing } = await supabase.from('categories').select('*').ilike('name', name).single();
      if (existing) return { error: 'Bu isimde başka bir kategori zaten mevcut' };
    }

    const { data: cat } = await supabase.from('categories').select('*').ilike('name', oldName).single();
    if (!cat) return { error: 'Kategori bulunamadı' };

    const trimmedName = name.trim();
    const trimmedIcon = icon ? icon.trim() : '📦';

    await supabase.from('categories').update({ name: trimmedName, icon: trimmedIcon }).eq('id', cat.id);
    await supabase.from('pins').update({ category: trimmedName }).ilike('category', oldName);

    return { name: trimmedName, icon: trimmedIcon };
  },

  async deleteCategory(name) {
    if (name.toLowerCase() === 'genel') {
      return { error: 'Varsayılan Genel kategorisi silinemez' };
    }

    const { data: cat } = await supabase.from('categories').select('*').ilike('name', name).single();
    if (!cat) return { error: 'Kategori bulunamadı' };

    await supabase.from('categories').delete().eq('id', cat.id);
    await supabase.from('pins').update({ category: 'Genel' }).ilike('category', name);

    return { success: true };
  },

  /** Pin İşlemleri */
  async getPins(status) {
    let query = supabase.from('pins').select('*, comments:pin_comments(*)').order('id', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  },

  async getApprovedPins() {
    return this.getPins('approved');
  },

  async addPin({ title, address, phone, website, email, lat, lng, category, sells, seeks, images, ownerId }) {
    const { data } = await supabase.from('pins').insert({
      title,
      address,
      phone: phone || '',
      website: website || '',
      email: email || '',
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      category: category || 'Genel',
      sells: sells || [],
      seeks: seeks || [],
      images: images || [],
      owner_id: ownerId || null,
      status: 'pending'
    }).select().single();
    return data;
  },

  async getPin(id) {
    const { data } = await supabase.from('pins').select('*, comments:pin_comments(*)').eq('id', parseInt(id)).single();
    return data;
  },

  async getPinEngagement(pinIds, viewerId = null) {
    const ids = [...new Set((pinIds || []).map(Number).filter(Number.isSafeInteger))];
    if (!ids.length) return new Map();
    const { data, error } = await supabase.rpc('get_pin_engagement', {
      p_pin_ids: ids,
      p_viewer_id: viewerId ? Number(viewerId) : null,
    });
    if (error) throw error;
    return new Map((data || []).map(row => [Number(row.pin_id), {
      likeCount: Number(row.like_count || 0),
      likedByViewer: !!row.liked_by_viewer,
    }]));
  },

  async setPinLike(pinId, userId, liked) {
    if (liked) {
      const { error } = await supabase.from('pin_likes').upsert({
        pin_id: Number(pinId),
        user_id: Number(userId),
      }, { onConflict: 'pin_id,user_id', ignoreDuplicates: true });
      return { error };
    }
    const { error } = await supabase.from('pin_likes')
      .delete().eq('pin_id', Number(pinId)).eq('user_id', Number(userId));
    return { error };
  },

  async getPinCommentCount(pinId) {
    const { count, error } = await supabase.from('pin_comments')
      .select('id', { count: 'exact', head: true }).eq('pin_id', Number(pinId));
    if (error) throw error;
    return count || 0;
  },

  async adjustPinLevelBonus(pinId, delta) {
    const { data, error } = await supabase.rpc('adjust_pin_level_bonus', {
      p_pin_id: Number(pinId),
      p_delta: Number(delta),
    });
    return { bonus: data, error };
  },

  /** Ürünler & fotoğraflar (işletme sahibi veya admin günceller) */
  async updatePinCatalog(id, { sells, seeks, images }) {
    const { data } = await supabase.from('pins').update({ sells, seeks, images })
      .eq('id', parseInt(id)).select().single();
    return data;
  },

  /** Fotoğraf yükleme (Supabase Storage, herkese açık okuma) */
  async uploadPinImage(path, buffer, contentType) {
    const { error } = await supabase.storage.from(PIN_IMAGE_BUCKET).upload(path, buffer, { contentType, upsert: false });
    if (error) {
      console.error('Fotoğraf yüklenemedi:', error.message);
      return null;
    }
    return supabase.storage.from(PIN_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  async deletePinImages(urls) {
    const prefix = this.pinImageUrlPrefix();
    const paths = (urls || []).filter(u => u.startsWith(prefix)).map(u => u.slice(prefix.length));
    if (paths.length) await supabase.storage.from(PIN_IMAGE_BUCKET).remove(paths);
  },

  pinImageUrlPrefix() {
    return supabase.storage.from(PIN_IMAGE_BUCKET).getPublicUrl('').data.publicUrl;
  },

  /** İlanlar: liste özel depoda tek dosya olarak tutulur (sadece admin yazar) */
  async getAds() {
    if (adsCache && Date.now() - adsCache.at < ADS_CACHE_MS) return adsCache.list;
    const { data, error } = await supabase.storage.from(APP_DATA_BUCKET).download(ADS_FILE);
    let list = [];
    // Depo geçici olarak yanıt vermezse liste "boş" sayılmaz: yoksa ilk kayıtta tüm ilanların üzerine yazılırdı
    if (error && !isStorageNotFound(error)) {
      console.error('İlanlar okunamadı:', error.message);
      if (adsCache) return adsCache.list;   // elde eski liste varsa onunla devam
      throw new Error('İlanlar şu an okunamadı, lütfen biraz sonra tekrar deneyin');
    }
    if (!error && data) {
      const text = await data.text();
      try { list = JSON.parse(text); } catch {
        throw new Error('İlan dosyası okunamadı (bozuk)');
      }
      if (!Array.isArray(list)) throw new Error('İlan dosyası beklenen biçimde değil');
    }
    adsCache = { at: Date.now(), list };
    if (assignAdNumbers(list)) await this.saveAds(list);   // eski ilanlar ilk okumada numaralanır
    return list;
  },

  async saveAds(list) {
    assignAdNumbers(list);   // yeni ilan kaydedilirken numarasını alır
    const body = new Blob([JSON.stringify(list)], { type: 'application/json' });
    const { error } = await supabase.storage.from(APP_DATA_BUCKET).upload(ADS_FILE, body, { upsert: true, contentType: 'application/json' });
    if (error) {
      console.error('İlanlar kaydedilemedi:', error.message);
      return false;
    }
    adsCache = { at: Date.now(), list };
    return true;
  },

  /** Özel ayar dosyaları (ör. Facebook sayfa bağlantısı) — herkese kapalı depoda */
  // Dosya yoksa null döner. Depo yanıt vermezse ya da dosya bozuksa hata fırlatır:
  // böylece "boş" sanılıp üzerine yazılmaz (ör. telefonla üye olanların şifre dosyası).
  async getPrivateJson(name) {
    const { data, error } = await supabase.storage.from(APP_DATA_BUCKET).download(name);
    if (error) {
      if (isStorageNotFound(error)) return null;
      console.error(`${name} okunamadı:`, error.message);
      throw new Error(`${name} şu an okunamadı`);
    }
    if (!data) return null;
    const text = await data.text();
    try { return JSON.parse(text); } catch {
      console.error(`${name} bozuk, okunamadı`);
      throw new Error(`${name} okunamadı (bozuk)`);
    }
  },

  async savePrivateJson(name, value) {
    const body = new Blob([JSON.stringify(value)], { type: 'application/json' });
    const { error } = await supabase.storage.from(APP_DATA_BUCKET).upload(name, body, { upsert: true, contentType: 'application/json' });
    if (error) console.error(`${name} kaydedilemedi:`, error.message);
    return !error;
  },

  async deletePrivateJson(name) {
    const { error } = await supabase.storage.from(APP_DATA_BUCKET).remove([name]);
    return !error;
  },

  adMediaUrlPrefix() {
    return supabase.storage.from(AD_MEDIA_BUCKET).getPublicUrl('').data.publicUrl;
  },

  // Tarayıcının dosyayı doğrudan depoya yükleyeceği tek kullanımlık adres
  async createAdUploadUrl(path) {
    const { data, error } = await supabase.storage.from(AD_MEDIA_BUCKET).createSignedUploadUrl(path);
    if (error) {
      console.error('Yükleme adresi alınamadı:', error.message);
      return null;
    }
    return { uploadUrl: data.signedUrl, publicUrl: supabase.storage.from(AD_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl };
  },

  async deleteAdMedia(urls) {
    const prefix = this.adMediaUrlPrefix();
    const paths = (urls || []).filter(u => u && u.startsWith(prefix)).map(u => u.slice(prefix.length));
    if (paths.length) await supabase.storage.from(AD_MEDIA_BUCKET).remove(paths);
  },

  async updatePin(id, { title, address, phone, website, email, category, lat, lng }) {
    const { data } = await supabase.from('pins').update({
      title: title.trim(),
      address: address.trim(),
      phone: phone ? phone.trim() : '',
      website: website ? website.trim() : '',
      email: email ? email.trim() : '',
      category: category || 'Genel',
      lat: parseFloat(lat),
      lng: parseFloat(lng)
    }).eq('id', parseInt(id)).select().single();
    return data;
  },

  /** Kişinin sahibi olduğu yayındaki dükkanlar */
  async getPinsByOwner(ownerId) {
    const { data } = await supabase.from('pins').select('id, title, category')
      .eq('owner_id', ownerId).eq('status', 'approved').order('title');
    return data || [];
  },

  /** Dükkanın sahibini değiştirir (null: sahipsiz) */
  async setPinOwner(id, ownerId) {
    const { data } = await supabase.from('pins').update({ owner_id: ownerId || null })
      .eq('id', parseInt(id)).select().single();
    return data;
  },

  async approvePin(id) {
    const { data } = await supabase.from('pins').update({
      status: 'approved',
      reviewed_at: new Date().toISOString()
    }).eq('id', parseInt(id)).select().single();
    return data;
  },

  async rejectPin(id, reason = '') {
    const { data } = await supabase.from('pins').update({
      status: 'rejected',
      reject_reason: reason,
      reviewed_at: new Date().toISOString()
    }).eq('id', parseInt(id)).select().single();
    return data;
  },

  async deletePin(id) {
    const pin = await this.getPin(id);
    const { error } = await supabase.from('pins').delete().eq('id', parseInt(id));
    if (!error && pin) await this.deletePinImages(pin.images);
    return !error;
  },

  async addPinComment(pinId, { nickname, ip, message }) {
    const { data } = await supabase.from('pin_comments').insert({
      pin_id: parseInt(pinId),
      nickname: nickname || 'Anonim',
      ip: ip || '127.0.0.1',
      message: message.trim()
    }).select().single();
    return data;
  },

  /** Hata Bildirimleri */
  async getReports() {
    const { data } = await supabase.from('reports').select('*, pins(title)').order('id', { ascending: false });
    return (data || []).map(r => ({
      ...r,
      pinTitle: r.pins ? r.pins.title : 'Bilinmeyen İşletme'
    }));
  },

  async addReport({ pinId, ip, message }) {
    const { data } = await supabase.from('reports').insert({
      pin_id: parseInt(pinId),
      ip: ip || '127.0.0.1',
      message: message.trim()
    }).select().single();
    return data;
  },

  async deleteReport(id) {
    const { error } = await supabase.from('reports').delete().eq('id', parseInt(id));
    return !error;
  },

  /** Chat */
  async getChatMessages() {
    const { data } = await supabase.from('chat_messages').select('*').order('id', { ascending: true }).limit(100);
    return data || [];
  },

  async addChatMessage({ nickname, ip, message }) {
    const { data } = await supabase.from('chat_messages').insert({
      nickname: nickname || 'Anonim',
      ip: ip || 'Bilinmeyen IP',
      message: message || ''
    }).select().single();
    
    // 100 mesajdan eskisini silme mantığı (basitçe en büyük ID'nin 100 eksiğinden küçük olanları sil)
    if (data) {
      await supabase.from('chat_messages').delete().lt('id', data.id - 100);
    }
    return data;
  },

  async clearChat() {
    const { error } = await supabase.from('chat_messages').delete().neq('id', 0);
    return !error;
  },

  /** Logs */
  async getLogs() {
    const { data } = await supabase.from('logs').select('*').order('id', { ascending: false }).limit(200);
    return data || [];
  },

  async logActivity(message, isAdmin = false) {
    const { data } = await supabase.from('logs').insert({
      message,
      is_admin: isAdmin
    }).select().single();
    return data;
  },

  async deleteLog(id) {
    const { error } = await supabase.from('logs').delete().eq('id', parseInt(id));
    return !error;
  },

  async clearLogs() {
    const { error } = await supabase.from('logs').delete().neq('id', 0);
    return !error;
  },

  /** Ziyaret Sayaç */
  async getVisits() {
    const { data } = await supabase.from('site_stats').select('visits').eq('id', 1).single();
    return data ? data.visits : 0;
  },

  async incrementVisits() {
    const { data: stat } = await supabase.from('site_stats').select('visits').eq('id', 1).single();
    if (stat) {
      await supabase.from('site_stats').update({ visits: stat.visits + 1 }).eq('id', 1);
    }
  },

  /** İstatistikler */
  async getStats() {
    const { count: total } = await supabase.from('pins').select('id', { count: 'exact', head: true });
    const { count: pending } = await supabase.from('pins').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    const { count: approved } = await supabase.from('pins').select('id', { count: 'exact', head: true }).eq('status', 'approved');
    const { count: rejected } = await supabase.from('pins').select('id', { count: 'exact', head: true }).eq('status', 'rejected');
    const visits = await this.getVisits();
    return {
      total: total || 0,
      pending: pending || 0,
      approved: approved || 0,
      rejected: rejected || 0,
      visits
    };
  }
};

console.log('📦 Supabase veritabanı bağlandı:', supabaseUrl);
// Hesap işlemleri (accounts.js) tabloya doğrudan erişir
Object.defineProperty(db, 'supabase', { value: supabase });

module.exports = db;
