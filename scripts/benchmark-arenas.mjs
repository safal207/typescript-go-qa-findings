import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(".");
const traceDirectory = path.resolve(
  process.env.ARENA_TRACE_DIR ?? "benchmarks/arena/traces"
);
const outputDirectory = path.resolve(
  process.env.ARENA_OUTPUT_DIR ?? "results/arena"
);
const buildDirectory = path.resolve(
  process.env.ARENA_BUILD_DIR ?? ".bench-arena/bin"
);
const warmups = parseNonNegativeInteger(
  process.env.ARENA_WARMUPS,
  2,
  "ARENA_WARMUPS"
);
const iterations = parsePositiveInteger(
  process.env.ARENA_ITERATIONS,
  7,
  "ARENA_ITERATIONS"
);
const timestamp = new Date().toISOString();
const fileTimestamp = timestamp.replaceAll(":", "-").replaceAll(".", "-");
const goBinary = path.resolve(
  process.env.ARENA_GO_BINARY ?? path.join(buildDirectory, "go-arena")
);
const goChunkedBinary = path.resolve(
  process.env.ARENA_GO_CHUNKED_BINARY ?? path.join(buildDirectory, "go-chunked-arena")
);
const rustBinary = path.resolve(
  process.env.ARENA_RUST_BINARY ?? path.join(buildDirectory, "rust-arena")
);

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(buildDirectory, { recursive: true });

runChecked(process.execPath, ["scripts/generate-arena-traces.mjs"], {
  ARENA_TRACE_DIR: traceDirectory
});

if (!process.env.ARENA_GO_BINARY) {
  runChecked(
    "go",
    ["build", "-trimpath", "-ldflags=-s -w", "-o", goBinary, "."],
    {},
    path.join(repositoryRoot, "benchmarks/arena/go")
  );
}

if (!process.env.ARENA_GO_CHUNKED_BINARY) {
  runChecked(
    "go",
    ["build", "-trimpath", "-ldflags=-s -w", "-o", goChunkedBinary, "."],
    {},
    path.join(repositoryRoot, "benchmarks/arena/go-chunked")
  );
}

if (!process.env.ARENA_RUST_BINARY) {
  runChecked("rustc", [
    "--edition=2021",
    "-C",
    "opt-level=3",
    "-C",
    "lto=fat",
    "-C",
    "codegen-units=1",
    "-C",
    "panic=abort",
    "-o",
    rustBinary,
    path.join(repositoryRoot, "benchmarks/arena/rust/main.rs")
  ]);
}

const manifest = JSON.parse(
  readFileSync(path.join(traceDirectory, "manifest.json"), "utf8")
);
const implementations = [
  { id: "go-current", binary: goBinary },
  { id: "go-chunked", binary: goChunkedBinary },
  { id: "rust-chunked", binary: rustBinary }
];
const rawReports = [];

for (const trace of manifest.traces) {
  const tracePath = path.resolve(trace.path);
  for (const implementation of implementations) {
    console.error(`[arena] ${trace.id} / ${implementation.id}`);
    const execution = runMeasuredProcess(implementation.binary, [
      "--trace",
      tracePath,
      "--warmups",
      String(warmups),
      "--iterations",
      String(iterations)
    ]);
    let report;
    try {
      report = JSON.parse(execution.stdout.trim());
    } catch (error) {
      throw new Error(
        `Invalid JSON from ${implementation.id} on ${trace.id}: ${error.message}\n${execution.stdout}\n${execution.stderr}`
      );
    }
    if (!Array.isArray(report.samples) || report.samples.length !== iterations) {
      throw new Error(
        `${implementation.id}/${trace.id} returned ${report.samples?.length ?? "no"} samples; expected ${iterations}`
      );
    }
    rawReports.push({
      trace,
      implementation: implementation.id,
      peakRssKb: execution.peakRssKb,
      stderr: execution.stderr.trim(),
      report
    });
  }
}

const result = buildResult({
  generatedAt: timestamp,
  manifest,
  rawReports,
  environment: collectEnvironment(),
  warmups,
  iterations
});

