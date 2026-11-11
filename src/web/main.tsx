import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { Router } from "./lib/router";
import { SessionProvider } from "./lib/session";
import "./styles.css";

try {
  const t = localStorage.getItem("waymark-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <ToastProvider>
        <ConfirmProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ConfirmProvider>
      </ToastProvider>
    </Router>
  </StrictMode>,
);
