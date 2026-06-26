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
  { id: "go", binary: goBinary },
  { id: "rust", binary: rustBinary }
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
    const go = rows.find(
      (row) => row.traceId === trace.id && row.implementation === "go-current-typed-arena"
    );
    const rust = rows.find(
      (row) => row.traceId === trace.id && row.implementation === "rust-chunked-arena"
    );
    if (!go || !rust) {
      throw new Error(`Missing Go or Rust result for ${trace.id}`);
    }
    const parity = go.checksum === rust.checksum && go.operations === rust.operations;
    const timeImprovementPercent = improvementPercent(
      go.elapsedNs.median,
      rust.elapsedNs.median
    );
    const allocatedBytesImprovementPercent = improvementPercent(
      go.allocatedBytes.median,
      rust.allocatedBytes.median
    );
    const peakRssImprovementPercent =
      Number.isFinite(go.peakRssKb) && Number.isFinite(rust.peakRssKb)
        ? improvementPercent(go.peakRssKb, rust.peakRssKb)
        : null;
    comparisons.push({
      traceId: trace.id,
      parity,
      checksum: go.checksum,
      operations: go.operations,
      goMedianMs: round(go.elapsedNs.median / 1_000_000, 3),
      rustMedianMs: round(rust.elapsedNs.median / 1_000_000, 3),
      speedup: round(go.elapsedNs.median / rust.elapsedNs.median, 3),
      timeImprovementPercent,
      goAllocatedBytesMedian: go.allocatedBytes.median,
      rustAllocatedBytesMedian: rust.allocatedBytes.median,
      allocatedBytesImprovementPercent,
      goAllocationsMedian: go.allocations.median,
      rustAllocationsMedian: rust.allocations.median,
      goPeakRssKb: go.peakRssKb,
      rustPeakRssKb: rust.peakRssKb,
      peakRssImprovementPercent,
      standaloneSignal:
        parity &&
        (timeImprovementPercent >= 20 ||
          (peakRssImprovementPercent !== null && peakRssImprovementPercent >= 25))
    });
  }

  const parityPassed = comparisons.every((comparison) => comparison.parity);
  const signalCount = comparisons.filter(
    (comparison) => comparison.standaloneSignal
  ).length;

  return {
    schemaVersion: 1,
    generatedAt,
    configuration: { warmups, iterations, traceScale: manifest.scale },
    environment,
    manifest,
    rows,
    comparisons,
    parityPassed,
    signalCount,
    multiTraceSignal: parityPassed && signalCount >= 2,
    decisionNote:
      parityPassed && signalCount >= 2
        ? "Standalone signal detected on at least two traces. A second environment and profile-based end-to-end upper-bound estimate are still required before any integration work."
        : "The standalone gate is not met across two traces. Do not investigate compiler integration or FFI from this run."
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
    "# Go typed arena vs Rust chunked arena",
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
    "## Comparison",
    "",
    "| Trace | Parity | Go median ms | Rust median ms | Speedup | Time improvement | Go allocated bytes | Rust allocated bytes | Allocated-byte improvement | Go peak RSS KiB | Rust peak RSS KiB | RSS improvement | Gate signal |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const comparison of result.comparisons) {
    lines.push(
      `| \`${escapeCell(comparison.traceId)}\` | ${comparison.parity ? "yes" : "no"} | ${comparison.goMedianMs} | ${comparison.rustMedianMs} | ${comparison.speedup}x | ${comparison.timeImprovementPercent}% | ${comparison.goAllocatedBytesMedian} | ${comparison.rustAllocatedBytesMedian} | ${comparison.allocatedBytesImprovementPercent}% | ${comparison.goPeakRssKb ?? "n/a"} | ${comparison.rustPeakRssKb ?? "n/a"} | ${comparison.peakRssImprovementPercent === null ? "n/a" : `${comparison.peakRssImprovementPercent}%`} | ${comparison.standaloneSignal ? "yes" : "no"} |`
    );
  }

  lines.push(
    "",
    "## Gate",
    "",
    `Parity passed: **${result.parityPassed ? "yes" : "no"}**`,
    "",
    `Trace signals: **${result.signalCount}/${result.comparisons.length}**`,
    "",
    `Multi-trace standalone signal: **${result.multiTraceSignal ? "yes" : "no"}**`,
    "",
    result.decisionNote,
    "",
    "A signal is recorded only when parity passes and Rust improves median time by at least 20% or process peak RSS by at least 25%. This report is an upper-bound experiment; it does not include compiler integration or FFI costs.",
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
