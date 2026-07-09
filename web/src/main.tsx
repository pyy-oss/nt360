import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./lib/rbac";
import { ToastProvider } from "./design/components";
import { installErrorReporter } from "./lib/errorReporter";

// Observabilité front : capture des erreurs JS non gérées / rejets non gérés → errorLog (Admin).
installErrorReporter();

// Résilience aux DÉPLOIEMENTS : après un déploiement, les anciens chunks hashés disparaissent du
// hosting ; un onglet resté ouvert qui charge un module paresseux périmé échoue (« Failed to fetch
// dynamically imported module »). On recharge alors UNE fois pour récupérer le nouvel index + chunks
// (garde-fou anti-boucle : au plus un rechargement par tranche de 10 s). Évite l'« ERREUR D'AFFICHAGE ».
window.addEventListener("vite:preloadError", () => {
  const KEY = "nt360-chunk-reload";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last > 10000) {
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
});

// PWA (Lot 10) : enregistre le service worker (shell installable + ouverture hors-ligne) UNIQUEMENT en
// PRODUCTION — en dev, un SW interfère avec le HMR de Vite. Best-effort (jamais bloquant).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* PWA best-effort */ });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
