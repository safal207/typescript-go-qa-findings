import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(".");
const configurationPath = path.resolve(
  process.env.GC_BENCH_TARGETS ?? "benchmarks/gc-policy/targets.json"
);
const workRoot = path.resolve(process.env.GC_BENCH_WORK_ROOT ?? ".bench-gc");
const targetId = process.env.GC_BENCH_TARGET ?? "date-fns-v4.1.0";
const configuration = JSON.parse(readFileSync(configurationPath, "utf8"));
const target = configuration.targets.find((entry) => entry.id === targetId);

if (!target) {
  throw new Error(`Unknown GC_BENCH_TARGET: ${targetId}`);
}

const typescriptGoDirectory = path.join(workRoot, "typescript-go");
const targetDirectory = path.join(workRoot, "targets", target.id);
const binaryDirectory = path.join(workRoot, "bin");
const binaryPath = path.join(
  binaryDirectory,
  process.platform === "win32" ? "tsgo-bench.exe" : "tsgo-bench"
);
const patchOutput = path.join(workRoot, "typescript-go-benchmark.patch");
const manifestPath = path.join(workRoot, "manifest.json");

rmSync(workRoot, { recursive: true, force: true });
mkdirSync(binaryDirectory, { recursive: true });
mkdirSync(path.dirname(targetDirectory), { recursive: true });

console.error(`[prepare] cloning typescript-go ${configuration.typescriptGo.commit}`);
cloneRef(
  configuration.typescriptGo.repository,
  configuration.typescriptGo.commit,
  typescriptGoDirectory
);

const upstreamCommit = runText("git", ["rev-parse", "HEAD"], typescriptGoDirectory);
const upstreamMainPath = path.join(typescriptGoDirectory, "cmd", "tsgo", "main.go");
const upstreamInstrumentationPath = path.join(
  typescriptGoDirectory,
  "cmd",
  "tsgo",
  "bench_runtime.go"
);
copyFileSync(
  path.join(repositoryRoot, "benchmarks", "gc-policy", "bench_runtime.go"),
  upstreamInstrumentationPath
);

const mainSource = readFileSync(upstreamMainPath, "utf8");
const insertionNeedle =
  "\t}\n\tctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)";
const insertionReplacement =
  "\t}\n\tstopBenchmarkRuntime := startBenchmarkRuntime()\n\tdefer stopBenchmarkRuntime()\n\tctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)";

if (!mainSource.includes(insertionNeedle)) {
  throw new Error("Unable to locate CLI-only instrumentation insertion point in cmd/tsgo/main.go");
}
writeFileSync(
  upstreamMainPath,
  mainSource.replace(insertionNeedle, insertionReplacement),
  "utf8"
);
runChecked("gofmt", ["-w", upstreamMainPath, upstreamInstrumentationPath]);

runChecked(
  "git",
  ["add", "--intent-to-add", "cmd/tsgo/bench_runtime.go"],
  typescriptGoDirectory
);
const patch = runText(
  "git",
  ["diff", "--binary", "--", "cmd/tsgo/main.go", "cmd/tsgo/bench_runtime.go"],
  typescriptGoDirectory,
  { allowEmpty: true }
);
writeFileSync(patchOutput, `${patch}\n`, "utf8");

console.error("[prepare] building instrumented tsgo");
runChecked(
  "go",
  ["build", "-trimpath", "-o", binaryPath, "./cmd/tsgo"],
  typescriptGoDirectory
);

console.error(`[prepare] cloning target ${target.id} (${target.ref})`);
cloneRef(target.repository, target.ref, targetDirectory);
const targetCommit = runText("git", ["rev-parse", "HEAD"], targetDirectory);
const generatedFiles = writeGeneratedTargetFiles(
  target.generatedFiles ?? {},
  targetDirectory
);

if (target.setup) {
  console.error(`[prepare] setup ${target.id}: ${target.setup.command} ${target.setup.args.join(" ")}`);
  runChecked(target.setup.command, target.setup.args, targetDirectory, {
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false"
  });
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repositoryRoot,
  workRoot,
  binaryPath,
  patchOutput,
  typescriptGo: {
    repository: configuration.typescriptGo.repository,
    requestedCommit: configuration.typescriptGo.commit,
    resolvedCommit: upstreamCommit,
    directory: typescriptGoDirectory
  },
  target: {
    ...target,
    generatedFiles,
    resolvedCommit: targetCommit,
    directory: targetDirectory,
    projectPath: path.resolve(targetDirectory, target.project)
  },
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    npm: versionOf("npm", ["--version"]),
    go: versionOf("go", ["version"]),
    git: versionOf("git", ["--version"])
  }
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(manifestPath);

function writeGeneratedTargetFiles(files, directory) {
  const records = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const outputPath = path.resolve(directory, relativePath);
    const relative = path.relative(directory, outputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Generated target file escapes target directory: ${relativePath}`);
    }
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content, "utf8");
    records.push({
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: Buffer.byteLength(content)
    });
  }
  return records;
}

function cloneRef(repository, ref, directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  runChecked("git", ["init", "--quiet"], directory);
  runChecked("git", ["remote", "add", "origin", repository], directory);
  runChecked(
    "git",
    ["fetch", "--quiet", "--depth", "1", "origin", ref],
    directory
  );
  runChecked("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], directory);
}

function runChecked(command, args, cwd = repositoryRoot, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment
    },
    maxBuffer: 128 * 1024 * 1024
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function runText(command, args, cwd = repositoryRoot, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status}\n${result.stderr}`
    );
  }
  const text = result.stdout.trim();
  if (!text && !options.allowEmpty) {
    throw new Error(`${command} ${args.join(" ")} returned empty output`);
  }
  return text;
}

function versionOf(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  if (result.status !== 0 || result.error) {
    return "unavailable";
  }
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}
