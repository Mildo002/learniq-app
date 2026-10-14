// LearnIQ – service worker iba na inštaláciu aplikácie (žiadna vyrovnávacia pamäť – vždy aktuálne údaje)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
