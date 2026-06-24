# TypeScript Go QA Findings

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
- benchmark behavior on different project shapes
- CLI compatibility for CI-oriented scenarios

---

## Current findings

| ID | Topic | Status | Result |
|---|---|---:|---|
| [#1493](https://github.com/microsoft/typescript-go/issues/1493) | `--noEmit` exit code mismatch | confirmed / fix in progress | `tsc` returned exit code `2`, `typescript-go` returned `1` for the same type-error scenario |
| [#4406](https://github.com/microsoft/typescript-go/issues/4406) | benchmark observation | completed | benchmark feedback accepted; maintainer suggested trying `--checkers` tuning |

---

## Findings

### 1) Exit code mismatch with `--noEmit`

- Issue: [microsoft/typescript-go#1493](https://github.com/microsoft/typescript-go/issues/1493)
- Related PR: [microsoft/typescript-go#4407](https://github.com/microsoft/typescript-go/pull/4407)

A minimal project with a type error and `--noEmit` produced equivalent diagnostics in both compilers, but different process exit codes:

- `tsc` -> exit code `2`
- `typescript-go` RC -> exit code `1`

This matters because exit codes are part of the CLI contract used by CI pipelines, shell scripts, wrappers, and automation.

See: [`findings/1493-exit-code-noemit.md`](./findings/1493-exit-code-noemit.md)

---

### 2) Benchmark observation

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

---

## Planned regression scenarios

- declaration emit parity
- project references (`tsc -b`)
- diagnostics parity checks
- `extends` / `paths` / `baseUrl`
- incremental build behavior
- watch mode checks
- benchmark matrix with multiple `--checkers` values

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
