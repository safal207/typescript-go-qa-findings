# Upstream watch

This file tracks current upstream state for findings reported or referenced from this repository.

## Evidence modes

- **Pinned stable evidence:** exact TypeScript 6.0.3 versus TypeScript 7.0.2 results come from [`safal207/typescript-7-rc-qa-benchmark#11`](https://github.com/safal207/typescript-7-rc-qa-benchmark/pull/11), which verifies compiler selection before measurement.
- **Continuous preview lane:** this repository intentionally installs moving `latest` packages for ongoing regression detection. Its local scripts do not by themselves reproduce historical exact-version claims.

## #1493 — `--noEmit` exit-code compatibility

- Issue: https://github.com/microsoft/typescript-go/issues/1493
- PR: https://github.com/microsoft/typescript-go/pull/4407
- Current stable status: reproduced with TypeScript 7.0.2 on Ubuntu, Windows, and macOS
- Stable result: diagnostic codes and normalized text match classic TypeScript 6.0.3, but the process status remains `2` vs `1`
- Evidence: [full report](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/results/2026-07-10-typescript-7-stable-full.md), [workflow run 29120482675](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29120482675)
- Publication status: an attempt to post the stable confirmation upstream was blocked by HTTP 403 from the connected integration; a reviewed [comment draft](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/upstream/1493-stable-follow-up.md) is preserved
- Next local action: retry the upstream comment with an account that has permission, then re-test after PR #4407 lands

### Why it matters

The original visible symptom was an exit-code mismatch:

- classic `tsc --noEmit` with diagnostics returned `2`
- TypeScript 7.0.2 returned `1`

The linked fix later expanded into shared `noEmit` handling, `EmitSkipped`, incremental emit, builder, and watch baselines.

This makes the finding a broader compiler compatibility case rather than a superficial process-status mismatch. The stable reproduction confirms that it was not limited to an RC package.

## #4435 — `tsconfig` extends + `baseUrl` + wildcard `paths`

- Issue: https://github.com/microsoft/typescript-go/issues/4435
- Current upstream status: closed as **Working As Intended**
- Maintainer conclusion: the behavioral difference is expected because `baseUrl` is removed in TypeScript 7
- Next local action: keep the repro as TypeScript 6→7 migration evidence, but do not track it as an unresolved compiler regression

### Why it matters

The same inherited config scenario produced different diagnostics and different exit codes between classic TypeScript 6 and TypeScript 7.

The upstream decision clarifies that this is an intentional version-boundary difference rather than a parity defect. The repro remains useful for migration tooling and teams that still rely on `baseUrl`, but it should be classified as an expected breaking change.

## #4406 — benchmark observation

- Issue: https://github.com/microsoft/typescript-go/issues/4406
- Current local status: closed as completed
- Checker-scaling follow-up: the separate [run 29121518759](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29121518759) passed on Ubuntu, Windows, and macOS
- Full stable evidence: the 15-round TypeScript 7.0.2 profile is published in the [dated report](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/results/2026-07-10-typescript-7-stable-full.md)
- Next local action: preserve the evidence and re-run only for a new compiler release, material workflow change, or targeted regression hypothesis
