/**
 * database.js — Saf JS tabanlı JSON dosya veritabanı
 * better-sqlite3 yerine, native derleme gerektirmez.
 */
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'newhal-db.json');
const CHAT_FILE = path.join(__dirname, 'newhal-chat.json');

const defaultCategories = [
  { name: "Genel", icon: "📦" },
  { name: "Sebze & Meyve", icon: "🥦" },
  { name: "Bakliyat", icon: "🌾" },
  { name: "Kuru Gıda", icon: "🏪" },
  { name: "Balık", icon: "🐟" },
  { name: "Et & Tavuk", icon: "🥩" }
];

// ── İlk yükleme / oluşturma ───────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = { pins: [], nextId: 1, categories: defaultCategories, reports: [], reportsNextId: 1, logs: [], logsNextId: 1, visits: 0 };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    let changed = false;
    if (!data.categories) {
      data.categories = defaultCategories;
      changed = true;
    }
    if (!data.reports) {
      data.reports = [];
      changed = true;
    }
    if (!data.reportsNextId) {
      data.reportsNextId = 1;
      changed = true;
    }
    if (!data.logs) {
      data.logs = [];
      changed = true;
    }
    if (!data.logsNextId) {
      data.logsNextId = 1;
      changed = true;
    }
    if (typeof data.visits !== 'number') {
      data.visits = 0;
      changed = true;
    }
    if (data.pins) {
      data.pins.forEach(pin => {
        if (!pin.comments) {
          pin.comments = [];
          changed = true;
        }
      });
    }
    if (changed) {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    }
    return data;
  } catch {
    const init = { pins: [], nextId: 1, categories: defaultCategories, reports: [], reportsNextId: 1, logs: [], logsNextId: 1, visits: 0 };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Chat helper functions ────────────────────────────────────
function loadChat() {
  if (!fs.existsSync(CHAT_FILE)) {
    const init = [];
    fs.writeFileSync(CHAT_FILE, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveChat(messages) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

// ── Pin CRUD ──────────────────────────────────────────────────
const db = {
  /** Tüm pinleri getir (isteğe bağlı status filtresi) */
  getPins(status) {
    const data = loadDB();
    const pins = status ? data.pins.filter(p => p.status === status) : data.pins;
    return [...pins].reverse(); // en yeni önce
  },

  /** Onaylı pinleri getir */
  getApprovedPins() {
    return this.getPins('approved');
  },

  /** Yeni pin ekle */
  addPin({ title, address, phone, website, email, lat, lng, category }) {
    const data = loadDB();
    const pin = {
      id:          data.nextId++,
      title,
      address,
      phone:       phone    || '',
      website:     website  || '',
      email:       email    || '',
      lat:         parseFloat(lat),
      lng:         parseFloat(lng),
      category:    category || 'Genel',
      status:      'pending',
      reject_reason: '',
      created_at:  new Date().toISOString(),
      reviewed_at: null,
    };
    data.pins.push(pin);
    saveDB(data);
    return pin;
  },

  /** Pin onayla */
  approvePin(id) {
    const data = loadDB();
    const pin  = data.pins.find(p => p.id === parseInt(id));
    if (!pin) return null;
    pin.status      = 'approved';
    pin.reviewed_at = new Date().toISOString();
    saveDB(data);
    return pin;
  },

  /** Pin reddet */
  rejectPin(id, reason = '') {
    const data = loadDB();
    const pin  = data.pins.find(p => p.id === parseInt(id));
    if (!pin) return null;
    pin.status        = 'rejected';
    pin.reject_reason = reason;
    pin.reviewed_at   = new Date().toISOString();
    saveDB(data);
    return pin;
  },

  /** Pin sil */
  deletePin(id) {
    const data  = loadDB();
    const idx   = data.pins.findIndex(p => p.id === parseInt(id));
    if (idx === -1) return false;
    data.pins.splice(idx, 1);
    saveDB(data);
    return true;
  },

  /** İstatistikler */
  getStats() {
    const data = loadDB();
    return {
      total:    data.pins.length,
      pending:  data.pins.filter(p => p.status === 'pending').length,
      approved: data.pins.filter(p => p.status === 'approved').length,
      rejected: data.pins.filter(p => p.status === 'rejected').length,
      visits:   data.visits || 0
    };
  },

  /** Chat mesajlarını getir */
  getChatMessages() {
    return loadChat();
  },

  /** Chat mesajı ekle */
  addChatMessage({ nickname, ip, message }) {
    const messages = loadChat();
    const newMsg = {
      id: messages.length + 1,
      nickname: nickname || 'Anonim',
      ip: ip || 'Bilinmeyen IP',
      message: message || '',
      created_at: new Date().toISOString(),
    };
    messages.push(newMsg);
    if (messages.length > 100) {
      messages.shift();
    }
    saveChat(messages);
    return newMsg;
  },

  /** Pin güncelle (Admin) */
  updatePin(id, { title, address, phone, website, email, category, lat, lng }) {
    const data = loadDB();
    const pin  = data.pins.find(p => p.id === parseInt(id));
    if (!pin) return null;

    pin.title    = title.trim();
    pin.address  = address.trim();
    pin.phone    = phone ? phone.trim() : '';
    pin.website  = website ? website.trim() : '';
    pin.email    = email ? email.trim() : '';
    pin.category = category || 'Genel';
    pin.lat      = parseFloat(lat);
    pin.lng      = parseFloat(lng);
    pin.updated_at = new Date().toISOString();

    saveDB(data);
    return pin;
  },

  /** Kategorileri getir */
  getCategories() {
    const data = loadDB();
    return data.categories || defaultCategories;
  },

  /** Yeni kategori ekle */
  addCategory({ name, icon }) {
    const data = loadDB();
    if (!data.categories) data.categories = [...defaultCategories];
    
    // Check if category already exists
    const exists = data.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return { error: 'Bu kategori zaten mevcut' };

    const newCat = { name: name.trim(), icon: icon ? icon.trim() : '📦' };
    data.categories.push(newCat);
    saveDB(data);
    return newCat;
  },

  /** Kategori sil */
  deleteCategory(name) {
    const data = loadDB();
    if (!data.categories) data.categories = [...defaultCategories];
    
    // "Genel" silinemez
    if (name.toLowerCase() === 'genel') {
      return { error: 'Varsayılan Genel kategorisi silinemez' };
    }

    const idx = data.categories.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
    if (idx === -1) return { error: 'Kategori bulunamadı' };

    data.categories.splice(idx, 1);

    // O kategoriye sahip pinleri "Genel" yap
    if (data.pins) {
      data.pins.forEach(pin => {
        if (pin.category && pin.category.toLowerCase() === name.toLowerCase()) {
          pin.category = 'Genel';
        }
      });
    }

    saveDB(data);
    return { success: true };
  },

  /** Kategori güncelle */
  updateCategory(oldName, { name, icon }) {
    const data = loadDB();
    if (!data.categories) data.categories = [...defaultCategories];

    // "Genel" adının değiştirilmesini önle
    if (oldName.toLowerCase() === 'genel' && name.toLowerCase() !== 'genel') {
      return { error: 'Varsayılan Genel kategorisinin adı değiştirilemez' };
    }

    const cat = data.categories.find(c => c.name.toLowerCase() === oldName.toLowerCase());
    if (!cat) return { error: 'Kategori bulunamadı' };

    // Yeni ad başka bir kategoride var mı kontrol et (kendisi hariç)
    if (oldName.toLowerCase() !== name.toLowerCase()) {
      const exists = data.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
      if (exists) return { error: 'Bu isimde başka bir kategori zaten mevcut' };
    }

    const trimmedName = name.trim();
    const trimmedIcon = icon ? icon.trim() : '📦';

    // Kategoride güncelle
    cat.name = trimmedName;
    cat.icon = trimmedIcon;

    // Pinlerde güncelle
    if (data.pins) {
      data.pins.forEach(pin => {
        if (pin.category && pin.category.toLowerCase() === oldName.toLowerCase()) {
          pin.category = trimmedName;
        }
      });
    }

    saveDB(data);
    return { name: trimmedName, icon: trimmedIcon };
  },


  /** Yorum ekle */
  addPinComment(pinId, { nickname, ip, message }) {
    const data = loadDB();
    const pin  = data.pins.find(p => p.id === parseInt(pinId));
    if (!pin) return null;
    if (!pin.comments) pin.comments = [];
    const comment = {
      id: pin.comments.length + 1,
      nickname: nickname || 'Anonim',
      ip: ip || '127.0.0.1',
      message: message.trim(),
      created_at: new Date().toISOString()
    };
    pin.comments.push(comment);
    saveDB(data);
    return comment;
  },

  /** Hata Bildirimi ekle */
  addReport({ pinId, ip, message }) {
    const data = loadDB();
    if (!data.reports) data.reports = [];
    if (!data.reportsNextId) data.reportsNextId = 1;

    const pin = data.pins.find(p => p.id === parseInt(pinId));
    const report = {
      id: data.reportsNextId++,
      pinId: parseInt(pinId),
      pinTitle: pin ? pin.title : 'Bilinmeyen İşletme',
      ip: ip || '127.0.0.1',
      message: message.trim(),
      created_at: new Date().toISOString()
    };
    data.reports.push(report);
    saveDB(data);
    return report;
  },

  /** Ziyaret Sayısını Getir */
  getVisits() {
    const data = loadDB();
    return data.visits || 0;
  },

  /** Kullanıcı İşlemleri */
  getAllUsers() {
    const data = loadDB();
    return data.users || [];
  },

  findOrCreateGoogleUser({ googleId, name, email, avatar }) {
    const data = loadDB();
    if (!data.users) {
      data.users = [];
      data.usersNextId = 1;
    }
    let user = data.users.find(u => u.googleId === googleId);
    if (!user && email) {
      // Check if user exists by email (if they registered locally before Google)
      user = data.users.find(u => u.email === email);
      if (user) {
        user.googleId = googleId;
        user.avatar = avatar;
        saveDB(data);
        return user;
      }
    }
    if (!user) {
      user = {
        id: data.usersNextId++,
        googleId,
        name: name || 'İsimsiz Kullanıcı',
        email: email || '',
        avatar: avatar || '',
        created_at: new Date().toISOString()
      };
      data.users.push(user);
      saveDB(data);
    }
    return user;
  },

  /** Hata Bildirimlerini getir */
  getReports() {
    const data = loadDB();
    return data.reports || [];
  },

  /** Hata Bildirimi sil */
  deleteReport(id) {
    const data = loadDB();
    if (!data.reports) return false;
    const idx = data.reports.findIndex(r => r.id === parseInt(id));
    if (idx === -1) return false;
    data.reports.splice(idx, 1);
    saveDB(data);
    return true;
  },


  /** Sohbet Geçmişini Temizle */
  clearChat() {
    saveChat([]);
    return true;
  }
};

console.log('✅ JSON veritabanı hazır:', DB_FILE);
module.exports = db;
