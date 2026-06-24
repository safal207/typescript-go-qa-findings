# Finding: exit code mismatch for `--noEmit`

- Issue: https://github.com/microsoft/typescript-go/issues/1493
- Status: confirmed / PR under maintainer review
- Related PR: https://github.com/microsoft/typescript-go/pull/4407

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

## Outcome

The issue was acknowledged and a fix PR was opened:

- PR #4407: Restore tsgo exit code for noEmit type errors

## Repro

See: [`../repros/exit-code-noemit`](../repros/exit-code-noemit)
