import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(".");
const workRoot = path.resolve(process.env.GC_BENCH_WORK_ROOT ?? ".bench-gc");
const manifestPath = path.resolve(
  process.env.GC_BENCH_MANIFEST ?? path.join(workRoot, "manifest.json")
);
const outputRoot = path.resolve(
  process.env.GC_BENCH_OUTPUT_DIR ?? "results/gc-policy"
);
const warmups = parseNonNegativeInteger(
  process.env.GC_BENCH_WARMUPS,
  1,
  "GC_BENCH_WARMUPS"
);
const iterations = parsePositiveInteger(
  process.env.GC_BENCH_ITERATIONS,
  5,
  "GC_BENCH_ITERATIONS"
);
const captureEvidence = process.env.GC_BENCH_CAPTURE_EVIDENCE !== "0";
const timestamp = new Date().toISOString();
const fileTimestamp = timestamp.replaceAll(":", "-").replaceAll(".", "-");
const runDirectory = path.join(outputRoot, fileTimestamp);

if (!existsSync(manifestPath)) {
  throw new Error(`Preparation manifest does not exist: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const binaryPath = path.resolve(manifest.binaryPath);
const targetDirectory = path.resolve(manifest.target.directory);
const compilerArgs = manifest.target.compilerArgs;

if (!existsSync(binaryPath)) {
  throw new Error(`Instrumented tsgo binary does not exist: ${binaryPath}`);
}
if (!existsSync(targetDirectory)) {
  throw new Error(`Target directory does not exist: ${targetDirectory}`);
}

const modes = [
  {
    id: "default",
    description: "Runtime default GC policy.",
    environment: {}
  },
  {
    id: "gogc-500",
    description: "Process-start GC target percentage of 500.",
    environment: { GOGC: "500" }
  },
  {
    id: "gogc-1000",
    description: "Process-start GC target percentage of 1000.",
    environment: { GOGC: "1000" }
  },
  {
    id: "gogc-off",
    description: "GC disabled from process startup through GOGC=off.",
    environment: { GOGC: "off" }
  },
  {
    id: "dynamic-off",
    description: "GC disabled only after tsgo selects command-line mode.",
    environment: { TSGO_BENCH_GC_PERCENT: "-1" }
  }
];

mkdirSync(runDirectory, { recursive: true });
const samples = [];
const evidence = [];

for (const mode of modes) {
  const modeDirectory = path.join(runDirectory, mode.id);
  mkdirSync(modeDirectory, { recursive: true });
  console.error(`\n[gc-policy] ${mode.id}`);

  for (let iteration = 1; iteration <= warmups; iteration += 1) {
    console.error(`  warmup ${iteration}/${warmups}`);
    const result = executeCompiler({
      mode,
      phase: "warmup",
      iteration,
      outputDirectory: modeDirectory,
      captureTrace: false,
      captureProfiles: false,
      enableGCTrace: false
    });
    samples.push(result);
  }

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    console.error(`  measured ${iteration}/${iterations}`);
    const result = executeCompiler({
      mode,
      phase: "measured",
      iteration,
      outputDirectory: modeDirectory,
      captureTrace: false,
      captureProfiles: false,
      enableGCTrace: false
    });
    samples.push(result);
  }

  if (captureEvidence) {
    console.error("  evidence run");
    evidence.push(
      executeCompiler({
        mode,
        phase: "evidence",
        iteration: 1,
        outputDirectory: modeDirectory,
        captureTrace: true,
        captureProfiles: true,
        enableGCTrace: true
      })
    );
  }
}

const summaries = modes.map((mode) => summarizeMode(mode, samples));
const comparisons = compareToDefault(summaries);
const parityPassed = summaries.every(
  (summary) =>
    summary.deterministicStatus &&
    summary.deterministicDiagnostics &&
    summary.statusParityWithDefault &&
    summary.diagnosticParityWithDefault
);
const fastestValid = comparisons
  .filter((comparison) => comparison.parity)
  .sort((left, right) => right.timeImprovementPercent - left.timeImprovementPercent)[0];

const report = {
  schemaVersion: 1,
  generatedAt: timestamp,
  configuration: {
    warmups,
    iterations,
    captureEvidence,
    modes: modes.map(({ id, description, environment }) => ({
      id,
      description,
      environment
    }))
  },
  environment: collectEnvironment(),
  preparation: manifest,
  command: [binaryPath, ...compilerArgs],
  samples,
  evidence,
  summaries,
  comparisons,
  parityPassed,
  fastestValidMode: fastestValid?.modeId ?? null,
  fastestValidImprovementPercent: fastestValid?.timeImprovementPercent ?? null,
  singleProjectSignal:
    Boolean(fastestValid) &&
    parityPassed &&
    fastestValid.timeImprovementPercent >= 5,
  interpretation:
    Boolean(fastestValid) && parityPassed && fastestValid.timeImprovementPercent >= 5
      ? "This target shows a parity-preserving single-project signal. It must reproduce on another real project and operating system before recommending a CLI GC policy."
      : "No parity-preserving 5% single-project signal was established in this run."
};

const jsonPath = path.join(runDirectory, "gc-policy-report.json");
const markdownPath = path.join(runDirectory, "gc-policy-report.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(report), "utf8");
writeFileSync(
  path.join(outputRoot, "latest.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
writeFileSync(path.join(outputRoot, "latest.md"), renderMarkdown(report), "utf8");

console.log(markdownPath);

if (!parityPassed) {
  process.exitCode = 1;
}

function executeCompiler({
  mode,
  phase,
  iteration,
  outputDirectory,
  captureTrace,
  captureProfiles,
  enableGCTrace
}) {
  const runId = `${phase}-${String(iteration).padStart(2, "0")}`;
  const runtimeStatsPath = path.join(outputDirectory, `${runId}-runtime.json`);
  const runtimeTracePath = captureTrace
    ? path.join(outputDirectory, `${runId}-runtime.trace`)
    : null;
  const profileDirectory = captureProfiles
    ? path.join(outputDirectory, `${runId}-pprof`)
    : null;
  if (profileDirectory) {
    mkdirSync(profileDirectory, { recursive: true });
  }

  const environment = benchmarkEnvironment(mode.environment, {
    TSGO_BENCH_RUNTIME_STATS: runtimeStatsPath,
    ...(runtimeTracePath
      ? { TSGO_BENCH_RUNTIME_TRACE: runtimeTracePath }
      : {}),
    ...(enableGCTrace ? { GODEBUG: mergeGoDebug("gctrace=1") } : {})
  });
  const args = [
    ...compilerArgs,
    ...(profileDirectory ? ["--pprofDir", profileDirectory] : [])
  ];
  const rssPath = path.join(
    os.tmpdir(),
    `tsgo-gc-rss-${process.pid}-${mode.id}-${phase}-${iteration}.txt`
  );
  const canMeasureRss = process.platform === "linux" && existsSync("/usr/bin/time");
  const command = canMeasureRss ? "/usr/bin/time" : binaryPath;
  const commandArgs = canMeasureRss
    ? ["-f", "%M", "-o", rssPath, binaryPath, ...args]
    : args;

  const started = performance.now();
  const child = spawnSync(command, commandArgs, {
    cwd: targetDirectory,
    encoding: "utf8",
    env: environment,
    maxBuffer: 128 * 1024 * 1024
  });
  const elapsedMs = performance.now() - started;

  let peakRssKb = null;
  if (canMeasureRss && existsSync(rssPath)) {
    const parsed = Number(readFileSync(rssPath, "utf8").trim());
    peakRssKb = Number.isFinite(parsed) ? parsed : null;
    rmSync(rssPath, { force: true });
  }

  if (child.error) {
    throw child.error;
  }
  if (!existsSync(runtimeStatsPath)) {
    throw new Error(
      `${mode.id}/${runId} did not create runtime stats (status ${child.status})\n${child.stderr}`
    );
  }

  const stdout = normalizeOutput(child.stdout ?? "");
  const stderr = normalizeOutput(child.stderr ?? "");
  const runtimeStats = JSON.parse(readFileSync(runtimeStatsPath, "utf8"));
  const gcTraceLines = enableGCTrace ? extractGCTraceLines(stderr) : [];

  if (phase === "evidence") {
    writeFileSync(path.join(outputDirectory, `${runId}-stdout.txt`), `${stdout}\n`, "utf8");
    writeFileSync(path.join(outputDirectory, `${runId}-stderr.txt`), `${stderr}\n`, "utf8");
    writeFileSync(
      path.join(outputDirectory, `${runId}-gctrace.txt`),
      `${gcTraceLines.join("\n")}\n`,
      "utf8"
    );
  }

  const diagnosticText = removeGCTraceLines(`${stdout}\n--- stderr ---\n${stderr}`);

  return {
    modeId: mode.id,
    phase,
    iteration,
    elapsedMs: round(elapsedMs, 3),
    peakRssKb,
    status: child.status,
    signal: child.signal,
    stdoutHash: sha256(stdout),
    stderrHash: sha256(removeGCTraceLines(stderr)),
    diagnosticHash: sha256(diagnosticText),
    runtimeStats,
    gcTrace: {
      enabled: enableGCTrace,
      cycleLines: gcTraceLines.length,
      lines: gcTraceLines
    },
    artifacts: {
      runtimeStatsPath: relativeToRepository(runtimeStatsPath),
      runtimeTracePath: runtimeTracePath
        ? relativeToRepository(runtimeTracePath)
        : null,
      profileDirectory: profileDirectory
        ? relativeToRepository(profileDirectory)
        : null
    }
  };
}

function summarizeMode(mode, allSamples) {
  const measured = allSamples.filter(
    (sample) => sample.modeId === mode.id && sample.phase === "measured"
  );
  const statuses = [...new Set(measured.map((sample) => sample.status))];
  const diagnosticHashes = [
    ...new Set(measured.map((sample) => sample.diagnosticHash))
  ];
  const rssValues = measured
    .map((sample) => sample.peakRssKb)
    .filter((value) => Number.isFinite(value));
  const runtime = measured.map((sample) => sample.runtimeStats);

  return {
    modeId: mode.id,
    description: mode.description,
    samples: measured.length,
    statuses,
    diagnosticHashes,
    deterministicStatus: statuses.length === 1,
    deterministicDiagnostics: diagnosticHashes.length === 1,
    elapsedMs: summarizeNumbers(measured.map((sample) => sample.elapsedMs)),
    peakRssKb:
      rssValues.length === measured.length ? summarizeNumbers(rssValues) : null,
    runtime: {
      numGC: summarizeNumbers(runtime.map((report) => report.delta.numGC)),
      pauseTotalNs: summarizeNumbers(
        runtime.map((report) => report.delta.pauseTotalNs)
      ),
      totalAlloc: summarizeNumbers(
        runtime.map((report) => report.delta.totalAlloc)
      ),
      mallocs: summarizeNumbers(runtime.map((report) => report.delta.mallocs)),
      heapAllocAfter: summarizeNumbers(
        runtime.map((report) => report.after.heapAlloc)
      ),
      heapSysAfter: summarizeNumbers(runtime.map((report) => report.after.heapSys)),
      processSysAfter: summarizeNumbers(runtime.map((report) => report.after.sys)),
      gcCpuFractionAfter: summarizeNumbers(
        runtime.map((report) => report.after.gcCpuFraction)
      )
    },
    statusParityWithDefault: null,
    diagnosticParityWithDefault: null
  };
}

function compareToDefault(summaries) {
  const baseline = summaries.find((summary) => summary.modeId === "default");
  if (!baseline) {
    throw new Error("Default GC summary is missing");
  }

  for (const summary of summaries) {
    summary.statusParityWithDefault =
      summary.statuses.length === 1 &&
      baseline.statuses.length === 1 &&
      summary.statuses[0] === baseline.statuses[0];
    summary.diagnosticParityWithDefault =
      summary.diagnosticHashes.length === 1 &&
      baseline.diagnosticHashes.length === 1 &&
      summary.diagnosticHashes[0] === baseline.diagnosticHashes[0];
  }

  return summaries.map((summary) => {
    const parity =
      summary.deterministicStatus &&
      summary.deterministicDiagnostics &&
      summary.statusParityWithDefault &&
      summary.diagnosticParityWithDefault;
    return {
      modeId: summary.modeId,
      parity,
      timeImprovementPercent: improvementPercent(
        baseline.elapsedMs.median,
        summary.elapsedMs.median
      ),
      speedup: round(baseline.elapsedMs.median / summary.elapsedMs.median, 3),
      peakRssImprovementPercent:
        baseline.peakRssKb && summary.peakRssKb
          ? improvementPercent(
              baseline.peakRssKb.median,
              summary.peakRssKb.median
            )
          : null,
      gcCycleReductionPercent: improvementPercent(
        baseline.runtime.numGC.median,
        summary.runtime.numGC.median
      ),
      gcPauseReductionPercent: improvementPercent(
        baseline.runtime.pauseTotalNs.median,
        summary.runtime.pauseTotalNs.median
      )
    };
  });
}

function benchmarkEnvironment(modeEnvironment, extraEnvironment) {
  const environment = { ...process.env };
  for (const key of [
    "GOGC",
    "GOMEMLIMIT",
    "GODEBUG",
    "TSGO_BENCH_GC_PERCENT",
    "TSGO_BENCH_MEMORY_LIMIT",
    "TSGO_BENCH_RUNTIME_STATS",
    "TSGO_BENCH_RUNTIME_TRACE"
  ]) {
    delete environment[key];
  }
  return {
    ...environment,
    CI: environment.CI ?? "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...modeEnvironment,
    ...extraEnvironment
  };
}

function mergeGoDebug(entry) {
  const existing = process.env.GODEBUG
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith("gctrace="));
  return [...(existing ?? []), entry].join(",");
}

function extractGCTraceLines(value) {
  return String(value)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => /^gc \d+ @/.test(line.trim()));
}

function removeGCTraceLines(value) {
  return String(value)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !/^gc \d+ @/.test(line.trim()))
    .join("\n")
    .trim();
}

function collectEnvironment() {
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    hostname: os.hostname(),
    logicalCpuCount: os.cpus().length,
    cpuModels: [...new Set(os.cpus().map((cpu) => cpu.model.trim()))],
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    go: versionOf("go", ["version"]),
    git: versionOf("git", ["--version"])
  };
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

function summarizeNumbers(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
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

function percentile(sorted, probability) {
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)
  );
  return sorted[index];
}

function improvementPercent(baseline, candidate) {
  if (baseline === 0) {
    return candidate === 0 ? 0 : -100;
  }
  return round(((baseline - candidate) / baseline) * 100, 3);
}

function normalizeOutput(value) {
  return String(value)
    .replaceAll("\r\n", "\n")
    .replaceAll(repositoryRoot, "<REPOSITORY_ROOT>")
    .replaceAll(workRoot, "<WORK_ROOT>")
    .replaceAll(targetDirectory, "<TARGET_ROOT>")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeToRepository(value) {
  return path.relative(repositoryRoot, value) || ".";
}

function renderMarkdown(report) {
  const lines = [
    "# TypeScript Go real-project GC policy benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Target: \`${escapeCell(report.preparation.target.id)}\` at \`${escapeCell(report.preparation.target.resolvedCommit)}\``,
    "",
    `TypeScript Go: \`${escapeCell(report.preparation.typescriptGo.resolvedCommit)}\``,
    "",
    `Warm-ups per mode: ${report.configuration.warmups}`,
    "",
    `Measured iterations per mode: ${report.configuration.iterations}`,
    "",
    "## Results",
    "",
    "| Mode | Parity | Median ms | p95 ms | CV % | Time improvement | Speedup | Peak RSS KiB | RSS improvement | Median GC cycles | Median GC pause ms | Median total allocated MiB |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const summary of report.summaries) {
    const comparison = report.comparisons.find(
      (entry) => entry.modeId === summary.modeId
    );
    lines.push(
      `| \`${escapeCell(summary.modeId)}\` | ${comparison.parity ? "yes" : "no"} | ${summary.elapsedMs.median} | ${summary.elapsedMs.p95} | ${summary.elapsedMs.coefficientOfVariationPercent} | ${comparison.timeImprovementPercent}% | ${comparison.speedup}x | ${summary.peakRssKb?.median ?? "n/a"} | ${comparison.peakRssImprovementPercent === null ? "n/a" : `${comparison.peakRssImprovementPercent}%`} | ${summary.runtime.numGC.median} | ${round(summary.runtime.pauseTotalNs.median / 1_000_000, 3)} | ${round(summary.runtime.totalAlloc.median / 1024 / 1024, 3)} |`
    );
  }

  lines.push(
    "",
    "## Decision",
    "",
    `Parity passed: **${report.parityPassed ? "yes" : "no"}**`,
    "",
    `Fastest parity-valid mode: **${report.fastestValidMode ?? "none"}**`,
    "",
    `Improvement versus default: **${report.fastestValidImprovementPercent ?? "n/a"}%**`,
    "",
    `Single-project signal: **${report.singleProjectSignal ? "yes" : "no"}**`,
    "",
    report.interpretation,
    "",
    "## Interpretation limits",
    "",
    "- Timed samples do not enable `gctrace` or runtime tracing; evidence runs are separate.",
    "- A lower GC count is not automatically a win if peak memory grows excessively.",
    "- `runtime.MemStats` allocated space, live heap, process RSS, and CPU critical-path impact are distinct measurements.",
    "- One project is insufficient for an upstream recommendation.",
    "- The dynamic policy starts only after tsgo has selected CLI mode; LSP and API modes are not modified.",
    ""
  );
  return `${lines.join("\n")}\n`;
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

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
