# Upstream watch

This file tracks current upstream state for findings reported or referenced from this repository.

## #1493 — `--noEmit` exit-code compatibility

- Issue: https://github.com/microsoft/typescript-go/issues/1493
- PR: https://github.com/microsoft/typescript-go/pull/4407
- Current local status: reproduced with TypeScript 7.0.2 stable on Ubuntu, Windows, and macOS
- Stable result: diagnostic codes and normalized text match classic TypeScript 6.0.3, but the process status remains `2` vs `1`
- Next local action: share the stable cross-platform confirmation upstream, then re-test after the fix lands

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
- Next local action: keep the repro as migration evidence, but do not track it as an unresolved compiler regression

### Why it matters

The same inherited config scenario produced different diagnostics and different exit codes between classic TypeScript 6 and TypeScript 7.

The upstream decision clarifies that this is an intentional version-boundary difference rather than a parity defect. The repro remains useful for migration tooling and teams that still rely on `baseUrl`, but it should be classified as an expected breaking change.

## #4406 — benchmark observation

- Issue: https://github.com/microsoft/typescript-go/issues/4406
- Current local status: closed as completed
- Follow-up completed locally: a broader `--checkers` scaling matrix was added after maintainer feedback
- Stable smoke follow-up: TypeScript 7.0.2 completed both QA and checker-scaling matrices successfully on Ubuntu, Windows, and macOS
- Possible next action: run the configurable full stable evidence profile before publishing final stable performance ranges
