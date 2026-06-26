import {
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(".");
const outputRoot = path.resolve(
  process.env.BENCH_FIXTURE_ROOT ?? ".bench-workloads"
);
const scale = parsePositiveInteger(
  process.env.BENCH_FIXTURE_SCALE,
  1,
  "BENCH_FIXTURE_SCALE"
);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const workloads = [
  generateManySmallFiles(),
  generateFewLargeFiles(),
  generateTypeHeavy(),
  generateModuleResolutionHeavy()
];

const manifest = {
  schemaVersion: 1,
  fixtureRoot: path.relative(repositoryRoot, outputRoot),
  scale,
  workloads
};

writeJson(path.join(outputRoot, "manifest.json"), manifest);
console.log(path.join(outputRoot, "manifest.json"));

function generateManySmallFiles() {
  const id = "many-small-files";
  const directory = workloadDirectory(id);
  const sourceDirectory = path.join(directory, "src");
  const fileCount = 180 * scale;

  writeTsconfig(directory);

  for (let index = 0; index < fileCount; index += 1) {
    const padded = String(index).padStart(4, "0");
    const previousImport =
      index === 0
        ? ""
        : `import { value${index - 1} } from "./model-${String(index - 1).padStart(4, "0")}";\n`;
    const previousExpression = index === 0 ? "0" : `value${index - 1}.score`;

    writeText(
      path.join(sourceDirectory, `model-${padded}.ts`),
      `${previousImport}export interface Model${index} {\n  id: \`model-${index}-\${string}\`;\n  score: number;\n  tags: readonly string[];\n  metadata: Record<string, string | number | boolean>;\n}\n\nexport type ModelPatch${index} = Partial<Pick<Model${index}, "score" | "tags" | "metadata">>;\n\nexport const value${index}: Model${index} = {\n  id: "model-${index}-fixture",\n  score: ${previousExpression} + ${index + 1},\n  tags: ["generated", "small-file"],\n  metadata: { index: ${index}, active: true }\n};\n\nexport function update${index}(value: Model${index}, patch: ModelPatch${index}): Model${index} {\n  return { ...value, ...patch };\n}\n`
    );
  }

  writeText(
    path.join(sourceDirectory, "index.ts"),
    `import { value${fileCount - 1} } from "./model-${String(fileCount - 1).padStart(4, "0")}";\n\nexport const finalSmallFileScore = value${fileCount - 1}.score;\n`
  );

  return manifestEntry({
    id,
    description: "Many small modules connected by a shallow import chain.",
    focus: ["filesystem traversal", "parsing startup", "module graph construction"],
    sourceFiles: fileCount + 1
  });
}

function generateFewLargeFiles() {
  const id = "few-large-files";
  const directory = workloadDirectory(id);
  const sourceDirectory = path.join(directory, "src");
  const largeFileCount = 4;
  const declarationsPerFile = 260 * scale;

  writeTsconfig(directory);

  for (let fileIndex = 0; fileIndex < largeFileCount; fileIndex += 1) {
    const lines = [
      `export type File${fileIndex}Primitive = string | number | boolean | null;`,
      ""
    ];

    for (let declarationIndex = 0; declarationIndex < declarationsPerFile; declarationIndex += 1) {
      const name = `${fileIndex}_${declarationIndex}`;
      lines.push(
        `export interface Record${name} {`,
        `  id: \`record-${name}-\${string}\`;`,
        "  createdAt: string;",
        "  values: readonly number[];",
        "  attributes: Record<string, File" + fileIndex + "Primitive>;",
        "}",
        "",
        `export type Record${name}View = Readonly<Omit<Record${name}, "attributes">> & {`,
        `  attributes: Readonly<Record${name}["attributes"]>;`,
        "};",
        "",
        `export function normalize${name}(input: Record${name}): Record${name}View {`,
        "  return { ...input, values: [...input.values], attributes: { ...input.attributes } };",
        "}",
        ""
      );
    }

    writeText(path.join(sourceDirectory, `large-${fileIndex}.ts`), lines.join("\n"));
  }

  writeText(
    path.join(sourceDirectory, "index.ts"),
    Array.from(
      { length: largeFileCount },
      (_, index) => `export * from "./large-${index}";`
    ).join("\n") + "\n"
  );

  return manifestEntry({
    id,
    description: "A small number of very large source files with repeated declarations.",
    focus: ["scanner throughput", "parser throughput", "large AST allocation"],
    sourceFiles: largeFileCount + 1
  });
}

function generateTypeHeavy() {
  const id = "type-heavy";
  const directory = workloadDirectory(id);
  const sourceDirectory = path.join(directory, "src");
  const fileCount = 48 * scale;

  writeTsconfig(directory);
  writeText(
    path.join(sourceDirectory, "shared.ts"),
    `export type Primitive = string | number | boolean | bigint | symbol | null | undefined;\n\nexport type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)\n  ? T\n  : T extends readonly (infer Item)[]\n    ? readonly DeepReadonly<Item>[]\n    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };\n\nexport type DeepPartial<T> = T extends Primitive | ((...args: never[]) => unknown)\n  ? T\n  : T extends readonly (infer Item)[]\n    ? readonly DeepPartial<Item>[]\n    : { [Key in keyof T]?: DeepPartial<T[Key]> };\n\nexport type EventUnion<T extends Record<string, object>> = {\n  [Key in keyof T]: { type: Key; payload: T[Key] }\n}[keyof T];\n\nexport type AwaitedResult<T> = T extends (...args: never[]) => Promise<infer Result> ? Result : never;\n`
  );

  for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
    const modelCount = 14;
    const lines = [
      `import type { AwaitedResult, DeepPartial, DeepReadonly, EventUnion } from "./shared";`,
      ""
    ];

    for (let modelIndex = 0; modelIndex < modelCount; modelIndex += 1) {
      const name = `${fileIndex}_${modelIndex}`;
      lines.push(
        `export interface Entity${name} {`,
        "  id: string;",
        `  kind: "entity-${name}";`,
        "  state: \"new\" | \"active\" | \"paused\" | \"closed\";",
        "  coordinates: readonly [number, number, number?];",
        `  nested: { owner: { id: string; name: string }; metrics: Record<"m0" | "m1" | "m2", number> };`,
        "}",
        "",
        `export type Entity${name}Readonly = DeepReadonly<Entity${name}>;`,
        `export type Entity${name}Patch = DeepPartial<Entity${name}>;`,
        `export type Entity${name}Events = EventUnion<{`,
        `  created: { entity: Entity${name} };`,
        `  patched: { id: string; patch: Entity${name}Patch };`,
        `  archived: { id: string; reason?: string };`,
        "}>;",
        "",
        `export async function load${name}(id: string): Promise<Entity${name}Readonly> {`,
        `  return { id, kind: "entity-${name}", state: "active", coordinates: [${fileIndex}, ${modelIndex}], nested: { owner: { id: "owner", name: "Generated" }, metrics: { m0: 0, m1: 1, m2: 2 } } };`,
        "}",
        `export type Loaded${name} = AwaitedResult<typeof load${name}>;`,
        ""
      );
    }

    writeText(path.join(sourceDirectory, `types-${String(fileIndex).padStart(3, "0")}.ts`), lines.join("\n"));
  }

  writeText(
    path.join(sourceDirectory, "index.ts"),
    Array.from(
      { length: fileCount },
      (_, index) => `export * from "./types-${String(index).padStart(3, "0")}";`
    ).join("\n") + "\n"
  );

  return manifestEntry({
    id,
    description: "Conditional, mapped, indexed-access, union, and promise-derived types across many files.",
    focus: ["type instantiation", "symbol lookup", "checker scaling"],
    sourceFiles: fileCount + 2
  });
}

