# Roadmap

A prioritized roadmap for turning this repository into a practical TypeScript Go compatibility lab.

| Priority | Scenario | Why it matters | What to compare |
|---|---|---|---|
| P0 | `--noEmit` exit code | Already confirmed finding; critical for CI behavior | exit code, diagnostics |
| P0 | `noEmitOnError` | Build safety and output correctness | exit code, diagnostics, emitted files |
| P1 | diagnostics parity | Migration confidence | stdout/stderr, diagnostic codes, locations |
| P1 | declaration emit | Critical for libraries | `.d.ts` output, exit code, diagnostics |
| P1 | project references | Enterprise / monorepo relevance | build order, exit code, emitted files |
| P2 | `extends` in tsconfig | Common real-world config pattern | resolved options, diagnostics |
| P2 | `paths` / `baseUrl` | Common frontend/backend aliasing pattern | module resolution, diagnostics |
| P2 | incremental build | Performance and correctness | cache behavior, timings, output |
| P3 | watch mode | Developer experience | rebuild behavior, diagnostics updates |
| P3 | benchmark matrix with `--checkers` | Follows maintainer feedback in #4406 | elapsed time, project shape notes |

## Next recommended issues

1. Add `noEmitOnError` regression scenario
2. Add declaration emit comparison scenario
3. Add benchmark matrix with different `--checkers` values

## North star

Make every finding reproducible, understandable, and useful for maintainers, CI users, and teams evaluating `typescript-go` migration risk.
