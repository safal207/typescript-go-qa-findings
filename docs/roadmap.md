# Roadmap

A prioritized roadmap for turning this repository into a practical TypeScript Go compatibility and performance lab.

| Priority | Scenario | Why it matters | What to compare |
|---|---|---|---|
| P0 | `--noEmit` exit code | Already confirmed finding; critical for CI behavior | exit code, diagnostics |
| P0 | `noEmitOnError` | Build safety and output correctness | exit code, diagnostics, emitted files |
| P1 | diagnostics parity | Migration confidence | stdout/stderr, diagnostic codes, locations |
| P1 | declaration emit | Critical for libraries | `.d.ts` output, exit code, diagnostics |
| P1 | project references | Enterprise / monorepo relevance | build order, exit code, emitted files |
| P1 | statistical performance baseline | Prevent conclusions from single noisy runs | median, p95, variance, peak RSS, environment |
| P2 | `extends` in tsconfig | Common real-world config pattern | resolved options, diagnostics |
| P2 | `paths` / `baseUrl` | Common frontend/backend aliasing pattern | module resolution, diagnostics |
| P2 | incremental build | Performance and correctness | cache behavior, timings, output |
| P2 | profile-driven Rust hot-path experiment | Test whether an isolated Rust implementation adds real end-to-end value | profiles, parity, speed, memory, boundary cost |
| P3 | watch mode | Developer experience | rebuild behavior, diagnostics updates |
| P3 | benchmark matrix with `--checkers` | Follows maintainer feedback in #4406 | elapsed time, project shape notes |

## Next recommended issues

1. Upgrade the benchmark runner to repeated, machine-readable measurements.
2. Capture environment, compiler versions, cold/warm labels, and diagnostic hashes.
3. Build a workload matrix with several project shapes.
4. Profile `typescript-go` before selecting any Rust candidate.
5. Prototype only one isolated hot path and apply a strict semantic parity gate.

See [`rust-hotpath-experiment.md`](./rust-hotpath-experiment.md) for the experiment design and acceptance criteria.

## North star

Make every finding reproducible, understandable, and useful for maintainers, CI users, and teams evaluating `typescript-go` migration risk. Performance claims must be statistical, profile-driven, and subordinate to compiler compatibility.
