import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./lib/rbac";
import { ToastProvider } from "./design/components";
import { installErrorReporter } from "./lib/errorReporter";
import { reloadForStaleChunk } from "./lib/staleChunk";

// Observabilité front : capture des erreurs JS non gérées / rejets non gérés → errorLog (Admin).
installErrorReporter();

// Résilience aux DÉPLOIEMENTS (chemin PRELOAD) : `vite:preloadError` se déclenche quand un chunk hashé
// périmé n'est plus servi. On recharge une fois (util partagé avec l'ErrorBoundary, chemin RUNTIME).
window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); reloadForStaleChunk(); });

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
