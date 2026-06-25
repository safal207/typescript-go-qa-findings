# TypeScript Go QA Findings

[![QA checks](https://github.com/safal207/typescript-go-qa-findings/actions/workflows/qa-checks.yml/badge.svg)](https://github.com/safal207/typescript-go-qa-findings/actions/workflows/qa-checks.yml)

Independent QA validation of the Go-based TypeScript compiler (`typescript-go`) against classic TypeScript (`tsc`).

This repository collects:
- reproducible compatibility findings
- CLI behavior checks
- benchmark observations
- regression scenarios for RC builds
- issue / PR references for confirmed findings

The goal is to validate whether `typescript-go` is production-safe for real projects, CI pipelines, and existing TypeScript workflows.

---

## Scope

This repository compares classic TypeScript and `typescript-go` in several areas:

- exit codes
- diagnostics parity
- `--noEmit` behavior
- `noEmitOnError`
- declaration emit
- project references
- tsconfig inheritance / path alias behavior
- benchmark behavior on different project shapes
- CLI compatibility for CI-oriented scenarios

---

## Current findings

| ID | Topic | Status | Result |
|---|---|---:|---|
| [#1493](https://github.com/microsoft/typescript-go/issues/1493) | `--noEmit` exit code mismatch | confirmed / active maintainer review via [PR #4407](https://github.com/microsoft/typescript-go/pull/4407) | `tsc` returned exit code `2`, `typescript-go` returned `1`; review expanded the fix across shared `noEmit`, incremental, builder, and watch semantics |
| [#4435](https://github.com/microsoft/typescript-go/issues/4435) | `tsconfig` extends + `baseUrl` + wildcard `paths` mismatch | reported upstream | `tsc` and `typescript-go` produced different diagnostics and different exit codes for the same config scenario |
| [#4406](https://github.com/microsoft/typescript-go/issues/4406) | benchmark observation | completed | benchmark feedback accepted; maintainer suggested trying `--checkers` tuning |

---

## Impact

This repository is not only a collection of test cases. It is intended as a small compatibility lab for validating whether `typescript-go` can safely replace classic `tsc` in real projects.

So far, the work has already produced upstream-facing results:

- **Issue #1493** — exit-code mismatch for `--noEmit` type-error scenarios, now addressed by an active fix PR under maintainer review
- **Issue #4435** — different diagnostics and exit-code behavior for a `tsconfig` scenario using `extends`, `baseUrl`, and wildcard `paths`

These findings matter because they affect:

- CI/CD pipelines
- shell automation
- developer tooling wrappers
- migration safety for existing TypeScript projects
- monorepo and configuration-heavy codebases

The goal of this repository is to make such differences reproducible, visible, and easy to validate across future RC builds.

---

## Findings

### 1) Exit code mismatch with `--noEmit`

- Issue: [microsoft/typescript-go#1493](https://github.com/microsoft/typescript-go/issues/1493)
- Related PR: [microsoft/typescript-go#4407](https://github.com/microsoft/typescript-go/pull/4407)
- Current PR state: open, mergeable, and under review by `jakebailey` and `andrewbranch`

A minimal project with a type error and `--noEmit` produced equivalent diagnostics in both compilers, but different process exit codes:

- `tsc` -> exit code `2`
- `typescript-go` RC -> exit code `1`

This matters because exit codes are part of the CLI contract used by CI pipelines, shell scripts, wrappers, and automation.

The maintainer review showed that the finding was deeper than a final numeric exit-code mapping. The proposed fix now aligns shared `noEmit` handling across non-incremental and incremental program emit paths and updates builder/watch baselines to match classic `tsc` behavior.

See: [`findings/1493-exit-code-noemit.md`](./findings/1493-exit-code-noemit.md)

---

### 2) `tsconfig` extends + paths mismatch

- Issue: [microsoft/typescript-go#4435](https://github.com/microsoft/typescript-go/issues/4435)

A minimal config scenario using `extends`, `baseUrl`, and wildcard `paths` produced different diagnostics and a different exit code between classic `tsc` and `typescript-go`.

This matters because these configuration patterns are common in frontend apps, backend services, and monorepos, and a mismatch can create migration friction for existing TypeScript projects.

See: [`findings/tsconfig-paths-extends-exit-diagnostics.md`](./findings/tsconfig-paths-extends-exit-diagnostics.md)

---

### 3) Benchmark observation

- Issue: [microsoft/typescript-go#4406](https://github.com/microsoft/typescript-go/issues/4406)

Benchmark results were shared with the TypeScript team. The issue was closed as completed, and maintainer feedback suggested trying larger `--checkers` values depending on project shape.

See: [`findings/4406-benchmark-observation.md`](./findings/4406-benchmark-observation.md)

---

## Reproduction

### Exit code scenario

See: [`repros/exit-code-noemit`](./repros/exit-code-noemit)

Commands:

```bash
npm run test:exit-tsc
npm run test:exit-tsgo
npm run compare:exit
```

### `noEmitOnError` scenario

See: [`repros/noemit-on-error`](./repros/noemit-on-error)

Command:

```bash
npm run compare:noemit-on-error
```

This scenario checks whether a type-error build with `noEmitOnError: true` preserves compatible CLI behavior between classic `tsc` and `typescript-go`.

### Declaration emit scenario

See: [`repros/declaration-emit`](./repros/declaration-emit)

Command:

```bash
npm run compare:declaration-emit
```

This scenario compares exit code and emitted `.d.ts` output for a small exported API surface using interfaces, union types, generics, and a class.

### Project references scenario

See: [`repros/project-references`](./repros/project-references)

Command:

```bash
npm run compare:project-references
```

This scenario compares build-mode behavior for a mini-monorepo where `app` depends on `core` through TypeScript project references.

### `tsconfig` extends / paths scenario

See: [`repros/tsconfig-paths-extends`](./repros/tsconfig-paths-extends)

Command:

```bash
npm run compare:tsconfig-extends
```

This scenario compares classic `tsc` and `typescript-go` behavior for a config that uses inherited compiler options, `baseUrl`, and wildcard path aliases.

### Benchmark checkers scenario

See: [`repros/benchmark-sample`](./repros/benchmark-sample)

Command:

```bash
npm run benchmark:checkers
```

This scenario runs a small type-heavy benchmark sample against classic `tsc` and `typescript-go` with several `--checkers` values.

---

## Continuous QA

GitHub Actions runs the current compatibility checks on push, pull request, and manual workflow dispatch.

The workflow stores command outputs as artifacts:

- `results/ci/*.txt`
- `results/benchmark/*.md`

This makes the repository useful as a lightweight regression lab rather than a static notes archive.

---

## Planned regression scenarios

- diagnostics parity checks
- incremental build behavior
- watch mode checks
- fix / stabilize the declaration emit scenario

See: [`docs/roadmap.md`](./docs/roadmap.md)

---

## Why this repository exists

TypeScript compiler changes at this scale are not just about raw speed.
They affect:

- developer experience
- build stability
- CI behavior
- migration safety
- tooling compatibility

This repository documents those differences with reproducible evidence.
