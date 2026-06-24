# Review notes for issue #1493 / PR #4407

## Context

Issue: https://github.com/microsoft/typescript-go/issues/1493  
PR: https://github.com/microsoft/typescript-go/pull/4407

This note captures the maintainer discussion around the exit-code compatibility fix for `--noEmit` type errors.

## Review thread summary

During review of PR #4407, **jakebailey** raised a semantic question about the status naming used for the `--noEmit` path: if no files are physically emitted, why does the resulting status still correspond to an `OutputsGenerated` path?

**Copilot** replied that this mirrors classic `tsc` behavior for the whole-program `--noEmit` scenario. Even though no files are written, the compiler still follows the exit-status path that leads to `DiagnosticsPresent_OutputsGenerated`, which is why the compatible exit code remains `2`.

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

## Repository note

The main finding is documented in:
- [`../findings/1493-exit-code-noemit.md`](../findings/1493-exit-code-noemit.md)
