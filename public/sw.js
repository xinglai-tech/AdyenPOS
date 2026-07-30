const CACHE_NAME = 'pos-v57';
const PRECACHE = ['/', '/css/style.css', '/js/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) return;

  // Network-first: always try server, fall back to cache (offline support)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        // Opaque cross-origin responses (CDN font/icon files) cannot be cached, so
        // swallow that rejection instead of letting it surface as unhandled.
        caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, clone))
          .catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
