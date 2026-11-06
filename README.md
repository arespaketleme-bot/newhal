# NewHal — Mersin Hal Kompleksi İşletme Rehberi

İnteraktif harita üzerinde işletme iğnesi ekleme ve yönetme sistemi.

## 🚀 Kurulum

```bash
npm install
npm run dev
```

Üye arama, takip, özel mesaj ve bildirim özellikleri için `migrations/` altındaki SQL dosyalarını
Supabase SQL Editor'de bir kez çalıştırın. Önce sosyal özellikleri, sonra bildirim ve en son toplu
bildirim dosyasını çalıştırın. Para Puan ve referans ödülleri için `2026-11-04-zzz-points-referrals.sql`,
admin puan yüklemesi için `2026-11-04-zzzz-admin-point-credit.sql` ve tarayıcı bildirimleri için
`2026-11-04-zzzzz-web-push.sql` migrasyonlarını uygulayın. Bildirimler takip, mesaj ve admin duyurularında oluşur.
Üyeler Bildirimler penceresinden tarayıcı izni vererek NewHal kapalıyken de bildirim alabilir. Push anahtarı
Supabase'in özel dosya alanında sunucu tarafından bir kez oluşturulur ve saklanır.

İşletme beğenileri ve seviye sistemi için `migrations/2026-11-05-business-levels.sql` dosyasını Supabase SQL Editor'de bir kez çalıştırın. Admin seviyeyi elle yükseltebilsin diye `migrations/2026-11-05-admin-business-levels.sql` dosyasını da çalıştırın. Varsayılan olarak her 5 toplam beğeni veya yorumda bir seviye eklenir. Admin panelindeki Onaylananlar sayfasından bu sayıyı değiştirebilir; ayar özel Supabase deposunda saklanır. Seviye harita işaretinin boyutunu artırır.

Takip, özel mesaj ve yönetici duyuruları e-posta adresi olan üyelere e-posta ile de gönderilir.
Bunun için sunucuda `RESEND_API_KEY` ve Resend'de doğrulanmış gönderen adresini içeren `RESEND_FROM`
ayarları tanımlanmalıdır. Ayarlar yoksa uygulama içi ve tarayıcı bildirimleri çalışmaya devam eder.

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
- 🏅 Her 1.000 Para Puanda bir artan üye seviyesi
- 🔔 Takip, mesaj ve duyurular için tarayıcı push bildirimi
- 🌙 Dark mode tasarım, glassmorphism efektler
- 📱 Google Play uygulaması için doğrulanmış Android App Links; adres çubuğu olmadan açılış
- ⭐ Ana sayfanın üstünde öne çıkan vitrin ve güncel ilan şeridi
- 📱 Mobil ilan ekranında üst menü için gereksiz boşluk olmadan başlangıç
- 💰 Yönetici tarafından ayarlanabilen ilan ve takip Para Puan ekonomisi
- 📊 Ekonomi ekranında toplam dağıtım özeti ve ödül günlüğü
- 👋 Yeni kullanıcı, günlük giriş ve davet Para Puanları ekonomi günlüğünde ayrı görünür
- 🌦️ Günlük Mersin hava durumu yalnızca Vitrin'de gösterilir

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
