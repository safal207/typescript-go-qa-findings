import { spawnSync } from "node:child_process";
import path from "node:path";

const cwd = path.resolve("repros/tsconfig-paths-extends");
const project = "extended-config.json";

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    shell: true,
    encoding: "utf-8"
  });

  return {
    label,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function printResult(result) {
  console.log(`\n=== ${result.label} ===`);
  console.log("exit:", result.status);

  if (result.stdout) {
    console.log("\nstdout:");
    console.log(result.stdout);
  }

  if (result.stderr) {
    console.log("\nstderr:");
    console.log(result.stderr);
  }
}

const tsc = run("classic tsc", "npx", ["tsc", "-p", project]);
const tsgo = run("typescript-go", "npx", ["tsgo", "-p", project]);

printResult(tsc);
printResult(tsgo);

console.log("\n=== comparison ===");
console.log("tsc exit:", tsc.status);
console.log("tsgo exit:", tsgo.status);

if (tsc.status !== tsgo.status) {
  console.log("Config behavior mismatch detected.");
  process.exitCode = 1;
} else {
  console.log("Config behavior exit codes match.");
}
