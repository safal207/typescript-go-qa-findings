# Compatibility matrix

This matrix tracks current `tsc` vs `typescript-go` compatibility checks in this repository.

Exact TypeScript 6.0.3 versus TypeScript 7.0.2 claims below come from the pinned external validation harness in [`safal207/typescript-7-rc-qa-benchmark#11`](https://github.com/safal207/typescript-7-rc-qa-benchmark/pull/11), not from this repository's moving `latest` preview dependencies. See the [full stable report](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/results/2026-07-10-typescript-7-stable-full.md).

| Scenario | classic TypeScript 6.0.3 | TypeScript 7.0.2 | Status | Upstream reference | Notes |
|---|---:|---:|---|---|---|
| `--noEmit` with type error | exit `2` | exit `1` | Confirmed on stable / fix under review | [#1493](https://github.com/microsoft/typescript-go/issues/1493), [PR #4407](https://github.com/microsoft/typescript-go/pull/4407) | Reproduced on Ubuntu, Windows, and macOS. Diagnostic codes and normalized text match; process status differs. Full evidence: [report](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/results/2026-07-10-typescript-7-stable-full.md), [run 29120482675](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29120482675). |
| `tsconfig` extends + `baseUrl` + wildcard `paths` | `TS5101`, exit `2` | `TS5102` + `TS5090`, exit `1` | Intentional TypeScript 6→7 boundary | [#4435](https://github.com/microsoft/typescript-go/issues/4435) | Closed as Working As Intended because `baseUrl` is removed in TypeScript 7. Keep as migration evidence, not an implementation-only incompatibility or unresolved regression. |
| `noEmitOnError` type-error build | Under comparison | Under comparison | Local preview regression scenario | local repro | Checks whether failed builds preserve compatible CLI behavior and output safety. Local execution follows the installed preview versions. |
| Declaration emit | Under comparison | Under comparison | Local preview regression scenario | local repro | Compares `.d.ts` output, diagnostics, and exit status for a small exported API. |
| Project references | Under comparison | Under comparison | Local preview regression scenario | local repro | Compares build-mode behavior for a mini-monorepo using TypeScript project references. |
| Benchmark checkers | classic baseline | `--checkers` matrix | Stable cross-platform evidence completed | [#4406](https://github.com/microsoft/typescript-go/issues/4406) | The larger checker-scaling follow-up passed on Ubuntu, Windows, and macOS in the separate [checker-scaling run 29121518759](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29121518759). The full stable performance report is also published. |
| Incremental build | Planned | Planned | Planned | none yet | Important because PR #4407 showed that non-incremental and incremental behavior can diverge. |
| Watch mode | Planned | Planned | Planned | none yet | Important for developer workflow parity and live diagnostics behavior. |

## Current upstream watch

- [#1493 / PR #4407](https://github.com/microsoft/typescript-go/pull/4407): both remain open. The mismatch reproduces on TypeScript 7.0.2 stable across Ubuntu, Windows, and macOS. An upstream comment attempt was blocked by HTTP 403 from the connected integration; the reviewed [comment draft](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/upstream/1493-stable-follow-up.md) is preserved for retry, followed by a post-fix re-test.
- [#4435](https://github.com/microsoft/typescript-go/issues/4435): closed as Working As Intended; the difference is expected because `baseUrl` is removed in TypeScript 7.
- [#4406](https://github.com/microsoft/typescript-go/issues/4406): closed as completed; checker scaling and the full TypeScript 7.0.2 stable evidence profile are complete.

## How to read this matrix

A scenario is considered meaningful when it compares at least one of the following:

- process exit code
- diagnostic code / diagnostic text
- emitted output
- build/watch behavior
- benchmark result under a documented workload shape

The goal is not only to find failures, but to distinguish true CLI-contract regressions from intentional TypeScript 7 migration changes and to preserve reproducible evidence for both. Version-specific publication claims must link to a pinned toolchain and immutable workflow evidence; the local `latest` lane is for continuous preview regression detection.
