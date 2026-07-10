# Compatibility matrix

This matrix tracks current `tsc` vs `typescript-go` compatibility checks in this repository.

| Scenario | classic `tsc` | `typescript-go` | Status | Upstream reference | Notes |
|---|---:|---:|---|---|---|
| `--noEmit` with type error | exit `2` | exit `1` | Confirmed on TypeScript 7.0.2 stable / fix under review | [#1493](https://github.com/microsoft/typescript-go/issues/1493), [PR #4407](https://github.com/microsoft/typescript-go/pull/4407) | Reproduced on Ubuntu, Windows, and macOS. Diagnostic codes and normalized text match; process status differs. The fix scope includes shared `noEmit`, incremental, builder, and watch semantics. |
| `tsconfig` extends + `baseUrl` + wildcard `paths` | `TS5101`, exit `2` | `TS5102` + `TS5090`, exit `1` | Expected version-boundary difference | [#4435](https://github.com/microsoft/typescript-go/issues/4435) | Closed as Working As Intended because `baseUrl` is removed in TypeScript 7. Keep as migration evidence, not an unresolved regression. |
| `noEmitOnError` type-error build | Under comparison | Under comparison | Local regression scenario | local repro | Checks whether failed builds preserve compatible CLI behavior and output safety. |
| Declaration emit | Under comparison | Under comparison | Local regression scenario | local repro | Compares `.d.ts` output, diagnostics, and exit status for a small exported API. |
| Project references | Under comparison | Under comparison | Local regression scenario | local repro | Compares build-mode behavior for a mini-monorepo using TypeScript project references. |
| Benchmark checkers | baseline | checkers matrix | Stable cross-platform smoke completed | [#4406](https://github.com/microsoft/typescript-go/issues/4406) | The larger `--checkers` follow-up was implemented and the TypeScript 7.0.2 matrix passed on Ubuntu, Windows, and macOS. A full-profile run is still required before publishing final stable ranges. |
| Incremental build | Planned | Planned | Planned | none yet | Important because PR #4407 showed that non-incremental and incremental behavior can diverge. |
| Watch mode | Planned | Planned | Planned | none yet | Important for developer workflow parity and live diagnostics behavior. |

## Current upstream watch

- [#1493 / PR #4407](https://github.com/microsoft/typescript-go/pull/4407): both remain open. The mismatch reproduces on TypeScript 7.0.2 stable across Ubuntu, Windows, and macOS; next action is an upstream evidence update and post-fix re-test.
- [#4435](https://github.com/microsoft/typescript-go/issues/4435): closed as Working As Intended; the difference is expected because `baseUrl` is removed in TypeScript 7.
- [#4406](https://github.com/microsoft/typescript-go/issues/4406): closed as completed; the requested larger `--checkers` follow-up and stable smoke matrix were completed locally.

## How to read this matrix

A scenario is considered meaningful when it compares at least one of the following:

- process exit code
- diagnostic code / diagnostic text
- emitted output
- build/watch behavior
- benchmark result under a documented workload shape

The goal is not only to find failures, but to distinguish true CLI-contract regressions from intentional TypeScript 7 migration changes and to preserve reproducible evidence for both.