const jsonPath = path.join(outputDirectory, `arena-comparison-${fileTimestamp}.json`);
const markdownPath = path.join(outputDirectory, `arena-comparison-${fileTimestamp}.md`);
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(result), "utf8");
writeFileSync(
  path.join(outputDirectory, "latest.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);
writeFileSync(path.join(outputDirectory, "latest.md"), renderMarkdown(result), "utf8");

console.log(markdownPath);

if (!result.parityPassed) {
  process.exitCode = 1;
}

function buildResult({ generatedAt, manifest, rawReports, environment, warmups, iterations }) {
  const rows = rawReports.map((entry) => ({
    traceId: entry.trace.id,
    implementation: entry.report.implementation,
    toolchain: entry.report.toolchain,
    checksum: entry.report.checksum,
    operations: entry.report.operations,
    peakRssKb: entry.peakRssKb,
    elapsedNs: summarize(entry.report.samples.map((sample) => sample.elapsedNs)),
    allocatedBytes: summarize(
      entry.report.samples.map((sample) => sample.allocatedBytes)
    ),
    allocations: summarize(
      entry.report.samples.map((sample) => sample.allocations)
    )
  }));
  const comparisons = [];

  for (const trace of manifest.traces) {
    const current = findRow(rows, trace.id, "go-current-typed-arena");
    const goChunked = findRow(rows, trace.id, "go-chunked-arena");
    const rustChunked = findRow(rows, trace.id, "rust-chunked-arena");
    const parity = [goChunked, rustChunked].every(
      (candidate) =>
        candidate.checksum === current.checksum &&
        candidate.operations === current.operations
    );
    const architecture = comparePair(current, goChunked);
    const total = comparePair(current, rustChunked);
    const languageRuntime = comparePair(goChunked, rustChunked);
    const rustLanguageSignal =
      parity &&
      (languageRuntime.timeImprovementPercent >= 20 ||
        (languageRuntime.peakRssImprovementPercent !== null &&
          languageRuntime.peakRssImprovementPercent >= 25));

    comparisons.push({
      traceId: trace.id,
      parity,
      checksum: current.checksum,
      operations: current.operations,
      architecture,
      total,
      languageRuntime,
      rustLanguageSignal
    });
  }

  const parityPassed = comparisons.every((comparison) => comparison.parity);
  const rustLanguageSignalCount = comparisons.filter(
    (comparison) => comparison.rustLanguageSignal
  ).length;

  return {
    schemaVersion: 2,
    generatedAt,
    configuration: { warmups, iterations, traceScale: manifest.scale },
    environment,
    manifest,
    rows,
    comparisons,
    parityPassed,
    rustLanguageSignalCount,
    rustLanguageMultiTraceSignal:
      parityPassed && rustLanguageSignalCount >= 2,
    decisionNote:
      parityPassed && rustLanguageSignalCount >= 2
        ? "Rust retains a standalone advantage over a Go implementation using the same chunked strategy on at least two traces. A profile-based end-to-end upper-bound estimate and subsystem-boundary design are still required before integration work."
        : "After controlling for chunking strategy, Rust does not clear the standalone gate on two traces. Prefer a Go-side arena redesign over compiler integration or FFI."
  };
}

function findRow(rows, traceId, implementation) {
  const row = rows.find(
    (candidate) =>
      candidate.traceId === traceId &&
      candidate.implementation === implementation
  );
  if (!row) {
    throw new Error(`Missing ${implementation} result for ${traceId}`);
  }
  return row;
}

function comparePair(baseline, candidate) {
  const peakRssImprovementPercent =
    Number.isFinite(baseline.peakRssKb) && Number.isFinite(candidate.peakRssKb)
      ? improvementPercent(baseline.peakRssKb, candidate.peakRssKb)
      : null;
  return {
    baseline: baseline.implementation,
    candidate: candidate.implementation,
    baselineMedianMs: round(baseline.elapsedNs.median / 1_000_000, 3),
    candidateMedianMs: round(candidate.elapsedNs.median / 1_000_000, 3),
    speedup: round(baseline.elapsedNs.median / candidate.elapsedNs.median, 3),
    timeImprovementPercent: improvementPercent(
      baseline.elapsedNs.median,
      candidate.elapsedNs.median
    ),
    baselineAllocatedBytesMedian: baseline.allocatedBytes.median,
    candidateAllocatedBytesMedian: candidate.allocatedBytes.median,
    allocatedBytesImprovementPercent: improvementPercent(
      baseline.allocatedBytes.median,
      candidate.allocatedBytes.median
    ),
    baselineAllocationsMedian: baseline.allocations.median,
    candidateAllocationsMedian: candidate.allocations.median,
    allocationCallImprovementPercent: improvementPercent(
      baseline.allocations.median,
      candidate.allocations.median
    ),
    baselinePeakRssKb: baseline.peakRssKb,
    candidatePeakRssKb: candidate.peakRssKb,
    peakRssImprovementPercent
  };
}

function runMeasuredProcess(binary, args) {
  const rssFile = path.join(
    os.tmpdir(),
    `arena-rss-${process.pid}-${path.basename(binary)}-${Date.now()}.txt`
  );
  const canMeasureRss = process.platform === "linux" && existsSync("/usr/bin/time");
  const command = canMeasureRss ? "/usr/bin/time" : binary;
  const commandArgs = canMeasureRss
    ? ["-f", "%M", "-o", rssFile, binary, ...args]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0"
    },
    maxBuffer: 64 * 1024 * 1024
  });
  let peakRssKb = null;
  if (canMeasureRss && existsSync(rssFile)) {
    const value = Number(readFileSync(rssFile, "utf8").trim());
    peakRssKb = Number.isFinite(value) ? value : null;
    rmSync(rssFile, { force: true });
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${binary} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    peakRssKb
  };
}

