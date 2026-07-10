import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(".");
const inputRoot = path.resolve(
  process.env.GC_BENCH_ARTIFACT_ROOT ?? ".gc-policy-artifacts"
);
const outputRoot = path.resolve(
  process.env.GC_BENCH_AGGREGATE_OUTPUT ?? "results/gc-policy-matrix"
);

if (!existsSync(inputRoot)) {
  throw new Error(`GC policy artifact root does not exist: ${inputRoot}`);
}

const reportPaths = findFiles(
  inputRoot,
  (filePath) =>
    path.basename(filePath) === "latest.json" &&
    path.basename(path.dirname(filePath)) === "gc-policy"
);

if (reportPaths.length === 0) {
  throw new Error(`No results/gc-policy/latest.json reports found under ${inputRoot}`);
}

const rows = reportPaths.map((reportPath) => {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const evidencePath = path.join(
    path.dirname(reportPath),
    "latest-evidence-analysis.json"
  );
  const evidence = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, "utf8"))
    : null;
  const dynamicSummary = report.summaries.find(
    (summary) => summary.modeId === "dynamic-off"
  );
  const dynamicComparison = report.comparisons.find(
    (comparison) => comparison.modeId === "dynamic-off"
  );
  const defaultSummary = report.summaries.find(
    (summary) => summary.modeId === "default"
  );

  if (!dynamicSummary || !dynamicComparison || !defaultSummary) {
    throw new Error(`Incomplete default/dynamic-off data in ${reportPath}`);
  }

  const rssIncreasePercent =
    dynamicComparison.peakRssImprovementPercent === null
      ? null
      : round(-dynamicComparison.peakRssImprovementPercent, 3);

  return {
    artifact: path.basename(findArtifactRoot(reportPath, inputRoot)),
    targetId: report.preparation.target.id,
    targetCommit: report.preparation.target.resolvedCommit,
    typescriptGoCommit: report.preparation.typescriptGo.resolvedCommit,
    platform: report.environment.platform,
    architecture: report.environment.architecture,
    logicalCpuCount: report.environment.logicalCpuCount,
    parityPassed: report.parityPassed,
    positionsBalanced: report.configuration.balancedPositions,
    defaultMedianMs: defaultSummary.elapsedMs.median,
    dynamicOffMedianMs: dynamicSummary.elapsedMs.median,
    dynamicOffImprovementPercent: dynamicComparison.timeImprovementPercent,
    dynamicOffSpeedup: dynamicComparison.speedup,
    defaultGCCycles: defaultSummary.runtime.numGC.median,
    dynamicOffGCCycles: dynamicSummary.runtime.numGC.median,
    defaultPeakRssKb: defaultSummary.peakRssKb?.median ?? null,
    dynamicOffPeakRssKb: dynamicSummary.peakRssKb?.median ?? null,
    dynamicOffRssIncreasePercent: rssIncreasePercent,
    defaultGCFocusedCpuPercent:
      evidence?.defaultVsDynamicOff?.defaultGCFocusedCpuPercent ?? null,
    dynamicOffGCFocusedCpuPercent:
      evidence?.defaultVsDynamicOff?.dynamicOffGCFocusedCpuPercent ?? null,
    profiledWallReductionPercent:
      evidence?.defaultVsDynamicOff?.profiledWallReductionPercent ?? null,
    evidenceAnalysisPresent: evidence !== null,
    sourceReport: relative(reportPath),
    sourceEvidence: evidence ? relative(evidencePath) : null
  };
});

rows.sort((left, right) =>
  `${left.targetId}/${left.platform}`.localeCompare(
    `${right.targetId}/${right.platform}`
  )
);

const uniqueTargets = [...new Set(rows.map((row) => row.targetId))];
const uniquePlatforms = [...new Set(rows.map((row) => row.platform))];
const parityPassed = rows.every(
  (row) => row.parityPassed && row.positionsBalanced
);
const dynamicSignalPassed = rows.every(
  (row) => row.dynamicOffImprovementPercent >= 5
);
const memoryBoundPassed = rows
  .filter((row) => row.dynamicOffRssIncreasePercent !== null)
  .every((row) => row.dynamicOffRssIncreasePercent <= 25);
const evidencePresent = rows.every((row) => row.evidenceAnalysisPresent);
const mechanismSignalPassed = rows.every(
  (row) =>
    row.defaultGCFocusedCpuPercent !== null &&
    row.defaultGCFocusedCpuPercent >= 5 &&
    row.dynamicOffGCFocusedCpuPercent !== null &&
    row.dynamicOffGCFocusedCpuPercent <= 1
);
const requiredCoveragePassed =
  uniqueTargets.length >= 2 && uniquePlatforms.length >= 2;
