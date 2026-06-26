import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(".");
const projectDirectory = path.resolve(
  process.env.BENCH_PROJECT ?? "repros/benchmark-sample"
);
const outputDirectory = path.resolve(
  process.env.BENCH_OUTPUT_DIR ?? "results/performance"
);
const measuredIterations = parsePositiveInteger(
  process.env.BENCH_ITERATIONS,
  7,
  "BENCH_ITERATIONS"
);
const warmupIterations = parseNonNegativeInteger(
  process.env.BENCH_WARMUPS,
  2,
  "BENCH_WARMUPS"
);
const checkerValues = parseCheckerValues(
  process.env.BENCH_CHECKERS ?? "1,2,4,8"
);
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

if (!existsSync(projectDirectory)) {
  throw new Error(`Benchmark project does not exist: ${projectDirectory}`);
}

mkdirSync(outputDirectory, { recursive: true });

const timestamp = new Date().toISOString();
const fileTimestamp = timestamp.replaceAll(":", "-").replaceAll(".", "-");
const jsonPath = path.join(outputDirectory, `baseline-${fileTimestamp}.json`);
const markdownPath = path.join(outputDirectory, `baseline-${fileTimestamp}.md`);

const commands = [
  {
    id: "tsc",
    label: "tsc baseline",
    checkers: null,
    command: npxCommand,
    args: ["--no-install", "tsc", "-p", "."]
  },
  ...checkerValues.map((checkers) => ({
    id: `tsgo-checkers-${checkers}`,
    label: "tsgo",
    checkers,
    command: npxCommand,
    args: [
      "--no-install",
      "tsgo",
      "-p",
      ".",
      "--checkers",
      String(checkers)
    ]
  }))
];

const environment = collectEnvironment();
const results = [];

for (const benchmarkCommand of commands) {
  console.error(`\n[benchmark] ${formatCommand(benchmarkCommand)}`);

  for (let iteration = 1; iteration <= warmupIterations; iteration += 1) {
    console.error(`  warmup ${iteration}/${warmupIterations}`);
    results.push(
      runBenchmark(benchmarkCommand, {
        phase: "warmup",
        iteration
      })
    );
  }

  for (let iteration = 1; iteration <= measuredIterations; iteration += 1) {
    console.error(`  measured ${iteration}/${measuredIterations}`);
    results.push(
      runBenchmark(benchmarkCommand, {
        phase: "measured",
        iteration
      })
    );
  }
}

const summaries = commands.map((benchmarkCommand) =>
  summarizeCommand(benchmarkCommand, results)
);
const parity = buildParitySummary(summaries);
const report = {
  schemaVersion: 1,
  generatedAt: timestamp,
  repositoryRoot,
  projectDirectory,
  configuration: {
    warmupIterations,
    measuredIterations,
    checkerValues
  },
  environment,
  commands: commands.map(({ command, args, ...rest }) => ({
    ...rest,
    command: [command, ...args]
  })),
  results,
  summaries,
  parity
};

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(report), "utf8");

console.log(markdownPath);
console.error(`\nJSON: ${jsonPath}`);
console.error(`Markdown: ${markdownPath}`);

if (summaries.some((summary) => summary.failedRuns > 0)) {
  process.exitCode = 1;
}