function collectEnvironment() {
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    logicalCpuCount: os.cpus().length,
    cpuModels: [...new Set(os.cpus().map((cpu) => cpu.model.trim()))],
    node: process.version,
    go: versionOf("go", ["version"]),
    rustc: versionOf("rustc", ["--version"])
  };
}

function versionOf(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  return result.status === 0
    ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
    : "unavailable";
}

function summarize(values) {
  if (values.length === 0) {
    throw new Error("Cannot summarize an empty sample set");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    min: sorted[0],
    max: sorted.at(-1),
    mean: round(mean, 3),
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
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
    return 0;
  }
  return round(((baseline - candidate) / baseline) * 100, 3);
}

function renderMarkdown(result) {
  const lines = [
    "# Current Go arena vs Go chunked vs Rust chunked",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    `Warm-ups: ${result.configuration.warmups}`,
    "",
    `Measured iterations: ${result.configuration.iterations}`,
    "",
    "## Environment",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Platform | \`${escapeCell(result.environment.platform)} ${escapeCell(result.environment.release)} (${escapeCell(result.environment.architecture)})\` |`,
    `| Logical CPUs | ${result.environment.logicalCpuCount} |`,
    `| CPU | ${escapeCell(result.environment.cpuModels.join(", "))} |`,
    `| Node | \`${escapeCell(result.environment.node)}\` |`,
    `| Go | \`${escapeCell(result.environment.go)}\` |`,
    `| Rust | \`${escapeCell(result.environment.rustc)}\` |`,
    "",
    "## Raw implementations",
    "",
    "| Trace | Implementation | Median ms | p95 ms | Allocated bytes | Allocation calls | Peak RSS KiB |",
    "|---|---|---:|---:|---:|---:|---:|"
  ];

  for (const row of result.rows) {
    lines.push(
      `| \`${escapeCell(row.traceId)}\` | \`${escapeCell(row.implementation)}\` | ${round(row.elapsedNs.median / 1_000_000, 3)} | ${round(row.elapsedNs.p95 / 1_000_000, 3)} | ${row.allocatedBytes.median} | ${row.allocations.median} | ${row.peakRssKb ?? "n/a"} |`
    );
  }

  lines.push(
    "",
    "## Controlled comparisons",
    "",
    "| Trace | Parity | Current Go → Go chunked time | Current Go → Rust time | Go chunked → Rust time | Go chunked → Rust alloc calls | Go chunked → Rust RSS | Rust language/runtime gate |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  );

  for (const comparison of result.comparisons) {
    lines.push(
      `| \`${escapeCell(comparison.traceId)}\` | ${comparison.parity ? "yes" : "no"} | ${comparison.architecture.timeImprovementPercent}% | ${comparison.total.timeImprovementPercent}% | ${comparison.languageRuntime.timeImprovementPercent}% | ${comparison.languageRuntime.allocationCallImprovementPercent}% | ${comparison.languageRuntime.peakRssImprovementPercent === null ? "n/a" : `${comparison.languageRuntime.peakRssImprovementPercent}%`} | ${comparison.rustLanguageSignal ? "yes" : "no"} |`
    );
  }

  lines.push(
    "",
    "## Gate",
    "",
    `Parity passed: **${result.parityPassed ? "yes" : "no"}**`,
    "",
    `Rust-over-Go-chunked signals: **${result.rustLanguageSignalCount}/${result.comparisons.length}**`,
    "",
    `Rust language/runtime multi-trace signal: **${result.rustLanguageMultiTraceSignal ? "yes" : "no"}**`,
    "",
    result.decisionNote,
    "",
    "The Rust gate is evaluated against Go chunked, not the original Go arena. This prevents a chunking/data-layout improvement from being incorrectly credited to the programming language. A signal requires parity plus at least 20% median-time improvement or 25% peak-RSS improvement.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

function runChecked(command, args, environmentOverrides = {}, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environmentOverrides
    },
    maxBuffer: 64 * 1024 * 1024
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
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
  }
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
