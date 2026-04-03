import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { assertFrontendRuntimeConfigForProduction } from "@/lib/env";
import App from "./App.tsx";
import "./index.css";

try {
  assertFrontendRuntimeConfigForProduction();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.getElementById("root")!.innerHTML = `
    <div style="display:flex;min-height:100vh;flex-direction:column;align-items:center;justify-content:center;padding:2rem;font-family:sans-serif;text-align:center;background:#0f172a;color:#f1f5f9">
      <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:0.5rem">Configuration Error</h1>
      <p style="font-size:0.875rem;color:#94a3b8;margin-bottom:1rem">The app is missing required environment variables.</p>
      <pre style="background:#1e293b;padding:1rem;border-radius:0.5rem;font-size:0.75rem;max-width:40rem;overflow:auto;text-align:left">${msg}</pre>
    </div>`;
  throw err;
}

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
    environment: import.meta.env.MODE,
    enabled: true,
  });
}

createRoot(document.getElementById("root")!).render(<App />);
