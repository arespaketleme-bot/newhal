// NewHal uygulama önbelleği: sayfa iskeleti çevrimdışı açılır, veriler her zaman canlı çekilir.
const CACHE = 'newhal-v1';
const SHELL = [
  '/', '/offline.html', '/manifest.webmanifest',
  '/css/main.css', '/js/main.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/img/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // harita, yazı tipi vb. tarayıcıya kalsın
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/admin')) return;

  // Sayfalar: önce internet, yoksa önbellek, o da yoksa "bağlantı yok" sayfası
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || caches.match('/offline.html'))
    );
    return;
  }

  // Stil, kod, görseller: önce internet (güncel sürüm), yoksa önbellek
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
