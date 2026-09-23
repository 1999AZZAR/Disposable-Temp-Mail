/* Disposable Temp Mail — offline shell.
 * App shell is cache-first; API traffic always hits the network.
 * Navigations are network-first so an auth gate (e.g. Cloudflare Access)
 * or any redirect is never cached and replayed as the app shell — Safari
 * kills tabs that serve a stale login page for "/" ("a problem repeatedly
 * occurred"). Only genuine same-origin 200s (response.type "basic") are
 * ever stored. Version the cache name on shell changes. */

const CACHE_NAME = "tmail-shell-v9";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/qrcodegen.js",
  "/i18n.js",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/site.webmanifest",
  "/docs.html",
  "/terms.html",
  "/privacy.html",
  "/docs-id.html",
  "/terms-id.html",
  "/privacy-id.html",
];

/* Precache best-effort: skip anything gated, redirected, or offline so a
 * single bad asset can never fail the install. */
async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    SHELL.map(async (path) => {
      try {
        const response = await fetch(path, { credentials: "same-origin" });
        if (response.ok && response.type === "basic") {
          await cache.put(path, response);
        }
      } catch {
        /* offline or gated: shell simply stays live-only for this asset */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
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

async function cacheableCopy(request, response) {
  if (response.ok && response.type === "basic" && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return; // inbox data is always live
  if (request.mode === "navigate") {
    // Navigations go to the network first; cached shell is the offline fallback only.
    event.respondWith(fetch(request).then((response) => cacheableCopy(request, response)).catch(() => caches.match("/index.html")));
    return;
  }
  event.respondWith(
    caches
      .match(request)
      .then((cached) => cached || fetch(request).then((response) => cacheableCopy(request, response))),
  );
});
