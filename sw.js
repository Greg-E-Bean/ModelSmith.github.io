// ModelSmith service worker — caches the app shell so it launches offline.
// Bumping CACHE_NAME on each release makes browsers drop the old cache and
// pull the new files (see the 'activate' handler below).
const CACHE_NAME = 'modelsmith-v1.9.4';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/vendor/three.min.js',
  './js/vendor/OrbitControls.js',
  './js/vendor/TransformControls.js',
  './js/01-fonts-data.js',
  './js/02-keybindings.js',
  './js/03-storage.js',
  './js/04-version-and-font-cleanup.js',
  './js/05-psd-parser.js',
  './js/06-opentype.js',
  './js/07-csg-engine.js',
  './js/08-builder-3d.js',
  './js/09-sidebar-toggle.js',
  './js/10-paint-studio.js',
  './js/11-history-panel.js',
  './js/12-shortcuts-dialog.js',
  './js/13-tool-chevrons.js',
  './js/14-menu-bar-3d.js',
  './js/15-builder-dialogs.js',
  './js/16-simple-advanced-mode.js',
  './js/17-tooltips.js',
  './js/18-command-search.js',
  './js/19-tool-dialogs.js',
  './js/20-files-dialog.js',
  './js/21-export-dialog.js',
  './js/22-full-panels-toggle.js',
  './js/23-panel-manager.js',
  './js/24-inline-rename.js',
  './js/25-sidebar-resize.js',
  './js/26-qr-encoder.js',
  './js/27-qr-panel-3d.js',
  './js/28-qr-panel-2d.js',,
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the app HTML, JS and CSS (so edits are picked up when
// online), cache-first for everything else (icons, fonts, etc).
// Only successful GET responses are cached, so a 404/500 can't get stuck in
// the cache, and a missing script/style is never answered with index.html.
const cacheable = (res) => res && (res.ok || res.type === 'opaque');
const store = (req, res) => {
  if (cacheable(res)) {
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const isPage = req.mode === 'navigate' || req.destination === 'document';
  if (isPage || req.destination === 'script' || req.destination === 'style') {
    event.respondWith(
      fetch(req)
        .then((res) => store(req, res))
        .catch(() => caches.match(req).then((res) =>
          res || (isPage ? caches.match('./index.html') : Response.error())))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => store(req, res));
    })
  );
});
