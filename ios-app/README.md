# NewHal iPhone Uygulaması

Bu klasör, NewHal'in App Store uygulamasıdır. Uygulama **newhal.com'u açan bir kabuktur**
(Capacitor). Siteye yapılan her değişiklik uygulamaya **anında** yansır; yeniden derlemek
yalnızca simge, izinler ya da uygulama özellikleri değişince gerekir.

## Uygulamada site neyi farklı yapar?

| Özellik | Nasıl |
|---|---|
| **Bildirimler** | Takip, mesaj ve duyurular **iPhone bildirimi** olarak gelir; dokununca ilgili sayfa açılır. |
| **Google ile giriş** | Google, uygulama içinden girişi engeller. Giriş **Safari penceresinde** yapılır, sonra tek kullanımlık bir kodla uygulamaya dönülür. |
| **Paylaş** | iPhone'un kendi paylaşım menüsü açılır. |
| **İnternet yokken** | "İnternet bağlantısı yok" ekranı ve "Tekrar dene" düğmesi; bağlantı gelince kendiliğinden açılır. |
| **Gizlenenler** | Android APK indirme ve "ana ekrana ekle" kartları uygulamada görünmez. |

Kod: `ios-app/` (uygulama), `public/js/native.js` (sitenin uygulama içindeki davranışı),
`ios.js` (giriş kodu ve iPhone bildirimleri), `codemagic.yaml` (bulut derlemesi).

---

## Yayınlamak için gerekenler

- **Apple Developer Program üyeliği** — yıllık 99 USD. <https://developer.apple.com/programs/>
  Şirket adına açacaksanız D-U-N-S numarası istenir; bireysel hesap daha hızlıdır.
