# Real-project `tsgo` GC policy benchmark

This experiment tests whether Go garbage-collector policy is on the wall-clock critical path during one-shot TypeScript command-line compilation.

It is designed as evidence for the architectural discussion in `microsoft/typescript-go#3259`, not as an upstream product patch.

## What is compared

The same pinned `typescript-go` source and real TypeScript project are compiled under five policies:

| Mode | Policy |
|---|---|
| `default` | Normal Go runtime defaults |
| `gogc-500` | `GOGC=500` from process startup |
| `gogc-1000` | `GOGC=1000` from process startup |
| `gogc-off` | GC disabled from process startup |
| `dynamic-off` | GC disabled only after `tsgo` selects command-line mode |

The dynamic policy is benchmark-only instrumentation. It is inserted after the `--lsp` / `--api` routing check, so it does not change language-server or API execution.

## Order-bias control

Measured runs use a deterministic rotating Latin order. With five measured rounds, every mode appears exactly once in each execution position.

This prevents a mode from receiving a systematic advantage from:

- filesystem cache warming;
- CPU frequency ramp-up;
- runner initialization;
- always running first or last.

The report fails its evidence gate when the measured-round count is not a multiple of five.

## Initial real project

The first bounded target is `date-fns` v4.1.0. The preparation manifest records the resolved Git commits and toolchain versions on every run.

Additional targets should be added only with pinned refs, deterministic setup, and a stable `tsconfig` entry point.

## Commands

```bash
npm run benchmark:gc-prepare
npm run benchmark:gc-policy
```

Controls:

```bash
GC_BENCH_TARGET=date-fns-v4.1.0 \
GC_BENCH_WARMUPS=1 \
GC_BENCH_ITERATIONS=10 \
npm run benchmark:gc-policy
```

Generated work is stored under `.bench-gc/`; reports and evidence are stored under `results/gc-policy/`.

## Evidence model

Timed samples run without `GODEBUG=gctrace=1`, CPU profiling, or runtime tracing. Those mechanisms add overhead and are captured in separate evidence runs.

Every timed run records:

- wall-clock duration;
- execution round and position;
- Linux process peak RSS where available;
- exit status;
- normalized diagnostic hash;
- runtime allocation and heap snapshots;
- GC cycle and pause deltas.

Every evidence run additionally records:

- raw `gctrace` lines;
- Go runtime trace;
- native `tsgo` CPU and allocation profiles through `--pprofDir`;
- stdout and stderr.

## Correctness gate

A performance result is invalid unless every measured run is deterministic and every policy matches the default policy on:

- process exit status;
- normalized compiler diagnostics.

A non-zero compiler status is acceptable when it is stable and identical across policies; the experiment measures policy, not whether the selected project is diagnostic-free under the pinned compiler.

## Initial signal gate

One project produces a signal only when:

- execution positions are balanced;
- parity passes;
- the fastest policy improves median wall-clock time by at least 5%.

That is not sufficient for an upstream recommendation. The signal must reproduce on another representative project and operating system with bounded memory growth and runtime-trace evidence that GC or mutator-assist work is on the critical path.

## Benchmark-only compiler modification

Preparation copies `bench_runtime.go` into `cmd/tsgo` and adds one CLI-only lifecycle hook to `runMain`. The exact generated diff is saved as `.bench-gc/typescript-go-benchmark.patch` so the instrumentation is auditable.

The instrumentation can:

- apply and restore `debug.SetGCPercent`;
- apply and restore `debug.SetMemoryLimit`;
- capture `runtime.MemStats` before and after compilation;
- capture `runtime/trace`.

No TypeScript parser, binder, checker, diagnostic, or emit logic is modified.
