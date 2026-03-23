import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

const command = isWindows ? "powershell" : "bash";
const args = isWindows
  ? ["-ExecutionPolicy", "Bypass", "-File", path.join(scriptDir, "start-backend.ps1")]
  : [path.join(scriptDir, "start-backend.sh")];

const child = spawn(command, args, {
  cwd: rootDir,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to launch backend startup script via ${command}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
