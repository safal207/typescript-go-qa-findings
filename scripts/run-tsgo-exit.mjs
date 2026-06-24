import { spawnSync } from "node:child_process";
import path from "node:path";

const cwd = path.resolve("repros/exit-code-noemit");
const result = spawnSync("npx", ["tsgo", "-p", "."], {
  cwd,
  shell: true,
  stdio: "inherit"
});

process.exitCode = result.status ?? 1;
