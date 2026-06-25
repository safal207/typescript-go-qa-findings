# Finding: exit code mismatch for `--noEmit`

- Issue: https://github.com/microsoft/typescript-go/issues/1493
- Status: confirmed / active maintainer review
- Related PR: https://github.com/microsoft/typescript-go/pull/4407
- PR state: open, mergeable, non-draft
- Requested reviewers: `jakebailey`, `andrewbranch`

## Summary

A minimal project with a TypeScript type error produced equivalent diagnostics in both compilers, but different process exit codes when run with `--noEmit`.

- classic `tsc` returned: `2`
- `typescript-go` RC returned: `1`

## Scenario

- TypeScript source contains a type error
- Compilation is run with `--noEmit`
- Same source files
- Same tsconfig / equivalent settings

## Why it matters

Exit codes are consumed by:

- CI/CD pipelines
- shell automation
- wrapper tools
- custom compiler integrations

A mismatch can create false assumptions during migration or break compatibility with existing automation.

## Actual result

`typescript-go` did not preserve the same exit-code behavior as classic `tsc` in this scenario.

## Expected result

For this compatibility scenario, `typescript-go` should preserve the same meaningful CLI exit-code behavior as classic `tsc`.

## Root cause direction

The linked PR analysis shows that the visible `1` versus `2` difference was not best fixed by remapping the final process exit code.

The status derives from whether the compiler reports:

- `DiagnosticsPresent_OutputsSkipped` -> exit code `1`
- `DiagnosticsPresent_OutputsGenerated` -> exit code `2`

The incompatibility came from the wrong `EmitSkipped` result in the `noEmit` path. The proposed fix ports shared `handleNoEmitOptions` semantics and applies them to both non-incremental and incremental program emit paths.

## Outcome

The issue was acknowledged and a fix PR was opened:

- PR #4407: Restore tsgo noEmit exit status semantics

The fix scope expanded beyond the original `Program.Emit` path and now covers:

- shared `noEmit` handling
- non-incremental program emit
- incremental whole-program emit
- build baselines
- watch baselines
- a tsc command-line regression test for `noEmit` with a type error

This means the finding is being treated as a broader compiler compatibility issue, not as a superficial numeric exit-code patch.

Additional maintainer review context:
- [`../docs/1493-review-notes.md`](../docs/1493-review-notes.md)

## QA significance

This finding demonstrates a useful compatibility-testing pattern:

1. Compare diagnostics and process status independently.
2. Treat exit codes as part of the public CLI contract.
3. Reproduce on multiple operating systems.
4. Follow the finding through maintainer review to verify that the fix aligns with upstream compiler semantics.

## Repro

See: [`../repros/exit-code-noemit`](../repros/exit-code-noemit)
