const SHELL = ["./", "./index.html", "./app.css", "./app.js", "./sim-engine.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("kong-shell-v48").then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("kong-shell") && key !== "kong-shell-v48").map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith("/data/latest.json") || url.pathname.includes("/data/week-") || url.pathname.endsWith("/data/streaks.json") || url.pathname.endsWith("/data/model-lab.json") || url.pathname.endsWith("/data/warroom.json") || url.pathname.endsWith("/data/warroom-backtest.json") || url.pathname.endsWith("/data/learning.json") || url.pathname.endsWith("/data/reviews.json") || url.pathname.endsWith("/data/locker-room.json") || url.pathname.endsWith("/data/beat-x.json") || url.pathname.endsWith("/data/beat-writers.json") || url.pathname.endsWith("/data/referees.json") || url.pathname.endsWith("/data/model-v48.json") || url.pathname.endsWith("/data/practice-log.json")) {
    event.respondWith(networkThenCache(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});

async function networkThenCache(request) {
  const cache = await caches.open("kong-data");
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}
