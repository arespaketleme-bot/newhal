// Proje Vitrini bildirim yardımcısı: yalnız bildirimleri gösterir, sayfaları önbelleğe almaz.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let veri = {};
  try { veri = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(veri.title || 'Proje Vitrini', {
    body: veri.body || 'Vitrine yeni bir proje eklendi.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: veri.tag || 'proje-vitrini',
    data: { url: veri.url || self.registration.scope },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hedef = new URL(event.notification.data?.url || self.registration.scope, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pencereler) => {
    const acik = pencereler.find((p) => p.url.startsWith(self.registration.scope));
    if (acik) return acik.navigate(hedef).then((p) => (p || acik).focus());
    return self.clients.openWindow(hedef);
  }));
});
