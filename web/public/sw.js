// Service worker nt360 (Lot 10 « niveau Salesforce » — PWA). OBJECTIF : rendre l'app INSTALLABLE
// (écran d'accueil, mode standalone) et ouvrable même hors-ligne (shell caché). Stratégie VOLONTAIREMENT
// MINIMALE et sûre : on ne met en cache QUE le shell de navigation (index.html) en « network-first » ;
// on ne touche à AUCUNE requête cross-origin (Firestore, API, hosting des chunks) ni aux requêtes non-GET.
// Ainsi un déploiement sert toujours le nouvel index en ligne (pas de chunk périmé bloquant), et le repli
// hors-ligne affiche le shell. skipWaiting + clientsClaim → les mises à jour du SW s'appliquent proprement.
const SHELL = "nt360-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // jamais les appels externes (Firestore/API/CDN)
  // Navigations (documents HTML) : réseau d'abord, repli sur le shell caché → l'app OUVRE hors-ligne.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put("/index.html", res.clone());
        return res;
      } catch {
        const cached = await caches.match("/index.html");
        return cached || new Response("Hors-ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});
