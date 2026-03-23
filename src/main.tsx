import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { assertFrontendRuntimeConfigForProduction } from "@/lib/env";
import App from "./App.tsx";
import "./index.css";

assertFrontendRuntimeConfigForProduction();

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
