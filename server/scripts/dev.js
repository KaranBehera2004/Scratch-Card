import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = path.resolve(serverRoot, "../client");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this launcher through npm run dev.");

const children = [
  spawn(process.execPath, ["--watch", "src/app/index.js"], {
    cwd: serverRoot,
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, [npmCli, "--prefix", clientRoot, "run", "dev"], {
    cwd: serverRoot,
    stdio: "inherit",
    env: process.env,
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = code;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) stop(code || (signal ? 1 : 0));
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
