const CACHE_NAME = 'solfege-master-v2';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/abcjs@6.3.0/dist/abcjs-basic-min.js',
  'https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap'
];

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 1. Core local files (critical)
      const corePromise = cache.addAll(CORE_ASSETS);

      // 2. Pre-cache CDN libraries in non-blocking fashion
      const cdnPromises = Promise.allSettled(
        CDN_ASSETS.map((url) =>
          fetch(url, { mode: 'cors' })
            .then((res) => {
              if (res.ok || res.type === 'opaque') {
                return cache.put(url, res);
              }
            })
            .catch((err) => {
              console.warn('[SW] Non-blocking CDN pre-cache failed for:', url, err);
            })
        )
      );

      return Promise.all([corePromise, cdnPromises]);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignore non-http/https schemes (e.g. chrome-extension:)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isCdnOrSample =
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('tailwindcss.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('gleitz.github.io');

  if (isCdnOrSample) {
    // Cache-First strategy for CDN libraries & soundfont samples
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          }
          return networkResponse;
        }).catch(() => {
          return cachedResponse || Response.error();
        });
      })
    );
  } else {
    // Network-First strategy with Cache Fallback for same-origin app files
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return networkResponse;
      }).catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html') || await caches.match('./');
          if (fallback) return fallback;
        }
        return new Response('Офлайн режим: Ресурсът не е в кеша', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
  }
});
