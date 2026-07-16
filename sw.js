/* ============================================================
   Service worker — makes the app installable and fast.
   Strategy:
   • App shell (HTML/CSS/JS/icons) is cached so the app opens
     instantly and even works offline (you'll see the last data).
   • Supabase API calls are NEVER cached — they always go to the
     network so posts and chat stay live.
   Bump CACHE_VERSION whenever you change app files, so phones
   pick up the new version.
   ============================================================ */

const CACHE_VERSION = "umphakathi-v9";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/db.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./images/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache Supabase / API / CDN calls — always go to the network.
  const isApi =
    url.hostname.endsWith("supabase.co") ||
    url.hostname.endsWith("supabase.in") ||
    url.hostname.includes("clickatell") ||
    url.pathname.includes("/rest/") ||
    url.pathname.includes("/auth/") ||
    url.pathname.includes("/realtime/");
  if (isApi || url.protocol === "wss:") return;

  // App shell & other same-origin assets: cache-first, refresh in background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

/* ---------------- push notifications ---------------- */

// A push arrives (even with the app closed) — show a notification.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const title = data.title || "Umphakathi";
  const options = {
    body: data.body || "",
    icon: "images/icon-192.png",
    badge: "images/icon-192.png",
    tag: data.tag || "post",            // same tag replaces, doesn't stack endlessly
    data: { url: data.url || "./index.html" },
    vibrate: data.urgent ? [200, 100, 200] : [100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses the app (or opens it).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
