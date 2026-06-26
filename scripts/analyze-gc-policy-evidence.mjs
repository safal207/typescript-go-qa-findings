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
const reportPath = path.resolve(
  process.env.GC_BENCH_REPORT ?? "results/gc-policy/latest.json"
);
const gcFocus =
  "runtime\\.(gc|scan|grey|wb|mark|tryDefer|findObject)|gcWriteBarrier";

if (!existsSync(reportPath)) {
  throw new Error(`GC benchmark report does not exist: ${reportPath}`);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const runDirectory = path.dirname(
  path.resolve(
    report.evidence[0]?.artifacts.runtimeStatsPath ??
      report.samples[0]?.artifacts.runtimeStatsPath
  )
);
const reportRunDirectory = path.dirname(runDirectory);
const analyses = [];

for (const evidence of report.evidence) {
  const profileDirectory = path.resolve(evidence.artifacts.profileDirectory);
  const runtimeTracePath = path.resolve(evidence.artifacts.runtimeTracePath);
  const cpuProfile = findFile(profileDirectory, (name) =>
    name.includes("cpuprofile")
  );
  const memoryProfile = findFile(profileDirectory, (name) =>
    name.includes("memprofile")
  );

  if (!cpuProfile) {
    throw new Error(`CPU profile not found for ${evidence.modeId}`);
  }
  if (!runtimeTracePath || !existsSync(runtimeTracePath)) {
    throw new Error(`Runtime trace not found for ${evidence.modeId}`);
  }

  const cpuTop = runText("go", [
    "tool",
    "pprof",
    "-top",
    "-nodecount=60",
    cpuProfile
  ]);
  const gcTop = runText("go", [
    "tool",
    "pprof",
    "-top",
    "-nodecount=120",
    `-focus=${gcFocus}`,
    cpuProfile
  ]);
  const allocationTop = memoryProfile
    ? runText("go", [
        "tool",
        "pprof",
        "-top",
        "-nodecount=60",
        "-sample_index=alloc_space",
        memoryProfile
      ])
    : "memory profile unavailable\n";

  writeFileSync(path.join(profileDirectory, "cpu-top.txt"), cpuTop, "utf8");
  writeFileSync(
    path.join(profileDirectory, "gc-cpu-focus.txt"),
    gcTop,
    "utf8"
  );
  writeFileSync(
    path.join(profileDirectory, "allocation-top.txt"),
    allocationTop,
    "utf8"
  );

  const schedulerProfilePath = path.join(
    profileDirectory,
    "trace-scheduler.pb.gz"
  );
  const schedulerResult = spawnSync(
    "go",
    ["tool", "trace", "-pprof=sched", runtimeTracePath],
    {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 128 * 1024 * 1024
    }
  );
  let schedulerTop = "scheduler profile unavailable\n";
  let schedulerError = null;
  if (schedulerResult.status === 0 && !schedulerResult.error) {
    writeFileSync(schedulerProfilePath, schedulerResult.stdout);
    schedulerTop = runText("go", [
      "tool",
      "pprof",
      "-top",
      "-nodecount=60",
      schedulerProfilePath
    ]);
    writeFileSync(
      path.join(profileDirectory, "trace-scheduler-top.txt"),
      schedulerTop,
      "utf8"
    );
  } else {
    schedulerError =
      schedulerResult.error?.message ??
      (Buffer.from(schedulerResult.stderr ?? []).toString("utf8").trim() ||
        `go tool trace exited ${schedulerResult.status}`);
  }

  analyses.push({
    modeId: evidence.modeId,
    status: evidence.status,
    diagnosticHash: evidence.diagnosticHash,
    profiledElapsedMs: evidence.elapsedMs,
    gcTraceCycleLines: evidence.gcTrace.cycleLines,
    runtime: {
      numGC: evidence.runtimeStats.delta.numGC,
      pauseTotalNs: evidence.runtimeStats.delta.pauseTotalNs,
      totalAlloc: evidence.runtimeStats.delta.totalAlloc,
      mallocs: evidence.runtimeStats.delta.mallocs,
      heapAllocAfter: evidence.runtimeStats.after.heapAlloc,
      heapSysAfter: evidence.runtimeStats.after.heapSys,
      processSysAfter: evidence.runtimeStats.after.sys,
      gcCpuFractionAfter: evidence.runtimeStats.after.gcCpuFraction
    },
    cpuProfile: relative(cpuProfile),
    memoryProfile: memoryProfile ? relative(memoryProfile) : null,
    runtimeTrace: relative(runtimeTracePath),
    gcCpuFocus: parsePprofAccounting(gcTop),
    schedulerProfile:
      schedulerResult.status === 0 ? relative(schedulerProfilePath) : null,
    schedulerError
  });
}

const baseline = analyses.find((analysis) => analysis.modeId === "default");
const dynamicOff = analyses.find(
  (analysis) => analysis.modeId === "dynamic-off"
);
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceReport: relative(reportPath),
  gcFocus,
  analyses,
  defaultVsDynamicOff:
    baseline && dynamicOff
      ? {
          defaultGCFocusedCpuPercent: baseline.gcCpuFocus.accountedPercent,
          dynamicOffGCFocusedCpuPercent:
            dynamicOff.gcCpuFocus.accountedPercent,
          focusedCpuReductionPercentagePoints: round(
            baseline.gcCpuFocus.accountedPercent -
              dynamicOff.gcCpuFocus.accountedPercent,
            3
          ),
          defaultProfileTotalCpuSeconds: baseline.gcCpuFocus.totalSeconds,
          dynamicOffProfileTotalCpuSeconds:
            dynamicOff.gcCpuFocus.totalSeconds,
          totalProfileCpuReductionPercent: improvementPercent(
            baseline.gcCpuFocus.totalSeconds,
            dynamicOff.gcCpuFocus.totalSeconds
          ),
          defaultProfiledWallMs: baseline.profiledElapsedMs,
          dynamicOffProfiledWallMs: dynamicOff.profiledElapsedMs,
          profiledWallReductionPercent: improvementPercent(
            baseline.profiledElapsedMs,
            dynamicOff.profiledElapsedMs
          )
        }
      : null,
  interpretation:
    "The GC focus is a broad reproducible classifier for collector scanning, marking, and write-barrier work. It is supporting evidence, not a substitute for the order-balanced unprofiled timing samples or a full runtime critical-path analysis."
};

