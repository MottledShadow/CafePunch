const CACHE_NAME = 'cafe-checkin-v6';
const APP_SHELL = [
  './manifest.json',
  './assets/logo-mark.png',
  './assets/logo-full.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(async keys => {
      const oldKeys = keys.filter(key => key !== CACHE_NAME);
      await Promise.all(oldKeys.map(key => caches.delete(key)));
      await self.clients.claim();

      if (oldKeys.length > 0) {
        const clients = await self.clients.matchAll({ type: 'window' });
        await Promise.all(clients.map(client =>
          'navigate' in client ? client.navigate(client.url) : Promise.resolve()
        ));
      }
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // API responses must always reflect the server.
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  const acceptsHtml = (event.request.headers.get('accept') || '').includes('text/html');
  const isNavigation = event.request.mode === 'navigate' || acceptsHtml;

  if (isNavigation) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', clone));
        }
        return response;
      }).catch(() =>
        caches.match('./index.html').then(cached =>
          cached || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
        )
      )
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then(response => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then(cached =>
        cached || new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      )
    )
  );
});
