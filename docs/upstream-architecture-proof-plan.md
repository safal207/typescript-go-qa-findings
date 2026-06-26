# Upstream architecture proof plan for microsoft/typescript-go#3259

## Objective

Produce an upstream-ready evidence package for improving `typescript-go` command-line compilation without prematurely proposing a full AST rewrite or Rust integration.

The upstream discussion already identifies three unresolved questions:

1. Is GC activity actually on the wall-clock critical path, rather than concurrent work on otherwise idle cores?
2. Can command-line compilation safely tune or disable GC because most compiler data remains live until process exit?
3. If GC scan cost remains material, can pointer density be reduced without replacing the public `*Node` model with arena-relative IDs throughout the compiler?

## Stage 1 — Real compiler phase and GC evidence

Run the native compiler against at least:

- TypeScript repository
- VS Code repository
- one large type-heavy open-source project
- one many-small-files project

For every project capture repeated samples for:

- default runtime settings
- `GOGC=off`
- `GOGC=500`
- `GOGC=1000`
- dynamic GC disable only during the one-shot compile phase

Capture:

- median, p95, coefficient of variation
- peak RSS
- total allocated bytes
- GC cycle count
- GC CPU time
- mutator-assist time
- stop-the-world time
- runtime trace processor occupancy
- CPU and heap profiles
- diagnostic and exit-code parity

A GC-policy proposal is valid only if wall-clock improvement reproduces on two operating systems and memory growth remains explicitly bounded and documented.

## Stage 2 — Minimal command-line GC policy prototype

Prototype a command-line-only policy around the compilation lifetime. The language server must remain unchanged.

Candidate policies:

1. disable GC after command-line initialization and restore before returning;
2. use a high GC percentage rather than fully disabling GC;
3. combine a high GC percentage with `debug.SetMemoryLimit` as a safety boundary;
4. trigger one explicit GC only when producing final memory/profile artifacts.

The patch must:

- restore previous runtime settings;
- preserve tests and diagnostics;
- avoid global behavior changes for LSP/server processes;
- include benchmark and memory results;
- expose no user-facing behavior unless maintainers request a flag.

## Stage 3 — Go arena optimization control

Before attributing benefits to Rust or flat AST representation, run the Go arena sweep tracked in issue #11:

- element-count and byte-size chunk policies
- separate policies for nodes and pointer child lists
- adaptive initial capacity from source-file size or parser node estimates
- typed size classes
- safe reset/reuse without retaining pathological peaks
- GC scan and write-barrier measurements

## Stage 4 — Pointer-density experiments without global Node IDs

Only if stages 1–3 leave material GC scan cost, prototype narrowly scoped representations that preserve the existing `*Node` API at subsystem boundaries.

Candidates to measure, not assume:

- pointer-free hot headers plus cold side data
- compact child/reference tables inside one source-file parser arena
- source-file-local handles converted to `*Node` only at a coarse boundary
- pointer-free parser intermediate representation converted once into the existing AST

Reject designs that require every checker/binder function to accept an arena or that introduce per-node cross-language calls.

## Upstream delivery format

Do not create a duplicate issue. Add a human-reviewed comment to `microsoft/typescript-go#3259` containing:

- exact commit and toolchain versions
- real-project commands
- raw artifacts or a permanent repository link
- parity statement
- runtime-trace evidence, not only pprof percentages
- timing and peak-memory confidence intervals
- one minimal recommended next experiment
- explicit limitations and rejected claims

A code PR should be opened only after maintainers indicate interest and repository contribution scope permits performance changes.

## Decision gates

### Recommend GC-policy patch

- at least 5% wall-clock improvement on two representative projects;
- reproduced on Linux and macOS or Windows;
- no diagnostic/output regressions;
- memory increase is acceptable and bounded;
- runtime trace shows reduced critical-path GC/assist work.

### Recommend Go arena redesign

- at least 10% parser-phase improvement or 10% peak-memory reduction on real compiler workloads;
- retains existing ownership/API model;
- improvement survives full compiler integration.

### Recommend coarse Rust/parser prototype

- best Go design still trails materially;
- parser/AST construction accounts for enough CPU to permit at least 5% total compiler improvement under Amdahl's law;
- boundary crosses once per file or compilation unit;
- conversion and ownership costs are included.

### Reject architecture work

- gains disappear on real projects;
- runtime trace shows GC is mostly off critical path;
- memory cost outweighs time improvement;
- only microbenchmarks improve;
- design requires compiler-wide pointer-to-ID migration before demonstrating value.
