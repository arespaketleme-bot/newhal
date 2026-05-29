# NewHal — Mersin Hal Kompleksi İşletme Rehberi

İnteraktif harita üzerinde işletme iğnesi ekleme ve yönetme sistemi.

## 🚀 Kurulum

```bash
npm install
npm run dev
```

## 🌐 Erişim

| Sayfa | URL |
|---|---|
| Ana site | http://localhost:3000 |
| Admin paneli | http://localhost:3000/admin |

## 🔐 Admin Bilgileri

| Alan | Değer |
|---|---|
| Kullanıcı adı | `admin` |
| Şifre | `newhal2024` |

> `.env` dosyasından değiştirilebilir.

## ✨ Özellikler

- 🗺 Leaflet.js ile interaktif harita (Mersin Hal Kompleksi merkezli)
- 📍 Haritaya tıklayarak iğne konumu seçme
- 📝 İşletme bilgileri: ünvan, adres, telefon, website, e-posta
- ⏳ Onay sistemi: kullanıcı ekler → admin onaylar → yayınlanır
- 🏪 Kategori filtreleme (Sebze&Meyve, Bakliyat, Kuru Gıda, Balık, Et&Tavuk)
- 📊 Admin dashboard: istatistikler, bekleyen/onaylı/reddedilen iğneler
- 🌙 Dark mode tasarım, glassmorphism efektler

## 🗂 Proje Yapısı

```
newhal/
├── server.js        ← Express API sunucusu
├── database.js      ← SQLite veritabanı
├── .env             ← Ortam değişkenleri (admin şifresi)
├── newhal.db        ← SQLite DB (otomatik oluşturulur)
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
- **Database:** SQLite (better-sqlite3)
- **Auth:** JWT (8 saatlik token)
- **Harita:** Leaflet.js + CartoDB Dark tiles
- **Frontend:** Vanilla HTML/CSS/JS
