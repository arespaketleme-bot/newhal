/* ═══════════════════════════════════════════════════════════════
   NewHal — iPhone uygulaması köprüsü
   Site, App Store'daki NewHal uygulamasının içinde açıldığında
   (Capacitor) iPhone'un kendi özelliklerini kullanır. Normal tarayıcıda
   hiçbir şey yapmaz.
   - Google girişi Safari penceresinde yapılır (Google, uygulama içi
     tarayıcıdan girişi engeller) ve tek kullanımlık kodla geri dönülür.
   - Bildirimler iPhone bildirimi (APNs) olarak gelir; dokununca ilgili
     sayfa açılır.
   - Paylaş düğmeleri iPhone paylaşım menüsünü açar.
   - Android APK ve "ana ekrana ekle" kartları gizlenir.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const Cap = window.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;

  const P = Cap.Plugins || {};
  const SITE = location.origin;
  window.NEWHAL_NATIVE = true;
  document.documentElement.classList.add('native-app');

  // Uygulamada gereksiz olan kurulum/indirme alanları
  const style = document.createElement('style');
  style.textContent = `
    .native-app .install-nav-link, .native-app .apk-dl, .native-app #appPromo,
    .native-app #installBanner, .native-app .ads-install-btn { display: none !important; }`;
  document.head.appendChild(style);

  const ready = fn => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type) : alert(msg));
  const authHeader = () => {
    try { const t = localStorage.getItem('userToken'); return t ? { Authorization: 'Bearer ' + t } : {}; } catch { return {}; }
  };

  // ── Paylaş: iPhone paylaşım menüsü ──────────────────────────
  if (P.Share) {
    navigator.share = data => P.Share.share({
      title: data && data.title, text: data && data.text, url: data && data.url, dialogTitle: 'Paylaş',
    });
  }

  // ── Üst çubuk rengi temaya uysun ────────────────────────────
  function syncStatusBar() {
    if (!P.StatusBar) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    P.StatusBar.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
  }
  syncStatusBar();
  new MutationObserver(syncStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ── Google girişi: Safari penceresinde ──────────────────────
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch { return; }
    if (url.origin !== SITE || url.pathname !== '/auth/google') return;
    e.preventDefault();
    e.stopPropagation();
    url.searchParams.set('app', 'ios');
    if (P.Browser) P.Browser.open({ url: url.href, presentationStyle: 'popover' });
    else location.href = url.href;
  }, true);

  // Safari penceresinden "newhal://giris?code=..." ile dönülür
  async function handleAppUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return; }
    if (u.protocol !== 'newhal:') return;
    if (P.Browser) P.Browser.close().catch(() => {});
    const host = u.host || u.pathname.replace(/^\/+/, '');
    if (!/^giris/.test(host)) return;
    if (u.searchParams.get('error')) { toast('❌ Google ile giriş tamamlanamadı. Lütfen tekrar deneyin.', 'error'); return; }
    const code = u.searchParams.get('code');
    if (!code) return;
    try {
      const r = await fetch('/api/auth/app-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.error || 'Giriş kodu geçersiz');
      // Sitenin mevcut Google dönüş akışı kullanılır (puan, hoş geldin kartı vb.)
      const q = new URLSearchParams({ googleAuth: 'success', token: d.token, name: d.name || '' });
      if (d.points) q.set('points', String(d.points));
      if (d.welcome) q.set('welcome', String(d.welcome));
      location.href = '/?' + q.toString();
    } catch (err) {
      toast('❌ ' + (err.message || 'Giriş tamamlanamadı'), 'error');
    }
  }
  if (P.App) {
    P.App.addListener('appUrlOpen', ev => handleAppUrl(ev && ev.url));
    // Uygulama kapalıyken bağlantıyla açıldıysa
    if (P.App.getLaunchUrl) P.App.getLaunchUrl().then(r => r && r.url && handleAppUrl(r.url)).catch(() => {});
  }

  // ── iPhone bildirimleri ─────────────────────────────────────
  const PN = P.PushNotifications;
  const TOKEN_KEY = 'newhalIosPushToken';
  const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };

  async function sendToken(token) {
    if (!authHeader().Authorization) return false;
    const r = await fetch('/api/push/ios', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ token }),
    });
    if (!r.ok) throw new Error('Bildirim kaydı yapılamadı');
    try { localStorage.setItem(TOKEN_KEY, token); } catch {}
    return true;
  }

  let registerResolve = null;
  if (PN) {
    PN.addListener('registration', t => {
      const token = t && t.value;
      if (!token) return;
      sendToken(token).catch(() => {});
      if (registerResolve) { registerResolve(token); registerResolve = null; }
    });
    PN.addListener('registrationError', () => { if (registerResolve) { registerResolve(null); registerResolve = null; } });
    // Bildirime dokununca ilgili sayfa açılır
    PN.addListener('pushNotificationActionPerformed', action => {
      const data = (action && action.notification && action.notification.data) || {};
      const url = data.url || '/?openNotifications=1';
      try {
        const target = new URL(url, SITE);
        if (target.origin === SITE) location.href = target.pathname + target.search + target.hash;
      } catch {}
    });
  }

  const registerOnce = () => new Promise(resolve => {
    registerResolve = resolve;
    PN.register().catch(() => resolve(null));
    setTimeout(() => { if (registerResolve === resolve) { registerResolve = null; resolve(null); } }, 15000);
  });

  // Sitenin bildirim düğmesi uygulamada iPhone bildirimini yönetir
  async function nativeRefreshButton() {
    const button = document.getElementById('browserNotificationButton');
    const status = document.getElementById('browserNotificationStatus');
    if (!button || !status || !PN) return;
    const perm = await PN.checkPermissions().catch(() => ({ receive: 'prompt' }));
    if (perm.receive === 'denied') {
      button.disabled = true;
      status.textContent = 'Bildirim izni kapalı. iPhone Ayarlar → NewHal → Bildirimler bölümünden açabilirsiniz.';
      return;
    }
    button.disabled = false;
    const on = perm.receive === 'granted' && !!savedToken();
    button.textContent = on ? 'Bildirimleri kapat' : 'Bildirimleri aç';
    status.textContent = on
      ? 'Açık. Yeni takip, mesaj ve duyurular iPhone bildirimi olarak gelir.'
      : 'Uygulama kapalıyken de takip, mesaj ve duyuru bildirimi alın.';
  }

  async function nativeToggle() {
    const button = document.getElementById('browserNotificationButton');
    if (button) button.disabled = true;
    try {
      if (!PN) throw new Error('Bildirimler bu sürümde desteklenmiyor');
      const token = savedToken();
      if (token) {   // kapat
        await fetch('/api/push/ios', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ token }),
        }).catch(() => {});
        try { localStorage.removeItem(TOKEN_KEY); } catch {}
        await PN.unregister().catch(() => {});
        toast('Bildirimler kapatıldı', 'success');
        return;
      }
      let perm = await PN.checkPermissions();
      if (perm.receive !== 'granted') perm = await PN.requestPermissions();
      if (perm.receive !== 'granted') throw new Error('Bildirim izni verilmedi');
      const t = await registerOnce();
      if (!t) throw new Error('iPhone bildirim kaydı yapılamadı');
      toast('Bildirimler açıldı', 'success');
    } catch (err) {
      toast(err.message || 'Bildirimler açılamadı', 'error');
    } finally {
      if (button) button.disabled = false;
      nativeRefreshButton();
    }
  }

  ready(() => {
    // main.js'teki tarayıcı bildirimi işlevlerinin yerine geçer
    window.refreshBrowserNotificationButton = nativeRefreshButton;
    window.enableBrowserNotifications = nativeToggle;
    window.isStandaloneApp = () => true;
    // İzin daha önce verildiyse cihaz kimliği her açılışta tazelenir (değişebilir)
    if (PN && authHeader().Authorization) {
      PN.checkPermissions().then(p => { if (p.receive === 'granted') PN.register().catch(() => {}); }).catch(() => {});
    }
  });
})();
