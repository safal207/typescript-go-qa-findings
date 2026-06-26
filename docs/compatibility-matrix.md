# Compatibility matrix

This matrix tracks current `tsc` vs `typescript-go` compatibility checks in this repository.

| Scenario | classic `tsc` | `typescript-go` | Status | Upstream reference | Notes |
|---|---:|---:|---|---|---|
| `--noEmit` with type error | exit `2` | exit `1` | Confirmed / fix under review | [#1493](https://github.com/microsoft/typescript-go/issues/1493), [PR #4407](https://github.com/microsoft/typescript-go/pull/4407) | The fix scope expanded into shared `noEmit`, `EmitSkipped`, incremental, builder, and watch semantics. |
| `tsconfig` extends + `baseUrl` + wildcard `paths` | `TS5101`, exit `2` | `TS5102` + `TS5090`, exit `1` | Reported upstream | [#4435](https://github.com/microsoft/typescript-go/issues/4435) | Different diagnostics and different process status for the same inherited config scenario. |
| `noEmitOnError` type-error build | Under comparison | Under comparison | Local regression scenario | local repro | Checks whether failed builds preserve compatible CLI behavior and output safety. |
| Declaration emit | Under comparison | Under comparison | Local regression scenario | local repro | Compares `.d.ts` output, diagnostics, and exit status for a small exported API. |
| Project references | Under comparison | Under comparison | Local regression scenario | local repro | Compares build-mode behavior for a mini-monorepo using TypeScript project references. |
| Benchmark checkers | baseline | checkers matrix | Completed / follow-up possible | [#4406](https://github.com/microsoft/typescript-go/issues/4406) | Maintainer feedback suggested trying larger `--checkers` values depending on workload shape. |
| Incremental build | Planned | Planned | Planned | none yet | Important because PR #4407 showed that non-incremental and incremental behavior can diverge. |
| Watch mode | Planned | Planned | Planned | none yet | Important for developer workflow parity and live diagnostics behavior. |

## Current upstream watch

- [#1493 / PR #4407](https://github.com/microsoft/typescript-go/pull/4407): waiting for upstream PR to become mergeable and land. Next action: re-test on nightly / next RC after merge.
- [#4435](https://github.com/microsoft/typescript-go/issues/4435): watch for maintainer response, labels, linked PRs, or requests for additional reproduction data.
- [#4406](https://github.com/microsoft/typescript-go/issues/4406): closed as completed. Possible follow-up: rerun benchmarks with a larger `--checkers` matrix.

## How to read this matrix

A scenario is considered meaningful when it compares at least one of the following:

- process exit code
- diagnostic code / diagnostic text
- emitted output
- build/watch behavior
- benchmark result under a documented workload shape

The goal is not only to find failures, but to identify where TypeScript Go behavior diverges from the public CLI contract that existing tools and CI workflows depend on.