const jsonPath = path.join(reportRunDirectory, "gc-evidence-analysis.json");
const markdownPath = path.join(reportRunDirectory, "gc-evidence-analysis.md");
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(result), "utf8");
writeFileSync(
  path.join(path.dirname(reportPath), "latest-evidence-analysis.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);
writeFileSync(
  path.join(path.dirname(reportPath), "latest-evidence-analysis.md"),
  renderMarkdown(result),
  "utf8"
);

console.log(markdownPath);

function findFile(directory, predicate) {
  if (!directory || !existsSync(directory)) {
    return null;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(candidate, predicate);
      if (nested) {
        return nested;
      }
    } else if (predicate(entry.name)) {
      return candidate;
    }
  }
  return null;
}

function runText(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
  return `${[result.stdout, result.stderr].filter(Boolean).join("\n").trim()}\n`;
}

function parsePprofAccounting(text) {
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("Showing nodes accounting for"));
  if (!line) {
    return {
      accountedSeconds: 0,
      accountedPercent: 0,
      totalSeconds: 0,
      raw: null
    };
  }

  const match = line.match(
    /Showing nodes accounting for\s+([0-9.]+)(ms|s)?,\s+([0-9.]+)% of\s+([0-9.]+)(ms|s) total/
  );
  if (!match) {
    return {
      accountedSeconds: 0,
      accountedPercent: 0,
      totalSeconds: 0,
      raw: line
    };
  }
  return {
    accountedSeconds: toSeconds(Number(match[1]), match[2] ?? "s"),
    accountedPercent: Number(match[3]),
    totalSeconds: toSeconds(Number(match[4]), match[5]),
    raw: line
  };
}

function toSeconds(value, unit) {
  return unit === "ms" ? value / 1000 : value;
}

function improvementPercent(baselineValue, candidateValue) {
  if (baselineValue === 0) {
    return candidateValue === 0 ? 0 : -100;
  }
  return round(((baselineValue - candidateValue) / baselineValue) * 100, 3);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath) || ".";
}

function renderMarkdown(result) {
  const lines = [
    "# GC policy evidence analysis",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    `Source report: \`${result.sourceReport}\``,
    "",
    "## CPU profile classification",
    "",
    "| Mode | Profiled wall ms | CPU sample total s | GC-focused CPU % | GC cycles | GC pause ms | Heap after MiB |",
    "|---|---:|---:|---:|---:|---:|---:|"
  ];

  for (const analysis of result.analyses) {
    lines.push(
      `| \`${analysis.modeId}\` | ${analysis.profiledElapsedMs} | ${analysis.gcCpuFocus.totalSeconds} | ${analysis.gcCpuFocus.accountedPercent}% | ${analysis.runtime.numGC} | ${round(
        analysis.runtime.pauseTotalNs / 1_000_000,
        3
      )} | ${round(analysis.runtime.heapAllocAfter / 1024 / 1024, 3)} |`
    );
  }

  if (result.defaultVsDynamicOff) {
    lines.push(
      "",
      "## Default versus CLI-only GC off",
      "",
      `- GC-focused CPU samples: **${result.defaultVsDynamicOff.defaultGCFocusedCpuPercent}% → ${result.defaultVsDynamicOff.dynamicOffGCFocusedCpuPercent}%**`,
      `- Total sampled CPU reduction: **${result.defaultVsDynamicOff.totalProfileCpuReductionPercent}%**`,
      `- Profiled wall-time reduction: **${result.defaultVsDynamicOff.profiledWallReductionPercent}%**`,
      ""
    );
  }

  lines.push("## Interpretation limit", "", result.interpretation, "");
  return `${lines.join("\n")}\n`;
}
