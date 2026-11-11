import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { Router } from "./lib/router";
import { SessionProvider } from "./lib/session";
import "./styles.css";
import { LangProvider } from "./lib/i18n";

try {
  const t = localStorage.getItem("waymark-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <Router>
        <ToastProvider>
          <ConfirmProvider>
            <SessionProvider>
              <App />
            </SessionProvider>
          </ConfirmProvider>
        </ToastProvider>
      </Router>
    </LangProvider>
  </StrictMode>,
);
