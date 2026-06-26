# Go vs Rust AST arena upper-bound experiment — 2026-06-26

## Decision status

**Result: promising standalone signal, insufficient evidence for compiler integration.**

The experiment supports continuing with an optimized Go control and a coarse parser/AST subsystem design study. It does not support a full Rust rewrite, a scanner-only port, or per-node/per-token FFI.

## Question

When both implementations use a geometrically growing chunked arena and execute the same AST-shaped allocation trace, does Rust retain a material advantage over Go?

The experiment separates three effects:

1. current `typescript-go`-style typed arena → Go chunked arena: allocation-strategy effect inside Go;
2. current Go arena → Rust chunked arena: total observed effect;
3. Go chunked arena → Rust chunked arena: residual language/runtime/data-representation effect after controlling for chunking.

## Correctness gate

All three implementations use:

- the same language-neutral trace files;
- the same SplitMix64 sequence;
- the same arena lifetimes;
- the same node and child-list initialization;
- the same list-clone schedule;
- the same traversal and wrapping checksum;
- the same operation-count definition.

Checksum and operation count matched on every trace and environment: **parity 3/3 on Ubuntu and 3/3 on macOS**.

## Environments

### Ubuntu

- GitHub Actions `ubuntu-latest`
- Linux x64
- Intel Xeon Platinum 8370C
- 4 logical CPUs
- Go 1.26.4
- Rust 1.96.0
- one warm-up and five measured iterations

### macOS

- GitHub Actions `macos-latest`
- macOS arm64
- Apple M1 virtual runner
- 3 logical CPUs
- Go 1.26.4
- Rust 1.96.0
- one warm-up and five measured iterations

## Raw median results

### Ubuntu

| Trace | Implementation | Median | Allocated bytes | Allocation calls | Peak RSS |
|---|---|---:|---:|---:|---:|
| many-small-nodes | current Go typed | 38.624 ms | 47,352,704 | 14,257 | 11,052 KiB |
| many-small-nodes | Go chunked | 39.207 ms | 67,164,784 | 1,076 | 8,880 KiB |
| many-small-nodes | Rust chunked | 27.958 ms | 57,336,520 | 787 | 2,696 KiB |
| large-source-file | current Go typed | 57.742 ms | 52,584,656 | 22,505 | 44,116 KiB |
| large-source-file | Go chunked | 58.981 ms | 61,443,328 | 76 | 48,692 KiB |
| large-source-file | Rust chunked | 44.009 ms | 55,230,152 | 63 | 19,656 KiB |
| mixed-project | current Go typed | 60.522 ms | 59,181,768 | 22,544 | 12,892 KiB |
| mixed-project | Go chunked | 71.128 ms | 84,089,184 | 483 | 20,600 KiB |
| mixed-project | Rust chunked | 46.746 ms | 73,769,696 | 372 | 4,956 KiB |

### macOS arm64

macOS process peak RSS is not reported by the current cross-platform runner, so the controlled decision there uses timing and allocation counters.

| Trace | Implementation | Median | Allocated bytes | Allocation calls |
|---|---|---:|---:|---:|
| many-small-nodes | current Go typed | 31.730 ms | 47,353,072 | 14,262 |
| many-small-nodes | Go chunked | 40.008 ms | 67,164,896 | 1,077 |
| many-small-nodes | Rust chunked | 27.338 ms | 57,336,520 | 787 |
| large-source-file | current Go typed | 65.793 ms | 52,584,768 | 22,506 |
| large-source-file | Go chunked | 66.135 ms | 61,443,424 | 76 |
| large-source-file | Rust chunked | 40.758 ms | 55,230,152 | 63 |
| mixed-project | current Go typed | 66.112 ms | 59,181,896 | 22,545 |
| mixed-project | Go chunked | 71.150 ms | 84,089,520 | 486 |
| mixed-project | Rust chunked | 41.167 ms | 73,769,696 | 372 |

## Controlled result: Go chunked → Rust chunked

### Ubuntu

| Trace | Rust time improvement | Speedup | Allocation-call improvement | Peak-RSS improvement | Gate |
|---|---:|---:|---:|---:|---:|
| many-small-nodes | 28.691% | 1.402x | 26.859% | 69.640% | pass |
| large-source-file | 25.383% | 1.340x | 17.105% | 59.632% | pass |
| mixed-project | 34.279% | 1.522x | 22.981% | 75.942% | pass |

### macOS arm64

