// Offline support: answer from the cache at once, and update the cache from the network for the next visit.
const CACHE = 'tabata';
const FILES = ['./', 'index.html', 'app.js', 'timeline.js', 'voice.mp3', 'voice.json',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const update = caches.open(CACHE).then(async (cache) => {
    const response = await fetch(e.request);
    if (response.ok) await cache.put(e.request, response.clone());
    return response;
  });
  e.waitUntil(update.catch(() => {}));
  e.respondWith(caches.match(e.request).then((cached) => cached || update));
});
