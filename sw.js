/* Self-destructing service worker.
 * Older builds installed a SW that could hang navigations in Safari.
 * This file replaces it, clears caches, unregisters, and reloads clients.
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (_) { /* ignore */ }

    try {
      await self.registration.unregister();
    } catch (_) { /* ignore */ }

    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try {
        client.navigate(client.url);
      } catch (_) {
        try { client.postMessage({ type: 'RELOAD' }); } catch (__) { /* ignore */ }
      }
    }
  })());
});

// Intentionally no fetch handler — do not intercept network requests.
