/* Disposable Temp Mail — offline shell.
 * Cache-first for the app shell; API traffic always hits the network.
 * Version the cache name on shell changes so updates roll out cleanly. */

const CACHE_NAME = "tmail-shell-v3";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/qrcodegen.js",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/site.webmanifest",
  "/docs.html",
  "/terms.html",
  "/privacy.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
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
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return; // inbox data is always live
  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
