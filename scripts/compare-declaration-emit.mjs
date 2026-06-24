import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const cwd = path.resolve("repros/declaration-emit");
const declarationPath = path.join(cwd, "dist", "index.d.ts");

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    shell: true,
    encoding: "utf-8"
  });

  const declaration = existsSync(declarationPath)
    ? readFileSync(declarationPath, "utf-8")
    : null;

  return {
    label,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    declaration
  };
}

function printResult(result) {
  console.log(`\n=== ${result.label} ===`);
  console.log("exit:", result.status);
  console.log("declaration emitted:", result.declaration ? "yes" : "no");

  if (result.stdout) {
    console.log("\nstdout:");
    console.log(result.stdout);
  }

  if (result.stderr) {
    console.log("\nstderr:");
    console.log(result.stderr);
  }
}

const tsc = run("classic tsc", "npx", ["tsc", "-p", "."]);
const tsgo = run("typescript-go", "npx", ["tsgo", "-p", "."]);

printResult(tsc);
printResult(tsgo);

console.log("\n=== comparison ===");
console.log("tsc exit:", tsc.status);
console.log("tsgo exit:", tsgo.status);
console.log("tsc declaration length:", tsc.declaration?.length ?? 0);
console.log("tsgo declaration length:", tsgo.declaration?.length ?? 0);

const exitMismatch = tsc.status !== tsgo.status;
const declarationMismatch = tsc.declaration !== tsgo.declaration;

if (exitMismatch || declarationMismatch) {
  console.log("Mismatch detected.");
  process.exitCode = 1;
} else {
  console.log("Exit code and declaration output match.");
}