function runBenchmark(benchmarkCommand, { phase, iteration }) {
  const startedAt = new Date().toISOString();
  const peakRssFile = path.join(
    os.tmpdir(),
    `tsgo-benchmark-rss-${process.pid}-${benchmarkCommand.id}-${phase}-${iteration}.txt`
  );
  const canMeasurePeakRss =
    process.platform === "linux" && existsSync("/usr/bin/time");

  const childCommand = canMeasurePeakRss ? "/usr/bin/time" : benchmarkCommand.command;
  const childArgs = canMeasurePeakRss
    ? [
        "-f",
        "%M",
        "-o",
        peakRssFile,
        benchmarkCommand.command,
        ...benchmarkCommand.args
      ]
    : benchmarkCommand.args;

  const started = performance.now();
  const child = spawnSync(childCommand, childArgs, {
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
  const elapsedMs = performance.now() - started;

  let peakRssKb = null;
  if (canMeasurePeakRss && existsSync(peakRssFile)) {
    const rawPeakRss = readFileSync(peakRssFile, "utf8").trim();
    const parsedPeakRss = Number(rawPeakRss);
    peakRssKb = Number.isFinite(parsedPeakRss) ? parsedPeakRss : null;
    rmSync(peakRssFile, { force: true });
  }

  const stdout = normalizeOutput(child.stdout ?? "");
  const stderr = normalizeOutput(child.stderr ?? "");
  const diagnosticText = `${stdout}\n--- stderr ---\n${stderr}`;

  return {
    commandId: benchmarkCommand.id,
    label: benchmarkCommand.label,
    checkers: benchmarkCommand.checkers,
    phase,
    iteration,
    startedAt,
    elapsedMs: round(elapsedMs, 3),
    peakRssKb,
    status: child.status,
    signal: child.signal,
    error: child.error?.message ?? null,
    stdout,
    stderr,
    stdoutHash: sha256(stdout),
    stderrHash: sha256(stderr),
    diagnosticHash: sha256(diagnosticText)
  };
}

function summarizeCommand(benchmarkCommand, allResults) {
  const measured = allResults.filter(
    (result) =>
      result.commandId === benchmarkCommand.id && result.phase === "measured"
  );
  const elapsedValues = measured.map((result) => result.elapsedMs);
  const peakRssValues = measured
    .map((result) => result.peakRssKb)
    .filter((value) => Number.isFinite(value));
  const statuses = [...new Set(measured.map((result) => result.status))];
  const diagnosticHashes = [
    ...new Set(measured.map((result) => result.diagnosticHash))
  ];

  return {
    commandId: benchmarkCommand.id,
    label: benchmarkCommand.label,
    checkers: benchmarkCommand.checkers,
    samples: measured.length,
    failedRuns: measured.filter((result) => result.status !== 0).length,
    statuses,
    diagnosticHashes,
    deterministicDiagnostics: diagnosticHashes.length === 1,
    elapsedMs: summarizeNumbers(elapsedValues),
    peakRssKb:
      peakRssValues.length === measured.length
        ? summarizeNumbers(peakRssValues)
        : null
  };
}

function buildParitySummary(summaries) {
  const baseline = summaries.find((summary) => summary.commandId === "tsc");
  if (!baseline) {
    return [];
  }

  return summaries
    .filter((summary) => summary.commandId !== baseline.commandId)
    .map((summary) => ({
      baselineCommandId: baseline.commandId,
      candidateCommandId: summary.commandId,
      statusParity:
        JSON.stringify(baseline.statuses) === JSON.stringify(summary.statuses),
      diagnosticHashParity:
        baseline.diagnosticHashes.length === 1 &&
        summary.diagnosticHashes.length === 1 &&
        baseline.diagnosticHashes[0] === summary.diagnosticHashes[0],
      medianSpeedup:
        summary.elapsedMs.median > 0
          ? round(baseline.elapsedMs.median / summary.elapsedMs.median, 3)
          : null
    }));
}

function collectEnvironment() {
  const cpuModels = [...new Set(os.cpus().map((cpu) => cpu.model.trim()))];

  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    hostname: os.hostname(),
    logicalCpuCount: os.cpus().length,
    cpuModels,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    versions: {
      tsc: readVersion(npxCommand, ["--no-install", "tsc", "--version"]),
      tsgo: readVersion(npxCommand, ["--no-install", "tsgo", "--version"]),
      go: readVersion("go", ["version"]),
      rustc: readVersion("rustc", ["--version"]),
      cargo: readVersion("cargo", ["--version"])
    }
  };
}

function readVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    }
  });

  if (result.error) {
    return {
      available: false,
      status: result.status,
      value: null,
      error: result.error.message
    };
  }

  const value = normalizeOutput(
    [result.stdout, result.stderr].filter(Boolean).join("\n")
  );

  return {
    available: result.status === 0,
    status: result.status,
    value: value || null,
    error: null
  };
}

