# Performance workload matrix

The performance lab uses generated, deterministic TypeScript projects instead of relying on one synthetic source file.

## Workload shapes

| Workload | Default size | Intended pressure |
|---|---:|---|
| `many-small-files` | 181 source files | filesystem traversal, parser startup, module graph construction |
| `few-large-files` | 5 source files | scanner throughput, parser throughput, large AST allocation |
| `type-heavy` | 50 source files | conditional and mapped types, symbol lookup, checker scaling |
| `module-resolution-heavy` | 217 source files | path normalization, aliases, module resolution, graph construction |

The files are generated under `.bench-workloads/` and are not committed. `BENCH_FIXTURE_SCALE` multiplies the principal size of each workload.

## Commands

Generate fixtures:

```bash
npm run benchmark:fixtures
```

Run the full statistical matrix:

```bash
npm run benchmark:matrix
```

Use a smaller checker matrix or select workloads:

```bash
BENCH_CHECKERS=1,4 \
BENCH_MATRIX_WORKLOADS=many-small-files,module-resolution-heavy \
BENCH_WARMUPS=1 \
BENCH_ITERATIONS=5 \
npm run benchmark:matrix
```

Capture native Go profiles from `tsgo`:

```bash
PROFILE_WORKLOAD=module-resolution-heavy \
PROFILE_CHECKERS=4 \
npm run profile:tsgo
```

The profiler uses the compiler's internal `--pprofDir` option and writes:

- compressed CPU profile
- compressed allocation profile
- `go tool pprof` CPU top report
- allocation-space top report
- machine-readable metadata
- Markdown summary

## Candidate selection protocol

A component becomes a Rust prototype candidate only if it satisfies all of these conditions:

1. It is materially visible in CPU or allocation profiles.
2. It appears in more than one relevant workload, or dominates one commercially important shape.
3. It has a narrow input/output contract suitable for golden parity tests.
4. It can be benchmarked standalone before introducing FFI.
5. It is application work rather than merely a Go runtime, scheduler, garbage collector, or profiling frame.
6. A plausible end-to-end gain remains after data conversion and boundary costs.

## Interpretation limits

Generated workloads isolate project shape; they do not represent the full diversity of production repositories. Results must be supplemented by at least one real open-source project before making architectural claims.

The fastest checker count may vary by workload and machine. The matrix reports both the fastest valid configuration and the lowest-memory valid configuration instead of assuming one global setting.
