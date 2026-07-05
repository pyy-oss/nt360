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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