function generateModuleResolutionHeavy() {
  const id = "module-resolution-heavy";
  const directory = workloadDirectory(id);
  const sourceDirectory = path.join(directory, "src");
  const moduleCount = 72 * scale;

  writeTsconfig(directory, {
    paths: {
      "@core/*": ["./src/core/*"],
      "@shared/*": ["./src/shared/*"],
      "@feature/*": ["./src/features/*"]
    }
  });

  for (let index = 0; index < moduleCount; index += 1) {
    const padded = String(index).padStart(3, "0");
    writeText(
      path.join(sourceDirectory, "core", `core-${padded}.ts`),
      `export interface Core${index} { id: string; version: number; enabled: boolean; }\nexport const core${index}: Core${index} = { id: "core-${index}", version: ${index + 1}, enabled: true };\n`
    );
    writeText(
      path.join(sourceDirectory, "shared", `shared-${padded}.ts`),
      `export type Shared${index}<T> = Readonly<{ value: T; source: "shared-${index}"; tags: readonly string[] }>;\nexport function wrap${index}<T>(value: T): Shared${index}<T> { return { value, source: "shared-${index}", tags: ["generated"] }; }\n`
    );
    writeText(
      path.join(sourceDirectory, "features", `feature-${padded}.ts`),
      `import { core${index} } from "@core/core-${padded}";\nimport { wrap${index} } from "@shared/shared-${padded}";\n\nexport const feature${index} = wrap${index}({ ...core${index}, route: "/feature/${index}" as const });\n`
    );
  }

  const imports = [];
  const expressions = [];
  for (let index = 0; index < moduleCount; index += 1) {
    const padded = String(index).padStart(3, "0");
    imports.push(`import { feature${index} } from "@feature/feature-${padded}";`);
    expressions.push(`feature${index}.value.version`);
  }

  writeText(
    path.join(sourceDirectory, "index.ts"),
    `${imports.join("\n")}\n\nexport const moduleResolutionChecksum = ${expressions.join(" + ")};\n`
  );

  return manifestEntry({
    id,
    description: "Alias-heavy three-layer module graph with many imports and path mappings.",
    focus: ["path normalization", "module resolution", "source-file graph construction"],
    sourceFiles: moduleCount * 3 + 1
  });
}

function writeTsconfig(directory, additionalCompilerOptions = {}) {
  writeJson(path.join(directory, "tsconfig.json"), {
    compilerOptions: {
      noEmit: true,
      strict: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      skipLibCheck: true,
      ...additionalCompilerOptions
    },
    include: ["src"]
  });
}

function workloadDirectory(id) {
  const directory = path.join(outputRoot, id);
  mkdirSync(path.join(directory, "src"), { recursive: true });
  return directory;
}

function manifestEntry({ id, description, focus, sourceFiles }) {
  return {
    id,
    description,
    focus,
    sourceFiles,
    projectDirectory: path.relative(repositoryRoot, path.join(outputRoot, id))
  };
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function parsePositiveInteger(rawValue, fallback, name) {
  const value = rawValue === undefined ? fallback : Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
