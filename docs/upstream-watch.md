# Upstream watch

This file tracks current upstream state for findings reported or referenced from this repository.

## #1493 — `--noEmit` exit-code compatibility

- Issue: https://github.com/microsoft/typescript-go/issues/1493
- PR: https://github.com/microsoft/typescript-go/pull/4407
- Current local status: waiting for upstream PR to become mergeable and land
- Next local action: re-test after merge or after the next nightly / RC build includes the fix

### Why it matters

The original visible symptom was an exit-code mismatch:

- classic `tsc --noEmit` with diagnostics returned `2`
- `typescript-go --noEmit` returned `1`

The linked fix later expanded into shared `noEmit` handling, `EmitSkipped`, incremental emit, builder, and watch baselines.

This makes the finding a broader compiler compatibility case rather than a superficial process-status mismatch.

## #4435 — `tsconfig` extends + `baseUrl` + wildcard `paths`

- Issue: https://github.com/microsoft/typescript-go/issues/4435
- Current local status: reported upstream
- Next local action: watch for maintainer response, labels, linked PRs, or requests for additional repro data

### Why it matters

The same inherited config scenario produced different diagnostics and different exit codes between classic `tsc` and `typescript-go`.

These config patterns are common in real-world frontend apps, backend services, and monorepos, so mismatches here directly affect migration safety.

## #4406 — benchmark observation

- Issue: https://github.com/microsoft/typescript-go/issues/4406
- Current local status: closed as completed
- Possible follow-up: rerun benchmarks with larger `--checkers` values and a broader workload matrix
