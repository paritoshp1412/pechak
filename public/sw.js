const CACHE = "ledger-app-v5";

// The app shell HTML -- served network-first so a deploy is picked up as soon
// as the device is online, but still works offline from the last cached copy.
const SHELL_URL = "./index.html";

// Static, effectively-immutable assets: safe to cache-first. Hashed bundle
// files under ./assets/ are added to this same cache lazily on first fetch
// (see the fetch handler below) rather than listed here by name, since their
// hash changes on every build.
const PRECACHE = [
  SHELL_URL,
  "./manifest.json",
  "./template.xlsx",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png",
  "./fonts/fonts.css",
  "./fonts/space-grotesk.woff2",
  "./fonts/inter.woff2",
  "./fonts/jetbrains-mono.woff2",
];

// Live price/data lookups: never cached, never served stale. A failure here
// must surface to the page as a rejected fetch, not a silent cached fallback
// or a swallowed error -- these calls are optional and the UI already shows
// a visible error when they fail, as long as the service worker stays out of
// the way entirely.
const NETWORK_ONLY_HOSTS = [
  "api.mfapi.in",
  "ledger-stock-proxy.paritoshp1412.workers.dev",
  "api.codetabs.com",
  "api.allorigins.win",
  "query1.finance.yahoo.com",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
  // No skipWaiting() here: a newly-installed worker waits until the page
  // explicitly asks it to take over (see the "message" listener below), so an
  // update never interrupts an in-flight import/merge or swaps the app shell
  // out from under the user without warning.
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isImmutableAsset(url) {
  return url.origin === self.location.origin && url.pathname.includes("/assets/");
}

// Cache-first: fetch once, reuse forever (safe because the filename is content-hashed).
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

// Network-first: always try the network so updates show up immediately;
// fall back to the last cached copy only when the network fails.
async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    // Don't intercept at all -- let the page's own fetch() promise reject
    // and surface its own visible error when offline or the API is down.
    return;
  }

  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/") {
    e.respondWith(networkFirst(e.request).catch(() => caches.match(SHELL_URL)));
    return;
  }

  if (isImmutableAsset(url) || PRECACHE.some((p) => url.pathname.endsWith(p.replace("./", "/")))) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  e.respondWith(networkFirst(e.request));
});
