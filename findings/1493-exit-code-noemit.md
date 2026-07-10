# Finding: exit code mismatch for `--noEmit`

- Issue: https://github.com/microsoft/typescript-go/issues/1493
- Status: confirmed on TypeScript 7.0.2 stable / active upstream fix
- Related PR: https://github.com/microsoft/typescript-go/pull/4407
- Stable evidence: [full report](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/results/2026-07-10-typescript-7-stable-full.md), [workflow run 29120482675](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29120482675)
- Platforms: Ubuntu, Windows, macOS

## Summary

A minimal project with a TypeScript type error produced equivalent diagnostic codes and equivalent text after CRLF/LF normalization, but different process exit codes when run with `--noEmit`.

Pinned stable comparison:

- classic TypeScript 6.0.3 returned: `2`
- TypeScript 7.0.2 returned: `1`

The same result reproduced across all three GitHub-hosted operating systems. This confirms that the finding was not limited to an RC package.

## Evidence provenance

The exact stable versions were validated in the separate pinned harness [`safal207/typescript-7-rc-qa-benchmark#11`](https://github.com/safal207/typescript-7-rc-qa-benchmark/pull/11), which verifies that `tsc6` selects 6.0.3 and `tsc` selects 7.0.2 before collecting evidence.

This repository's local repro remains useful for continuous preview checks, but its `latest` dependencies are not the source of the dated exact-version claim.

## Scenario

- TypeScript source contains a type error
- Compilation is run with `--noEmit`
- Same source files
- Same tsconfig / equivalent settings
- Diagnostic codes and normalized text are compared independently from process status

## Why it matters

Exit codes are consumed by:

- CI/CD pipelines
- shell automation
- wrapper tools
- custom compiler integrations

A mismatch can create false assumptions during migration or break compatibility with existing automation.

## Actual result

TypeScript 7.0.2 does not preserve the same process-status behavior as classic TypeScript 6.0.3 in this scenario, even though the diagnostics match.

## Expected result

For this compatibility scenario, TypeScript 7 should preserve the meaningful CLI exit-status behavior expected by tools built around classic `tsc`, unless the compatibility contract is intentionally changed and documented.

## Root cause direction

The linked PR analysis shows that the visible `1` versus `2` difference is not best fixed by remapping the final process exit code.

The status derives from whether the compiler reports:

- `DiagnosticsPresent_OutputsSkipped` -> exit code `1`
- `DiagnosticsPresent_OutputsGenerated` -> exit code `2`

The incompatibility came from the `EmitSkipped` result in the `noEmit` path. The proposed fix ports shared `handleNoEmitOptions` semantics and applies them to both non-incremental and incremental program emit paths.

## Outcome

The issue was acknowledged and a fix PR was opened:

- PR #4407: Restore tsgo noEmit exit status semantics

The fix scope expanded beyond the original `Program.Emit` path and covers:

- shared `noEmit` handling
- non-incremental program emit
- incremental whole-program emit
- build baselines
- watch baselines
- a tsc command-line regression test for `noEmit` with a type error

This means the finding is being treated as a broader compiler compatibility issue, not as a superficial numeric exit-code patch.

Additional maintainer review context:
- [`../docs/1493-review-notes.md`](../docs/1493-review-notes.md)

## Upstream publication status

An attempt to post the stable cross-platform confirmation through the connected GitHub integration returned HTTP 403. The reviewed [comment draft](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/upstream/1493-stable-follow-up.md) is preserved for an account with upstream comment permission.

## Next action

1. Retry the stable evidence comment upstream with sufficient permission.
2. Re-run the same pinned compatibility scenario after PR #4407 lands.
3. Compare diagnostics and process status independently again.

## QA significance

This finding demonstrates a useful compatibility-testing pattern:

1. Compare diagnostics and process status independently.
2. Treat exit codes as part of the public CLI contract.
3. Reproduce on multiple operating systems.
4. Pin and verify compiler identities before publication.
5. Follow the finding through maintainer review to verify that the fix aligns with upstream compiler semantics.

## Repro

See: [`../repros/exit-code-noemit`](../repros/exit-code-noemit)
