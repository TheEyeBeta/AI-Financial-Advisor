/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode: _mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("@tanstack")) {
            return "query-vendor";
          }

          if (id.includes("@supabase")) {
            return "supabase-vendor";
          }

          // React must be in a single shared chunk to avoid duplicate instances.
          // recharts accesses React internals (__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED)
          // via react-dom; splitting React across chunks causes a TypeError at runtime.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          if (id.includes("recharts") || id.includes("react-smooth")) {
            return "recharts-vendor";
          }

          if (id.includes("d3-") || id.includes("internmap")) {
            return "d3-vendor";
          }

          if (id.includes("date-fns")) {
            return "date-vendor";
          }
        },
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: "./src/tests/setup.ts",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      exclude: [
        "node_modules/",
        "src/tests/setup.ts",
        "**/*.d.ts",
        "src/vite-env.d.ts",
      ],
      // Baseline floor — set just below current actual coverage so any regression
      // fails CI. Ratchet these up as new tests close the gap on under-tested
      // services (api-client, *-api, hooks). See docs/ci/CI_GUIDELINES.md.
      thresholds: {
        lines: 45,
        branches: 40,
      },
    },
  },
}));
