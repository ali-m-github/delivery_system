// Jet Delivery service worker.
//
// Strategy (kept deliberately conservative for a data-heavy dashboard):
//   - API / auth / upload requests are never cached (network passthrough) so
//     order, payout and session data is always fresh.
//   - Page navigations are network-first with an offline fallback to "/" so an
//     installed PWA still launches without a connection.
//   - Static assets (icons, _next/static, fonts) are cache-first and
//     opportunistically persisted.

const CACHE_NAME = "jet-delivery-v1";
const PRECACHE_URLS = [
  "/",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/icon-maskable-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // Never touch same-origin API, auth or upload traffic — always hit the network.
  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/uploads/") ||
      url.pathname === "/manifest.json" ||
      url.pathname === "/sw.js"
    ) {
      return;
    }

    // Navigations: network-first, fall back to the cached shell when offline.
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request).catch(() => caches.match("/")),
      );
      return;
    }

    // Static build assets and icons: cache-first with background refresh.
    if (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icon-") ||
      url.pathname.endsWith(".ico")
    ) {
      event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
          const cached = await cache.match(request);
          const network = fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cached);
          return cached || network;
        }),
      );
      return;
    }
  }
});
