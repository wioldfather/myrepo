// Offline support. Serves from cache first and refreshes the cache in the background,
// so a new version shows up on the launch after it was downloaded.
const CACHE = 'chongshi-v2';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png',
  'js/main.js', 'js/store.js', 'js/audio.js', 'js/ui.js', 'js/journey.js', 'js/scene.js', 'js/recall.js', 'js/games.js', 'js/ride.js', 'js/level.js', 'js/talk.js', 'js/llm.js', 'js/compose.js', 'js/sync.js', 'js/content.gen.js', 'js/words.gen.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