const upstreamEvidenceReady =
  requiredCoveragePassed &&
  parityPassed &&
  dynamicSignalPassed &&
  memoryBoundPassed &&
  evidencePresent &&
  mechanismSignalPassed;

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputRoot: relative(inputRoot),
  rows,
  coverage: {
    targetCount: uniqueTargets.length,
    targets: uniqueTargets,
    platformCount: uniquePlatforms.length,
    platforms: uniquePlatforms
  },
  gates: {
    requiredCoveragePassed,
    parityPassed,
    dynamicSignalPassed,
    memoryBoundPassed,
    evidencePresent,
    mechanismSignalPassed,
    upstreamEvidenceReady
  },
  thresholds: {
    minimumDynamicOffImprovementPercent: 5,
    maximumMeasuredRssIncreasePercent: 25,
    minimumDefaultGCFocusedCpuPercent: 5,
    maximumDynamicOffGCFocusedCpuPercent: 1
  },
  interpretation: upstreamEvidenceReady
    ? "The measured matrix satisfies the internal evidence gate for preparing a human-reviewed upstream comment. It does not by itself authorize an upstream code PR."
    : "The matrix does not yet satisfy every internal upstream-evidence gate. Review the failed gates before drawing an architectural conclusion."
};

mkdirSync(outputRoot, { recursive: true });
const jsonPath = path.join(outputRoot, "gc-policy-matrix.json");
const markdownPath = path.join(outputRoot, "gc-policy-matrix.md");
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(result), "utf8");
console.log(markdownPath);

if (!parityPassed || !evidencePresent) {
  process.exitCode = 1;
}

function findFiles(directory, predicate) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(candidate, predicate));
    } else if (predicate(candidate)) {
      results.push(candidate);
    }
  }
  return results;
}

function findArtifactRoot(filePath, root) {
  const relativePath = path.relative(root, filePath);
  const firstSegment = relativePath.split(path.sep)[0];
  return path.join(root, firstSegment);
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath) || ".";
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function renderMarkdown(result) {
  const lines = [
    "# TypeScript Go GC policy cross-project matrix",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "## Results",
    "",
    "| Target | Platform | Parity | Default ms | CLI-only GC off ms | Improvement | Speedup | GC cycles | Peak RSS change | Default GC-focused CPU | GC-off focused CPU |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const row of result.rows) {
    lines.push(
      `| \`${row.targetId}\` | \`${row.platform}/${row.architecture}\` | ${
        row.parityPassed && row.positionsBalanced ? "yes" : "no"
      } | ${row.defaultMedianMs} | ${row.dynamicOffMedianMs} | ${
        row.dynamicOffImprovementPercent
      }% | ${row.dynamicOffSpeedup}x | ${row.defaultGCCycles} → ${
        row.dynamicOffGCCycles
      } | ${
        row.dynamicOffRssIncreasePercent === null
          ? "n/a"
          : `+${row.dynamicOffRssIncreasePercent}%`
      } | ${row.defaultGCFocusedCpuPercent ?? "n/a"}% | ${
        row.dynamicOffGCFocusedCpuPercent ?? "n/a"
      }% |`
    );
  }

  lines.push(
    "",
    "## Evidence gates",
    "",
    `- Two projects and two platforms: **${yesNo(
      result.gates.requiredCoveragePassed
    )}**`,
    `- Parity and balanced positions: **${yesNo(
      result.gates.parityPassed
    )}**`,
    `- CLI-only GC off improves every row by at least 5%: **${yesNo(
      result.gates.dynamicSignalPassed
    )}**`,
    `- Measured RSS increase stays within 25% where available: **${yesNo(
      result.gates.memoryBoundPassed
    )}**`,
    `- Automated pprof/trace analysis present: **${yesNo(
      result.gates.evidencePresent
    )}**`,
    `- GC-focused CPU mechanism signal: **${yesNo(
      result.gates.mechanismSignalPassed
    )}**`,
    "",
    `Upstream evidence ready: **${yesNo(
      result.gates.upstreamEvidenceReady
    )}**`,
    "",
    result.interpretation,
    ""
  );
  return `${lines.join("\n")}\n`;
}

function yesNo(value) {
  return value ? "yes" : "no";
}
