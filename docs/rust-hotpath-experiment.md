# Rust hot-path experiment for TypeScript Go

## Question

Can a Rust implementation of one isolated, measurable TypeScript compiler hot path outperform the current Go implementation without changing observable compiler behavior?

This is **not** a proposal to rewrite the full TypeScript compiler in Rust. It is a controlled experiment designed to separate language-runtime effects from algorithmic and architectural effects.

## Hypothesis

A Rust implementation may improve throughput, peak memory, or latency consistency for allocation-heavy and cache-sensitive work such as scanning, AST traversal, path processing, or symbol-table helpers.

The hypothesis is considered unsupported if the Rust boundary, data conversion, maintenance cost, or semantic drift cancels the measured gain.

## Non-goals

- Reimplement the TypeScript type system.
- Claim that Rust is categorically faster than Go.
- Compare unrelated compilers with different semantics.
- Accept faster output when diagnostics or exit behavior differ.
- Introduce FFI before a stable baseline and hot path are identified.

## Experimental phases

### Phase 0 — Reproducible baseline

Run the existing benchmark sample repeatedly and record:

- compiler version and commit
- operating system and architecture
- CPU model and logical core count
- Go and Rust versions
- cold and warm runs
- wall-clock duration
- process exit code
- peak resident memory where available
- diagnostic output hash

Use multiple iterations and report median, p95, minimum, maximum, and coefficient of variation. A single run is not evidence.

### Phase 1 — Workload matrix

Use more than one project shape:

1. many small files
2. a small number of large files
3. type-heavy generics and unions
4. path-alias and module-resolution-heavy project
5. project references / mini-monorepo

The existing `repros/benchmark-sample` remains the smoke workload, not the final benchmark corpus.

### Phase 2 — Profile before porting

Profile the Go implementation and identify a candidate that is:

- visible in CPU time, allocations, or peak memory
- sufficiently isolated
- deterministic
- testable with golden inputs and outputs
- not dominated by filesystem noise
- useful across several workloads

Possible candidates, subject to profiling evidence:

- scanner/token classification
- path normalization and hashing
- module-resolution helpers
- AST walking primitives
- compact storage helpers for symbols or nodes

No Rust implementation should start until a candidate is supported by profile data.

### Phase 3 — Rust prototype

Implement the selected operation in Rust as a standalone benchmark first.

Compare three cases:

1. current Go implementation
2. behavior-equivalent Rust implementation without FFI
3. integrated Rust implementation including boundary/conversion cost, only if case 2 is promising

The standalone comparison prevents FFI overhead from hiding whether the implementation itself is better.

### Phase 4 — Semantic parity gate

For every benchmark input, verify:

- same exit status
- same diagnostic codes
- same diagnostic locations
- same normalized diagnostic text
- same emitted files where emission is enabled
- deterministic results across repeated runs

A performance result fails the experiment if semantic parity fails.

### Phase 5 — Decision record

Publish one of four conclusions:

- **Adopt candidate** — material end-to-end gain with acceptable complexity.
- **Keep as optional accelerator** — useful only for specific workloads.
- **Do not integrate** — standalone gain is consumed by boundary or maintenance cost.
- **Hypothesis rejected** — no repeatable material gain.

A negative result is still valuable and should be documented.

## Metrics

| Dimension | Primary metric | Supporting metrics |
|---|---|---|
| Speed | median wall-clock time | p95, min/max, variance |
| Memory | peak RSS | allocations, bytes allocated |
| Correctness | diagnostics/output parity | exit codes, hashes, file lists |
| Scaling | speedup by checker/core count | CPU utilization |
| Integration cost | end-to-end gain | conversion time, binary size, build time |
| Maintainability | change surface | unsafe code, FFI API size, test burden |

## Initial acceptance criteria

A candidate is worth deeper integration work only when all of the following are true:

- diagnostics and outputs remain equivalent
- the result is repeatable across at least three benchmark shapes
- the standalone candidate improves its measured hot path materially
- the end-to-end compiler result improves by at least 5% or peak memory improves by at least 10%
- variance does not increase enough to make CI performance less predictable
- the implementation does not require broad type-checker duplication

These thresholds are experiment gates, not claims about what production maintainers should accept.

## Repository deliverables

- `results/performance/baseline-<date>.json`
- `results/performance/baseline-<date>.md`
- machine-readable environment metadata
- benchmark corpus manifest
- profiling notes and flamegraph references
- parity hashes for diagnostics and emitted output
- Rust prototype source after the hot path is selected
- final architecture decision record

## First milestone

1. Upgrade the current benchmark runner from single measurements to repeated structured measurements.
2. Add environment and compiler-version capture.
3. Add cold/warm labeling and statistical summary.
4. Add diagnostic/output hashing.
5. Run the baseline before selecting any Rust target.

## Success definition

The project succeeds when it produces credible evidence about **where Rust helps, where it does not, and why**. A narrowly scoped negative result is more useful than an unverified full-rewrite claim.
