# Review notes for issue #1493 / PR #4407

## Context

Issue: https://github.com/microsoft/typescript-go/issues/1493  
PR: https://github.com/microsoft/typescript-go/pull/4407

This note captures the maintainer discussion around the exit-code compatibility fix for `--noEmit` type errors.

## Current PR state

At the latest check, PR #4407 is:

- open
- mergeable
- non-draft
- under requested review from `jakebailey` and `andrewbranch`

The PR title is **Restore tsgo noEmit exit status semantics**.

## Review thread summary

During review, **jakebailey** challenged the initial narrow approach and requested that the solution be reconsidered rather than implemented as a final exit-code mapping workaround.

**weswigham** then pointed out that the same semantics also needed to be reflected in incremental emit behavior.

The implementation was subsequently reworked around shared `noEmit` handling rather than a CLI-only patch.

A later semantic question focused on the status naming used for the `--noEmit` path: if no files are physically emitted, why does the resulting status still correspond to an `OutputsGenerated` path?

The PR analysis explains that this mirrors classic `tsc` behavior for the whole-program `--noEmit` scenario. Even when normal output files are not written, the compiler follows the compatible status path that yields `DiagnosticsPresent_OutputsGenerated`, preserving process exit code `2`.

## Scope expanded

The fix scope expanded beyond the initial single-path `Program.Emit` case.

PR #4407 now covers:

- shared `HandleNoEmitOptions` logic
- non-incremental `Program.Emit`
- incremental whole-program emit
- build-info-aware handling
- `tsc/noEmit` baselines
- `tsbuild/noEmit` baselines
- `tsbuildWatch/noEmit` baselines
- a command-line regression test for `noEmit` with a type error

This suggests the finding is being handled as a broader compatibility issue across compiler modes, not only as a local exit-code mapping.

## Why this matters

This is important because it shows the fix is being reviewed against **baseline TypeScript CLI behavior**, not only against the visible numeric exit code.

In other words, the discussion is not just:

- “should the number be 1 or 2?”

It is also:

- “what internal compiler outcome should map to the same public CLI contract as classic `tsc`?”

That makes the finding stronger from a QA perspective:

- it is a real compatibility issue
- it affects CI / automation expectations
- the fix is being aligned with `tsc` semantics rather than patched superficially
- the impact reaches multiple compiler modes
- regression coverage is being added at the compiler command-line and baseline levels

## Repository note

The main finding is documented in:
- [`../findings/1493-exit-code-noemit.md`](../findings/1493-exit-code-noemit.md)
