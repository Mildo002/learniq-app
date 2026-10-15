// LearnIQ – service worker: inštalácia aplikácie, upozornenia a číslo na ikone (žiadna vyrovnávacia pamäť – vždy aktuálne údaje)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const show = self.registration.showNotification(d.title || "LearnIQ", {
    body: d.body || "", icon: "img/icon-192.png", badge: "img/icon-192.png", lang: "sk",
    tag: d.tag || undefined, renotify: !!d.tag,
    requireInteraction: !!d.important,          // test čakajúci na potvrdenie ostane na obrazovke
    vibrate: [200, 100, 200], timestamp: Date.now(),
    data: { url: d.url || "/#/" },
  });
  // číslo na ikone aplikácie (Android, iPhone z plochy, Windows/macOS)
  const badge = typeof d.badge === "number" && self.navigator.setAppBadge
    ? self.navigator.setAppBadge(Math.max(1, d.badge)).catch(() => {}) : Promise.resolve();
  e.waitUntil(Promise.all([show, badge]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && !c.url.includes("/kurz.html")) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