- **Codemagic hesabı** — Mac olmadan bulutta derlemek için. Ücretsiz bir aylık kotası var;
  güncel koşullara <https://codemagic.io/pricing/> adresinden bakın.
  (Mac'iniz varsa Codemagic gerekmez, en alttaki "Kendi Mac'inizle" bölümüne bakın.)

---

## Adım 1 — Uygulama kimliğini oluşturun

1. <https://developer.apple.com/account/resources/identifiers/list> → **+** → **App IDs** → **App**.
2. **Bundle ID**: `com.newhal.app` (Explicit). Açıklama: `NewHal`.
3. **Capabilities** listesinde **Push Notifications**'ı işaretleyin → **Register**.

## Adım 2 — App Store Connect'te uygulamayı açın

1. <https://appstoreconnect.apple.com/apps> → **+** → **Yeni Uygulama**.
2. Platform **iOS**, Ad **NewHal** (alınmışsa "NewHal Mersin Hal"), Birincil dil **Türkçe**,
   Bundle ID **com.newhal.app**, SKU **newhal-ios**.
3. Açılan sayfada **Uygulama Bilgileri → Apple Kimliği** yazan rakamı not edin
   (örn. `6740000000`). Bunu `codemagic.yaml` dosyasındaki `APP_STORE_APPLE_ID` yerine yazın
   ya da bana söyleyin, ben yazayım.

## Adım 3 — Codemagic'e App Store Connect erişimi verin

1. App Store Connect → **Kullanıcılar ve Erişim → Entegrasyonlar → App Store Connect API**
   → **+** ile yeni anahtar; erişim: **App Manager**. `.p8` dosyasını indirin (bir kez inebilir),
   **Issuer ID** ve **Key ID**'yi not edin.
2. <https://codemagic.io> → GitHub ile giriş → **Team settings → Integrations →
   Developer Portal / App Store Connect** → anahtarı ekleyin. Adı tam olarak
   **`NewHal App Store Connect`** olsun (codemagic.yaml bu adı arar).
3. Codemagic → **Add application** → GitHub'dan `newhal` deposunu seçin → **codemagic.yaml** kullanılır.
4. **Code signing identities → iOS certificates**: "Generate certificate" (App Store dağıtım sertifikası).
   **iOS provisioning profiles**: "Fetch profiles" → `com.newhal.app` için App Store profilini alın.

## Adım 4 — iPhone bildirim anahtarı (APNs)

1. <https://developer.apple.com/account/resources/authkeys/list> → **+** →
   **Apple Push Notifications service (APNs)** işaretli → indirin (`AuthKey_XXXXXXXXXX.p8`).
2. Render → NewHal servisi → **Environment** → şu değişkenleri ekleyin:

   | Değişken | Değer |
   |---|---|
   | `APNS_KEY` | `.p8` dosyasının **tüm içeriği** (BEGIN/END satırları dahil) |
   | `APNS_KEY_ID` | Anahtar kimliği (10 karakter, dosya adındaki) |
   | `APNS_TEAM_ID` | Ekip kimliği (developer.apple.com → Membership, 10 karakter) |

   `APNS_BUNDLE_ID` (varsayılan `com.newhal.app`) ve `APNS_ENV` (varsayılan `production`)
   değiştirmeniz gerekmez. Bu değişkenler yoksa iPhone bildirimi gönderilmez, site normal çalışır.

## Adım 5 — Derleyin

Codemagic → NewHal → **Start new build** → iş akışı **ios-appstore** → **Start**.
Yaklaşık 15–25 dakika sürer. Bitince uygulama kendiliğinden **TestFlight**'a yüklenir.

## Adım 6 — TestFlight ile telefonda deneyin

App Store Connect → NewHal → **TestFlight** → kendinizi "Dahili Test" grubuna ekleyin →
iPhone'a **TestFlight** uygulamasını kurup NewHal'i yükleyin. Şunları deneyin:

- [ ] Açılış ekranı ve simge doğru görünüyor
- [ ] İşletmeler, ilanlar, harita geliyor
- [ ] **Google ile giriş**: Safari penceresi açılıyor, giriş sonrası "NewHal'de aç" deyince uygulamaya dönüp giriş yapılmış oluyor
- [ ] Bildirimler penceresinde **"Bildirimleri aç"** → izin → başka bir hesaptan size mesaj atın, bildirim geliyor, dokununca mesajlar açılıyor
- [ ] Bir ilanı **Paylaş** → iPhone paylaşım menüsü
- [ ] "Konumum" ve fotoğraf yükleme izin soruyor ve çalışıyor
- [ ] Uçak modunda açınca "İnternet bağlantısı yok" ekranı

## Adım 7 — App Store'a gönderin

App Store Connect → NewHal → **iOS Uygulaması 1.0**:

- **Ekran görüntüleri**: 6,9" (1320×2868) ve 6,5" (1284×2778) iPhone boyutlarında en az 3'er tane
  (TestFlight'taki uygulamadan çekebilirsiniz).
- **Açıklama, anahtar kelimeler**: hal, Mersin, sebze, meyve, komisyoncu, ilan, toptan…
- **Destek URL'si**: `https://newhal.com/iletisim.html` · **Gizlilik politikası**: `https://newhal.com/gizlilik.html`
- **Uygulama Gizliliği** formu: ad, e-posta (hesap için), konum (yalnızca uygulama kullanılırken,
  izleme yok), fotoğraflar (kullanıcı içeriği).
- **Hesap silme**: Apple, hesabın uygulama içinden silinebilmesini ister → profildeki
  **"Hesabımı sil"** düğmesi bunu karşılıyor. İnceleme notuna "Profil → Hesabımı sil" yazın.
- **İnceleme bilgileri**: Apple incelemecisi için **e-posta + şifreyle** giriş yapılabilen bir
  deneme hesabı yazın (Google girişini deneyemeyebilirler). Not alanına örnek:
  > NewHal, Mersin Hal Kompleksi'nin işletme rehberi ve ilan uygulamasıdır. Bildirimler
  > (takip, mesaj, duyuru), konuma göre harita, fotoğraflı ilan verme ve paylaşım kullanır.

## Apple'ın reddedebileceği noktalar (dürüstçe)

- **"Yalnızca web sitesi" (Kural 4.2):** Apple, bir siteyi kabukla gösteren uygulamaları
  reddedebilir. Buna karşı uygulamada gerçek iPhone özellikleri var (bildirimler, paylaşım,
  bağlantısız ekran, Safari ile giriş). Yine reddedilirse gerekçesini paylaşın; ek özellik ekleriz.
- **Giriş seçenekleri (Kural 4.8):** Google ile girişin yanında Apple, **"Apple ile Giriş"**
  isteyebilir. İstenirse eklerim (Apple hesabında ek bir ayar gerekir).

## Güncelleme

- **Site değişiklikleri** (görünüm, özellik, metin): yeniden derleme gerekmez, uygulamaya hemen yansır.
- **Uygulama değişiklikleri** (simge, izin metinleri, yeni eklenti): Codemagic'te yeni derleme →
  App Store Connect'te yeni sürüm (`MARKETING_VERSION`, Xcode projesinde 1.0 → 1.1).

## Kendi Mac'inizle

```bash
cd ios-app
npm ci
npx cap sync ios
npx cap open ios          # Xcode açılır
```

Xcode → **App** hedefi → **Signing & Capabilities** → Team'i seçin → üst menü
**Product → Archive** → **Distribute App → App Store Connect**.

## Simge ve açılış ekranını değiştirmek

`ios-app/assets/icon-only.png` (1024×1024, şeffaflık yok) ve `splash.png` / `splash-dark.png`
(2732×2732) dosyalarını değiştirip:

```bash
cd ios-app && npx capacitor-assets generate --ios
```