function summarizeNumbers(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    sorted.length;
  const standardDeviation = Math.sqrt(variance);

  return {
    min: round(sorted[0], 3),
    max: round(sorted.at(-1), 3),
    mean: round(mean, 3),
    median: round(percentile(sorted, 0.5), 3),
    p95: round(percentile(sorted, 0.95), 3),
    standardDeviation: round(standardDeviation, 3),
    coefficientOfVariationPercent:
      mean === 0 ? 0 : round((standardDeviation / mean) * 100, 3)
  };
}

function percentile(sortedValues, probability) {
  const index = Math.max(
    0,
    Math.min(sortedValues.length - 1, Math.ceil(probability * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

function renderMarkdown(report) {
  const lines = [
    "# TypeScript Go statistical performance baseline",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Project: \`${relativeToRepository(report.projectDirectory)}\``,
    "",
    `Warm-up iterations: ${report.configuration.warmupIterations}`,
    "",
    `Measured iterations: ${report.configuration.measuredIterations}`,
    "",
    "## Environment",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Platform | \`${escapeCell(report.environment.platform)} ${escapeCell(report.environment.release)} (${escapeCell(report.environment.architecture)})\` |`,
    `| Logical CPUs | ${report.environment.logicalCpuCount} |`,
    `| CPU | ${escapeCell(report.environment.cpuModels.join(", "))} |`,
    `| Node | \`${escapeCell(report.environment.node)}\` |`,
    `| TypeScript | ${formatVersion(report.environment.versions.tsc)} |`,
    `| TypeScript Go | ${formatVersion(report.environment.versions.tsgo)} |`,
    `| Go | ${formatVersion(report.environment.versions.go)} |`,
    `| Rust | ${formatVersion(report.environment.versions.rustc)} |`,
    "",
    "## Timing summary",
    "",
    "| Command | Checkers | Samples | Failed | Median ms | p95 ms | Min ms | Max ms | CV % | Peak RSS median KiB | Stable diagnostics |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const summary of report.summaries) {
    lines.push(
      `| ${escapeCell(summary.label)} | ${summary.checkers ?? "n/a"} | ${summary.samples} | ${summary.failedRuns} | ${summary.elapsedMs.median} | ${summary.elapsedMs.p95} | ${summary.elapsedMs.min} | ${summary.elapsedMs.max} | ${summary.elapsedMs.coefficientOfVariationPercent} | ${summary.peakRssKb?.median ?? "n/a"} | ${summary.deterministicDiagnostics ? "yes" : "no"} |`
    );
  }

  lines.push(
    "",
    "## Parity and relative speed",
    "",
    "| Candidate | Exit-status parity | Diagnostic-hash parity | Median speedup vs tsc |",
    "|---|---:|---:|---:|"
  );

  for (const comparison of report.parity) {
    lines.push(
      `| \`${escapeCell(comparison.candidateCommandId)}\` | ${comparison.statusParity ? "yes" : "no"} | ${comparison.diagnosticHashParity ? "yes" : "no"} | ${comparison.medianSpeedup ?? "n/a"}x |`
    );
  }

  lines.push(
    "",
    "## Interpretation rules",
    "",
    "- Warm-up iterations are excluded from the statistical summary.",
    "- Peak RSS is reported on Linux when `/usr/bin/time` is available.",
    "- Diagnostic hashes are based on normalized stdout and stderr.",
    "- A single machine report is evidence for that environment, not a universal language comparison.",
    "- Select a Rust prototype target only after profiler data identifies an isolated hot path.",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function normalizeOutput(value) {
  return String(value)
    .replaceAll("\r\n", "\n")
    .replaceAll(repositoryRoot, "<REPOSITORY_ROOT>")
    .replaceAll(projectDirectory, "<PROJECT_ROOT>")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatCommand({ command, args }) {
  return [command, ...args].join(" ");
}

function formatVersion(version) {
  if (!version.available) {
    return "unavailable";
  }
  return `\`${escapeCell(version.value)}\``;
}

function relativeToRepository(value) {
  const relative = path.relative(repositoryRoot, value);
  return relative || ".";
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function parsePositiveInteger(rawValue, fallback, name) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInteger(rawValue, fallback, name) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function parseCheckerValues(rawValue) {
  const values = rawValue
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (values.length === 0) {
    throw new Error("BENCH_CHECKERS must contain at least one positive integer");
  }

  return [...new Set(values)];
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
