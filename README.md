# NewHal — Mersin Hal Kompleksi İşletme Rehberi

İnteraktif harita üzerinde işletme iğnesi ekleme ve yönetme sistemi.

## 🚀 Kurulum

```bash
npm install
npm run dev
```

Üye arama, takip, özel mesaj ve bildirim özellikleri için `migrations/` altındaki SQL dosyalarını
Supabase SQL Editor'de bir kez çalıştırın. Önce sosyal özellikleri, sonra bildirim ve en son toplu
bildirim dosyasını çalıştırın. Para Puan ve referans ödülleri için `2026-11-04-zzz-points-referrals.sql`
migrasyonunu da uygulayın. Bildirimler yeni takiplerde, gelen mesajlarda ve admin duyurularında oluşur.

## 🌐 Erişim

| Sayfa | URL |
|---|---|
| Ana site | http://localhost:3000 |
| Admin paneli | http://localhost:3000/admin |

## 🔐 Ayarlar

`.env.example` dosyasını `.env` olarak kopyalayıp doldurun. Admin kullanıcı adı/şifresi,
Supabase ve Google giriş anahtarları buradan okunur. `.env` asla GitHub'a gönderilmez.

## ✨ Özellikler

- 🗺 Leaflet.js ile interaktif harita (Mersin Hal Kompleksi merkezli)
- 📍 Haritaya tıklayarak iğne konumu seçme
- 📝 İşletme bilgileri: ünvan, adres, telefon, website, e-posta
- ⏳ Onay sistemi: kullanıcı ekler → admin onaylar → yayınlanır
- 🏪 Kategori filtreleme (Sebze&Meyve, Bakliyat, Kuru Gıda, Balık, Et&Tavuk)
- 📊 Admin dashboard: istatistikler, bekleyen/onaylı/reddedilen iğneler
- 💰 Günlük girişte ve yeni üye davetinde Para Puan ödülü
- 🌙 Dark mode tasarım, glassmorphism efektler

## 🗂 Proje Yapısı

```
newhal/
├── server.js        ← Express API sunucusu
├── database.js      ← Supabase bağlantısı
├── .env             ← Gizli ayarlar (GitHub'a gitmez)
├── .env.example     ← Ayar şablonu
├── schema.sql       ← Supabase tablo yapısı
└── public/
    ├── index.html   ← Ana site
    ├── admin.html   ← Admin paneli
    ├── css/
    │   ├── main.css
    │   └── admin.css
    └── js/
        ├── main.js
        └── admin.js
```

## 🛠 Tech Stack

- **Backend:** Node.js + Express
- **Database:** Supabase (PostgreSQL)
- **Auth:** Google ile giriş + JWT (admin 8 saat, kullanıcı 7 gün)
- **Harita:** Leaflet.js + CartoDB Dark tiles
- **Frontend:** Vanilla HTML/CSS/JS
