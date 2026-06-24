import { spawnSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

const cwd = path.resolve("repros/benchmark-sample");
const checkerValues = [1, 2, 4, 8];

function run(command, args) {
  const startedAt = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    shell: true,
    encoding: "utf-8"
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  return {
    command: [command, ...args].join(" "),
    status: result.status,
    elapsedMs,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

const rows = [];

rows.push({
  label: "tsc baseline",
  checkers: "n/a",
  ...run("npx", ["tsc", "-p", "."])
});

for (const checkers of checkerValues) {
  rows.push({
    label: "tsgo",
    checkers,
    ...run("npx", ["tsgo", "-p", ".", "--checkers", String(checkers)])
  });
}

console.log("# Benchmark matrix: checker count");
console.log();
console.log("Project: repros/benchmark-sample");
console.log();
console.log("| Label | Checkers | Exit | Elapsed ms | Command |");
console.log("|---|---:|---:|---:|---|");

for (const row of rows) {
  console.log(`| ${row.label} | ${row.checkers} | ${row.status} | ${row.elapsedMs} | \`${row.command}\` |`);
}

const failed = rows.some(row => row.status !== 0);

if (failed) {
  console.log();
  console.log("At least one benchmark command failed. Inspect stdout/stderr locally for details.");
  process.exitCode = 1;
}
