# AST-shaped arena upper-bound experiment

This benchmark compares three standalone implementations using the same deterministic AST-like traces:

- **Current Go baseline** — reproduces the typed arena growth strategy currently used by `typescript-go`: new backing storage is obtained with `slices.Grow`, and the requested arena size doubles up to 256 elements.
- **Go chunked control** — uses the same geometrically growing chunk strategy as the Rust candidate while staying in Go.
- **Rust candidate** — a chunked bump-style arena with stable pointers and geometrically growing chunks.

The Go chunked control is essential: it separates gains caused by chunking/data layout from gains caused by the language and runtime. The Rust decision gate is evaluated against Go chunked, not only against the current compiler arena.

This experiment does not integrate Rust into the TypeScript compiler and does not include FFI. Its purpose is to estimate whether arena allocation and data layout contain enough headroom to justify a deeper subsystem experiment.

## Trace format

Trace files are UTF-8 `key=value` documents so Go, Rust, shell tools, and JavaScript can read them without language-specific dependencies.

```text
schema_version=1
id=many-small-nodes
seed=11400714819323198485
arenas=96
nodes_per_arena=8000
node_jitter=1500
max_children=6
clone_every=13
large_list_every=0
large_list_size=0
```

Each implementation uses the same SplitMix64 sequence and performs the same logical work:

1. create one arena lifetime per generated source file;
2. allocate AST-like nodes;
3. allocate and initialize child-index lists;
4. clone selected lists;
5. traverse every node and child;
6. produce a wrapping 64-bit checksum and operation count.

Checksum and operation-count equality across all three implementations are hard gates.

## Commands

```bash
npm run benchmark:arena-traces
npm run benchmark:arena
```

Useful controls:

```bash
ARENA_TRACE_SCALE=2 \
ARENA_WARMUPS=2 \
ARENA_ITERATIONS=9 \
npm run benchmark:arena
```

## Metrics

The common runner records:

- median and p95 elapsed time;
- coefficient of variation;
- allocation bytes and allocation calls;
- process peak RSS on Linux;
- toolchain and machine metadata;
- checksum and operation-count parity.

Go uses `runtime.MemStats`. Rust uses a counting wrapper around the system allocator. Those allocation counters are directionally comparable but are not identical runtime accounting systems; process peak RSS and end-to-end timing remain independent supporting metrics.

## Controlled comparisons

The report separates three effects:

1. **Current Go → Go chunked** — allocation strategy/data-layout effect within Go.
2. **Current Go → Rust chunked** — total observed effect.
3. **Go chunked → Rust chunked** — residual language/runtime effect after controlling for chunking.

## Decision gate

One trace emits a Rust language/runtime signal only when parity passes and Rust improves over **Go chunked** by either:

- median time by at least **20%**, or
- process peak RSS by at least **25%**.

At least two traces must signal. Even then, no compiler integration is justified until a profile-based end-to-end upper-bound calculation and a subsystem boundary avoid per-node or per-token FFI calls.
