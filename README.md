# TypeScript Go QA Findings

[![QA checks](https://github.com/safal207/typescript-go-qa-findings/actions/workflows/qa-checks.yml/badge.svg)](https://github.com/safal207/typescript-go-qa-findings/actions/workflows/qa-checks.yml)

Independent QA validation of the Go-based TypeScript compiler (`typescript-go`) against classic TypeScript (`tsc`).

This repository collects:
- reproducible compatibility findings
- CLI behavior checks
- benchmark observations
- regression scenarios for preview and stable builds
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

See the full scenario overview in [`docs/compatibility-matrix.md`](./docs/compatibility-matrix.md) and current upstream tracking in [`docs/upstream-watch.md`](./docs/upstream-watch.md).

---

## Current findings

| ID | Topic | Status | Result |
|---|---|---:|---|
| [#1493](https://github.com/microsoft/typescript-go/issues/1493) | `--noEmit` exit code mismatch | confirmed on TypeScript 7.0.2 stable / active fix via [PR #4407](https://github.com/microsoft/typescript-go/pull/4407) | reproduced on Ubuntu, Windows, and macOS: diagnostic codes and normalized text match, but classic TypeScript exits `2` and TypeScript 7 exits `1` |
| [#4435](https://github.com/microsoft/typescript-go/issues/4435) | `tsconfig` extends + `baseUrl` + wildcard `paths` difference | closed / Working As Intended | the diagnostics and exit-code difference is expected because `baseUrl` is removed in TypeScript 7; retained as migration evidence rather than an unresolved regression |
| [#4406](https://github.com/microsoft/typescript-go/issues/4406) | benchmark observation | completed | benchmark feedback accepted; maintainer suggested trying `--checkers` tuning, the broader local matrix was implemented, and the stable smoke matrix passed on all three CI operating systems |

---

## Impact

This repository is not only a collection of test cases. It is intended as a small compatibility lab for validating whether `typescript-go` can safely replace classic `tsc` in real projects.

So far, the work has already produced upstream-facing results:

- **Issue #1493** — a real exit-code compatibility defect for `--noEmit` type-error scenarios, confirmed again on TypeScript 7.0.2 stable across Ubuntu, Windows, and macOS
- **Issue #4435** — a reproducible configuration difference that maintainers classified as intentional because `baseUrl` is removed in TypeScript 7
- **Issue #4406** — an independent cross-platform benchmark accepted as useful feedback, followed by larger checker-scaling and stable smoke experiments

These cases matter because they affect:

- CI/CD pipelines
- shell automation
- developer tooling wrappers
- migration safety for existing TypeScript projects
- monorepo and configuration-heavy codebases

The goal is to make both defects and intentional version-boundary changes reproducible, visible, and easy to interpret across future TypeScript releases.

---

## Findings

### 1) Exit code mismatch with `--noEmit`

- Issue: [microsoft/typescript-go#1493](https://github.com/microsoft/typescript-go/issues/1493)
- Related PR: [microsoft/typescript-go#4407](https://github.com/microsoft/typescript-go/pull/4407)
- Current state: reproduced on TypeScript 7.0.2 stable on Ubuntu, Windows, and macOS; the issue and fix PR remain open

A minimal project with a type error and `--noEmit` produces equivalent diagnostic codes and equivalent text after CRLF/LF normalization, but different process exit codes:

- classic TypeScript 6.0.3 -> exit code `2`
- TypeScript 7.0.2 -> exit code `1`

This matters because exit codes are part of the CLI contract used by CI pipelines, shell scripts, wrappers, and automation.

The maintainer review showed that the finding was deeper than a final numeric exit-code mapping. The proposed fix aligns shared `noEmit` handling across non-incremental and incremental program emit paths and updates builder/watch baselines to match classic `tsc` behavior.

The stable cross-platform reproduction confirms that the finding was not limited to an RC package. The next action is to share the stable evidence upstream and re-test after PR #4407 lands.

See: [`findings/1493-exit-code-noemit.md`](./findings/1493-exit-code-noemit.md)

---

### 2) `tsconfig` extends + paths migration difference

- Issue: [microsoft/typescript-go#4435](https://github.com/microsoft/typescript-go/issues/4435)
- Upstream resolution: closed as **Working As Intended**

A minimal config scenario using `extends`, `baseUrl`, and wildcard `paths` produced different diagnostics and a different exit code between classic TypeScript 6 and TypeScript 7.

The maintainer response clarified that this difference is expected because `baseUrl` is removed in TypeScript 7. The scenario therefore remains valuable as a migration test and documentation case, but it is no longer classified as an unresolved compiler regression.

See: [`findings/tsconfig-paths-extends-exit-diagnostics.md`](./findings/tsconfig-paths-extends-exit-diagnostics.md)

---

### 3) Benchmark observation

- Issue: [microsoft/typescript-go#4406](https://github.com/microsoft/typescript-go/issues/4406)

Benchmark results were shared with the TypeScript team. The issue was closed as completed, and maintainer feedback suggested trying larger `--checkers` values depending on project shape. That follow-up was implemented locally as a broader checker-scaling matrix.

The TypeScript 7.0.2 stable smoke and checker-scaling workflows subsequently passed on Ubuntu, Windows, and macOS. A configurable full-profile run remains the gate before publishing final stable performance ranges.

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

This scenario preserves the TypeScript 6 to TypeScript 7 migration boundary for inherited compiler options, `baseUrl`, and wildcard path aliases.

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

- post-fix re-test of `--noEmit` exit behavior
- diagnostics parity checks
- incremental build behavior
- watch mode checks
- fix / stabilize the declaration emit scenario
- full stable performance evidence profile

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

This repository documents those differences with reproducible evidence and separates true compatibility defects from intentional language and configuration changes.
