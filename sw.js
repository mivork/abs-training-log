/**
 * Service Worker — network-first 戦略
 * CACHE_NAME: abs-training-log-v4
 */
const CACHE_NAME = 'abs-training-log-v4';

const CACHE_TARGETS = [
  './',
  'index.html',
  'css/style.css',
  'css/tokens.css',
  'css/base.css',
  'js/main.js',
  'icon.svg',
  'manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_TARGETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // CDN（Chart.js など外部リソース）はキャッシュ対象外
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