| Trace | Rust time improvement | Speedup | Allocation-call improvement | Gate |
|---|---:|---:|---:|---:|
| many-small-nodes | 31.667% | 1.463x | 26.927% | pass |
| large-source-file | 38.371% | 1.623x | 17.105% | pass |
| mixed-project | 42.141% | 1.728x | 23.457% | pass |

Rust clears the language/runtime standalone gate on all three traces in both environments.

## What the Go chunked control changed

The simple Go chunked implementation reduced allocation-call count drastically, but it did not improve elapsed time:

- Ubuntu: 1.5% to 17.5% slower than the current Go arena;
- macOS: 0.5% to 26.1% slower than the current Go arena.

It also requested more cumulative bytes because the fixed 4,096-element initial chunks and geometric growth over-allocated on some lifetimes.

This control is intentionally simple. It prevents the Rust result from being credited only to larger chunks, but it is not proof that every optimized Go arena must perform similarly. Chunk-size tuning, typed size classes, reuse, and workload-aware growth remain untested.

## Allocation interpretation

Rust frequently requested more cumulative bytes than the current small-chunk Go arena, but fewer bytes than the Go chunked control. Its main advantages were:

- fewer allocator calls;
- stable non-GC arena storage;
- lower Linux process peak RSS;
- faster traversal/allocation loop despite equivalent logical work.

Therefore the signal is not “Rust stores less logical data.” It is a combination of allocation granularity, GC scanning/retention, representation, write barriers, and generated-code/runtime behavior.

Go `runtime.MemStats` and the Rust counting allocator are not identical accounting systems. Timing, parity, and Linux process peak RSS are the stronger cross-runtime signals.

## Amdahl upper-bound check

The previous native `typescript-go` profile on the `few-large-files` workload showed:

- source-file parsing: 82.47% cumulative allocation space;
- typed `slices.Grow` arena frames: approximately 47.23% of allocation space;
- CPU time distributed across parser, binder, checker, AST traversal, allocation, write barriers, and GC;
- no high-resolution CPU percentage that can be assigned exclusively to arena operations.

Allocation-space share is **not** CPU-time share, so 47.23% cannot be inserted directly into Amdahl's law as a measured affected fraction. It is only evidence that the subsystem is material.

For an overall compiler-time reduction of 5%, the affected CPU fraction required by the observed Go-chunked → Rust speedups is:

| Environment / trace | Residual speedup | Required affected CPU fraction for 5% total reduction |
|---|---:|---:|
| Ubuntu / many-small | 1.402x | 17.44% |
| Ubuntu / large-source | 1.340x | 19.71% |
| Ubuntu / mixed | 1.522x | 14.58% |
| macOS / many-small | 1.463x | 15.80% |
| macOS / large-source | 1.623x | 13.03% |
| macOS / mixed | 1.728x | 11.87% |

Thus a 5% end-to-end compiler improvement is **plausible but unproven**. It requires arena-sensitive parser/AST work to account for roughly 12%–20% of total CPU time, depending on environment and workload.

For a 10% total peak-memory reduction on Ubuntu, the observed standalone RSS reductions require roughly 13%–17% of compiler peak memory to be affected. The allocation profile makes that plausible, but `alloc_space` is not equivalent to peak live RSS.

## Architecture decision

### Rejected

- full TypeScript compiler rewrite in Rust;
- per-token scanner FFI;
- per-node arena FFI;
- porting one checker helper;
- treating standalone RSS reduction as an end-to-end compiler result.

### Allowed next work

1. Improve the Go control before attributing the whole residual to language:
   - chunk-size sweep;
   - adaptive growth based on element size and source-file shape;
   - typed size classes;
   - optional pooling/reuse;
   - measure GC scan and write-barrier effects.
2. Obtain a higher-resolution phase profile separating parse/AST construction from bind/check.
3. If Rust remains materially ahead, design a **coarse parser + AST storage boundary** that crosses the language boundary once per source file or compilation unit, never once per node/token.
4. Estimate serialization/ownership/diagnostic integration costs before writing FFI.

## Final conclusion

The original statement “Rust is faster than Go” is too broad.

The evidence supports a narrower claim:

> For this deterministic AST-shaped arena workload, the Rust chunked implementation is materially faster than both the current-style Go typed arena and a simple Go arena using the same chunk geometry, with parity preserved across Linux x64 and macOS arm64.

That is enough to continue research at the parser/AST subsystem level. It is not enough to justify rewriting `typescript-go`, and it may still be beaten by a better Go-specific arena design.
