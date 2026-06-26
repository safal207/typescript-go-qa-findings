import {
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
const matrixTimestamp = new Date().toISOString();
const fileTimestamp = matrixTimestamp.replaceAll(":", "-").replaceAll(".", "-");
const outputRoot = path.resolve(
  process.env.BENCH_MATRIX_OUTPUT_DIR ??
    path.join("results/performance", `matrix-${fileTimestamp}`)
);
const selectedWorkloads = parseSelectedWorkloads(
  process.env.BENCH_MATRIX_WORKLOADS
);

runChecked(process.execPath, ["scripts/generate-benchmark-fixtures.mjs"], {
  BENCH_FIXTURE_ROOT: fixtureRoot
});

const manifest = JSON.parse(
  readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8")
);
const workloads = manifest.workloads.filter(
  (workload) =>
    selectedWorkloads.length === 0 || selectedWorkloads.includes(workload.id)
);

if (workloads.length === 0) {
  throw new Error("No workload matched BENCH_MATRIX_WORKLOADS");
}

mkdirSync(outputRoot, { recursive: true });
const reports = [];

for (const workload of workloads) {
  const workloadOutput = path.join(outputRoot, workload.id);
  mkdirSync(workloadOutput, { recursive: true });

  console.error(`\n[matrix] workload=${workload.id}`);
  runChecked(process.execPath, ["scripts/benchmark-baseline.mjs"], {
    BENCH_PROJECT: path.resolve(workload.projectDirectory),
    BENCH_OUTPUT_DIR: workloadOutput
  });

  const jsonFile = readdirSync(workloadOutput)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .at(-1);

  if (!jsonFile) {
    throw new Error(`Baseline JSON was not created for ${workload.id}`);
  }

  reports.push({
    workload,
    report: JSON.parse(readFileSync(path.join(workloadOutput, jsonFile), "utf8"))
  });
}

const matrix = buildMatrixReport({
  generatedAt: matrixTimestamp,
  fixtureManifest: manifest,
  reports
});

const jsonPath = path.join(outputRoot, "matrix-summary.json");
const markdownPath = path.join(outputRoot, "matrix-summary.md");
writeFileSync(jsonPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(matrix), "utf8");

console.log(markdownPath);

function buildMatrixReport({ generatedAt, fixtureManifest, reports }) {
  const rows = [];
  const recommendations = [];

  for (const { workload, report } of reports) {
    const parityByCandidate = new Map(
      report.parity.map((entry) => [entry.candidateCommandId, entry])
    );

    for (const summary of report.summaries) {
      const parity = parityByCandidate.get(summary.commandId) ?? null;
      rows.push({
        workloadId: workload.id,
        workloadDescription: workload.description,
        focus: workload.focus,
        sourceFiles: workload.sourceFiles,
        commandId: summary.commandId,
        label: summary.label,
        checkers: summary.checkers,
        samples: summary.samples,
        failedRuns: summary.failedRuns,
        deterministicDiagnostics: summary.deterministicDiagnostics,
        elapsedMs: summary.elapsedMs,
        peakRssKb: summary.peakRssKb,
        statusParity: parity?.statusParity ?? null,
        diagnosticHashParity: parity?.diagnosticHashParity ?? null,
        medianSpeedup: parity?.medianSpeedup ?? 1
      });
    }

    const candidates = rows.filter(
      (row) =>
        row.workloadId === workload.id &&
        row.commandId !== "tsc" &&
        row.failedRuns === 0 &&
        row.statusParity === true &&
        row.diagnosticHashParity === true
    );
    const fastest = [...candidates].sort(
      (left, right) => left.elapsedMs.median - right.elapsedMs.median
    )[0];
    const lowestMemory = [...candidates]
      .filter((candidate) => candidate.peakRssKb !== null)
      .sort(
        (left, right) =>
          left.peakRssKb.median - right.peakRssKb.median
      )[0];

    recommendations.push({
      workloadId: workload.id,
      fastestCommandId: fastest?.commandId ?? null,
      fastestCheckers: fastest?.checkers ?? null,
      fastestMedianMs: fastest?.elapsedMs.median ?? null,
      fastestSpeedup: fastest?.medianSpeedup ?? null,
      lowestMemoryCommandId: lowestMemory?.commandId ?? null,
      lowestMemoryCheckers: lowestMemory?.checkers ?? null,
      lowestMemoryMedianKb: lowestMemory?.peakRssKb?.median ?? null
    });
  }

  return {
    schemaVersion: 1,
    generatedAt,
    configuration: {
      warmupIterations: reports[0]?.report.configuration.warmupIterations ?? null,
      measuredIterations: reports[0]?.report.configuration.measuredIterations ?? null,
      checkerValues: reports[0]?.report.configuration.checkerValues ?? []
    },
    environment: reports[0]?.report.environment ?? null,
    fixtureManifest,
    rows,
    recommendations
  };
}

function renderMarkdown(matrix) {
  const lines = [
    "# TypeScript Go workload matrix",
    "",
    `Generated: ${matrix.generatedAt}`,
    "",
    `Fixture scale: ${matrix.fixtureManifest.scale}`,
    "",
    `Warm-ups per command: ${matrix.configuration.warmupIterations}`,
    "",
    `Measured iterations per command: ${matrix.configuration.measuredIterations}`,
    "",
    "## Workloads",
    "",
    "| Workload | Source files | Focus |",
    "|---|---:|---|"
  ];

  for (const workload of matrix.fixtureManifest.workloads) {
    lines.push(
      `| \`${escapeCell(workload.id)}\` | ${workload.sourceFiles} | ${escapeCell(workload.focus.join(", "))} |`
    );
  }

  lines.push(
    "",
    "## Results",
    "",
    "| Workload | Compiler | Checkers | Median ms | p95 ms | Peak RSS KiB | Speedup vs tsc | Exit parity | Diagnostic parity |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|"
  );

  for (const row of matrix.rows) {
    lines.push(
      `| \`${escapeCell(row.workloadId)}\` | ${escapeCell(row.label)} | ${row.checkers ?? "n/a"} | ${row.elapsedMs.median} | ${row.elapsedMs.p95} | ${row.peakRssKb?.median ?? "n/a"} | ${row.medianSpeedup}x | ${formatBoolean(row.statusParity)} | ${formatBoolean(row.diagnosticHashParity)} |`
    );
  }

  lines.push(
    "",
    "## Best valid configuration per workload",
    "",
    "| Workload | Fastest checkers | Median ms | Speedup | Lowest-memory checkers | Peak RSS KiB |",
    "|---|---:|---:|---:|---:|---:|"
  );

  for (const recommendation of matrix.recommendations) {
    lines.push(
      `| \`${escapeCell(recommendation.workloadId)}\` | ${recommendation.fastestCheckers ?? "n/a"} | ${recommendation.fastestMedianMs ?? "n/a"} | ${recommendation.fastestSpeedup ?? "n/a"}x | ${recommendation.lowestMemoryCheckers ?? "n/a"} | ${recommendation.lowestMemoryMedianKb ?? "n/a"} |`
    );
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "- Results apply to this machine, package version, workload generator, and fixture scale.",
    "- Only candidates with matching exit status and diagnostic hash are eligible for the best-configuration table.",
    "- The matrix is intended to select a profiling workload, not to prove that one language is universally faster.",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function runChecked(command, args, environmentOverrides = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
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
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status}`
    );
  }
}

function parseSelectedWorkloads(rawValue) {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatBoolean(value) {
  if (value === null) {
    return "n/a";
  }
  return value ? "yes" : "no";
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
