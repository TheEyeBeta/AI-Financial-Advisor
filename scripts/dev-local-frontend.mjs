/**
 * Run Vite with the Python chat proxy pointed at a local FastAPI instance.
 * Does not read Railway: overrides VITE_PYTHON_API_URL for this process only.
 *
 * Usage: npm run dev:local
 * Prerequisite (separate terminal): npm run start:backend
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const viteEntry = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

const localUrl =
  process.env.VITE_PYTHON_API_URL_LOCAL?.trim() || "http://localhost:7000";

console.log(`[dev:local] VITE_PYTHON_API_URL -> ${localUrl}`);
console.log("[dev:local] Start backend in another terminal: npm run start:backend\n");

const child = spawn(process.execPath, [viteEntry], {
  cwd: rootDir,
  env: { ...process.env, VITE_PYTHON_API_URL: localUrl },
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("[dev:local] Failed to start Vite:", err.message);
  process.exit(1);
});
