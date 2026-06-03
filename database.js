const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('HATA: SUPABASE_URL veya SUPABASE_KEY ortam değişkenleri tanımlı değil.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
        return updatedUser;
      }
    }
    if (!user) {
      const { data: newUser } = await supabase.from('users').insert({
        google_id: googleId,
        name: name || 'İsimsiz Kullanıcı',
        email: email || '',
        avatar: avatar || ''
      }).select().single();
      user = newUser;
    }
    return user;
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

  async addPin({ title, address, phone, website, email, lat, lng, category }) {
    const { data } = await supabase.from('pins').insert({
      title,
      address,
      phone: phone || '',
      website: website || '',
      email: email || '',
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      category: category || 'Genel',
      status: 'pending'
    }).select().single();
    return data;
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
    const { error } = await supabase.from('pins').delete().eq('id', parseInt(id));
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
module.exports = db;
