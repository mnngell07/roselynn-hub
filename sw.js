const cachePrefix = 'roselynn-hub-shell-';
const cacheName = cachePrefix + 'v2';
const shell = ['./', './index.html', './styles.css', './app.js', './features.js',
  './config.js', './manifest.json', './icon-192.png', './icon-512.png'];
const shellUrls = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !shellUrls.has(request.url)) return;
  // Only static app files are eligible. Auth and database responses never enter this cache.
  event.respondWith(fetch(request, {cache:'no-cache'}).then(response => {
    if (response.ok) {
      const saved = response.clone();
      event.waitUntil(caches.open(cacheName).then(cache => cache.put(request, saved)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) ?? Response.error()));
});
