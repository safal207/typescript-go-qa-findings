import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(".");
const fixtureRoot = path.resolve(
  process.env.BENCH_FIXTURE_ROOT ?? ".bench-workloads"
);
const workloadId = process.env.PROFILE_WORKLOAD ?? "module-resolution-heavy";
const checkers = parsePositiveInteger(
  process.env.PROFILE_CHECKERS,
  4,
  "PROFILE_CHECKERS"
);
const timestamp = new Date().toISOString();
const fileTimestamp = timestamp.replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = path.resolve(
  process.env.PROFILE_OUTPUT_DIR ??
    path.join("results/profiles", `${workloadId}-${fileTimestamp}`)
);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

if (!existsSync(path.join(fixtureRoot, "manifest.json"))) {
  run(process.execPath, ["scripts/generate-benchmark-fixtures.mjs"], {
    BENCH_FIXTURE_ROOT: fixtureRoot
  });
}

const manifest = JSON.parse(
  readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8")
);
const workload = manifest.workloads.find((entry) => entry.id === workloadId);
if (!workload) {
  throw new Error(`Unknown PROFILE_WORKLOAD: ${workloadId}`);
}

mkdirSync(outputDirectory, { recursive: true });
const projectDirectory = path.resolve(workload.projectDirectory);
const commandArgs = [
  "--no-install",
  "tsgo",
  "-p",
  ".",
  "--checkers",
  String(checkers),
  "--pprofDir",
  outputDirectory
];

const compile = spawnSync(npxCommand, commandArgs, {
  cwd: projectDirectory,
  encoding: "utf8",
  env: {
    ...process.env,
    CI: process.env.CI ?? "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0"
  },
  maxBuffer: 64 * 1024 * 1024
});

if (compile.error) {
  throw compile.error;
}
if (compile.status !== 0) {
  throw new Error(
    `tsgo profiling failed with status ${compile.status}\n${compile.stdout}\n${compile.stderr}`
  );
}

const files = readdirSync(outputDirectory).sort();
const cpuProfile = files.find((fileName) => fileName.includes("cpuprofile")) ?? null;
const memoryProfile = files.find((fileName) => fileName.includes("memprofile")) ?? null;

if (!cpuProfile || !memoryProfile) {
  throw new Error(
    `Expected CPU and memory profiles in ${outputDirectory}; found: ${files.join(", ")}`
  );
}

const cpuTop = runPprof(path.join(outputDirectory, cpuProfile));
const memoryTop = runPprof(path.join(outputDirectory, memoryProfile), "alloc_space");

writeFileSync(path.join(outputDirectory, "cpu-top.txt"), cpuTop.text, "utf8");
writeFileSync(path.join(outputDirectory, "alloc-top.txt"), memoryTop.text, "utf8");

const report = {
  schemaVersion: 1,
  generatedAt: timestamp,
  workload,
  checkers,
  projectDirectory,
  command: [npxCommand, ...commandArgs],
  compilerStdout: normalizeOutput(compile.stdout),
  compilerStderr: normalizeOutput(compile.stderr),
  profiles: {
    cpu: cpuProfile,
    memory: memoryProfile
  },
  pprof: {
    cpuAvailable: cpuTop.available,
    memoryAvailable: memoryTop.available,
    cpuError: cpuTop.error,
    memoryError: memoryTop.error
  }
};

writeFileSync(
  path.join(outputDirectory, "profile-metadata.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
writeFileSync(
  path.join(outputDirectory, "profile-summary.md"),
  renderMarkdown(report, cpuTop.text, memoryTop.text),
  "utf8"
);

console.log(path.join(outputDirectory, "profile-summary.md"));

function runPprof(profilePath, sampleIndex = null) {
  const args = ["tool", "pprof", "-top", "-nodecount=40"];
  if (sampleIndex) {
    args.push(`-sample_index=${sampleIndex}`);
  }
  args.push(profilePath);

  const result = spawnSync("go", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });

  if (result.error) {
    return {
      available: false,
      text: `go tool pprof unavailable: ${result.error.message}\n`,
      error: result.error.message
    };
  }

  const text = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    available: result.status === 0,
    text: `${text}\n`,
    error: result.status === 0 ? null : `go tool pprof exited ${result.status}`
  };
}

function renderMarkdown(report, cpuTop, memoryTop) {
  return `# TypeScript Go profile\n\nGenerated: ${report.generatedAt}\n\nWorkload: \`${report.workload.id}\` (${report.workload.sourceFiles} generated source files)\n\nCheckers: ${report.checkers}\n\n## CPU top\n\n\`\`\`text\n${cpuTop.trim()}\n\`\`\`\n\n## Allocation top\n\n\`\`\`text\n${memoryTop.trim()}\n\`\`\`\n\n## Selection rule\n\nA Rust prototype candidate must be visible in the profile, isolated enough for behavior-equivalent testing, and relevant to more than one workload. Runtime, scheduler, garbage-collector, and orchestration frames are evidence about system behavior but are not automatically suitable porting targets.\n`;
}

function run(command, args, environmentOverrides = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environmentOverrides
    }
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
}

function normalizeOutput(value) {
  return String(value)
    .replaceAll("\r\n", "\n")
    .replaceAll(repositoryRoot, "<REPOSITORY_ROOT>")
    .replaceAll(projectDirectory, "<PROJECT_ROOT>")
    .trim();
}

function parsePositiveInteger(rawValue, fallback, name) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
