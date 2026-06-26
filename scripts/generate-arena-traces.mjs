import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve(
  process.env.ARENA_TRACE_DIR ?? "benchmarks/arena/traces"
);
const scale = parsePositiveInteger(
  process.env.ARENA_TRACE_SCALE,
  1,
  "ARENA_TRACE_SCALE"
);

const traces = [
  {
    id: "many-small-nodes",
    seed: "11400714819323198485",
    arenas: 96 * scale,
    nodesPerArena: 8000,
    nodeJitter: 1500,
    maxChildren: 6,
    cloneEvery: 13,
    largeListEvery: 0,
    largeListSize: 0
  },
  {
    id: "large-source-file",
    seed: "13787848793156543929",
    arenas: 3 * scale,
    nodesPerArena: 220000,
    nodeJitter: 12000,
    maxChildren: 12,
    cloneEvery: 7,
    largeListEvery: 257,
    largeListSize: 128
  },
  {
    id: "mixed-project",
    seed: "10723151780598845931",
    arenas: 28 * scale,
    nodesPerArena: 28000,
    nodeJitter: 18000,
    maxChildren: 10,
    cloneEvery: 9,
    largeListEvery: 509,
    largeListSize: 96
  }
];

mkdirSync(outputDirectory, { recursive: true });
for (const trace of traces) {
  const content = [
    "schema_version=1",
    `id=${trace.id}`,
    `seed=${trace.seed}`,
    `arenas=${trace.arenas}`,
    `nodes_per_arena=${trace.nodesPerArena}`,
    `node_jitter=${trace.nodeJitter}`,
    `max_children=${trace.maxChildren}`,
    `clone_every=${trace.cloneEvery}`,
    `large_list_every=${trace.largeListEvery}`,
    `large_list_size=${trace.largeListSize}`,
    ""
  ].join("\n");
  writeFileSync(path.join(outputDirectory, `${trace.id}.trace`), content, "utf8");
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scale,
  traces: traces.map((trace) => ({
    ...trace,
    path: path.join(path.relative(process.cwd(), outputDirectory), `${trace.id}.trace`)
  }))
};
writeFileSync(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(path.join(outputDirectory, "manifest.json"));

function parsePositiveInteger(rawValue, fallback, name) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
