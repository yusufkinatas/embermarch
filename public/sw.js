/*
 * Embermarch service worker: makes the game installable and playable offline after the first visit.
 * - Pages: network first (a new deploy shows up on the next launch), cached copy when offline.
 * - Hashed build assets and fonts: cache first (their names change when their content does).
 * - Everything else same-origin: stale-while-revalidate.
 * Bump VERSION only to force-drop every cached file.
 */
const VERSION = 'v1';
const CACHE = `embermarch-${VERSION}`;
const SHELL = './';
const scopeUrl = new URL(self.registration.scope);

/** Fetch the page, cache it and the assets it references. */
async function cacheShell(cache) {
  const res = await fetch(SHELL, { cache: 'no-cache' });
  if (!res.ok) return;
  await cache.put(SHELL, res.clone());
  const html = await res.text();
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => new URL(m[1], scopeUrl))
    .filter((u) => u.origin === scopeUrl.origin && !u.pathname.endsWith('/'));
  await Promise.all(refs.map((u) => cache.add(u.href).catch(() => undefined)));
  await pruneAssets(cache, refs);
}

/** Drop hashed assets from older builds that the current page no longer references. */
async function pruneAssets(cache, refs) {
  const keep = new Set(refs.map((u) => u.pathname));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.includes('/assets/') && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cacheShell).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('embermarch-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scopeUrl.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok && url.pathname === scopeUrl.pathname) {
          await cache.put(SHELL, res.clone());
          event.waitUntil(cacheShell(cache).catch(() => undefined));
        }
        return res;
      } catch {
        return (await cache.match(SHELL)) || Response.error();
      }
    })());
    return;
  }

  const immutable = url.pathname.includes('/assets/') || url.pathname.includes('/fonts/');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit && immutable) return hit;
    const net = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      event.waitUntil(net.catch(() => undefined));
      return hit;
    }
    return net;
  })());
});
