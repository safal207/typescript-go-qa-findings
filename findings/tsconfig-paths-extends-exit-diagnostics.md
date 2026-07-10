# Finding: TypeScript 6→7 `tsconfig` migration difference

- Local repo issue: https://github.com/safal207/typescript-go-qa-findings/issues/5
- Upstream issue: https://github.com/microsoft/typescript-go/issues/4435
- Status: closed upstream as **Working As Intended**
- Classification: intentional TypeScript 6→7 version-boundary change / migration evidence
- Scenario: `extends` + `baseUrl` + wildcard `paths`

## Summary

A `tsconfig` scenario using inherited compiler options, `baseUrl`, and wildcard `paths` produced different behavior between classic TypeScript 6 and TypeScript 7.

The difference affects both diagnostics and process exit code, but upstream maintainers confirmed that it is expected because `baseUrl` is removed in TypeScript 7. It is therefore not tracked as an unresolved implementation-parity defect.

## Repro

See:

- [`../repros/tsconfig-paths-extends`](../repros/tsconfig-paths-extends)

Command:

```bash
npm run compare:tsconfig-extends
```

The local command uses the versions currently installed by this repository's moving preview lane. The exact output below records the original TypeScript 6→7 migration comparison.

## Recorded result

### classic TypeScript 6

```text
tsconfig.json(4,5): error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
  Visit https://aka.ms/ts6 for migration information.
```

Exit code: `2`

### TypeScript 7

```text
tsconfig.json(4,5): error TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.
  Use '"paths": {"*": ["./*"]}' instead.
tsconfig.json(6,18): error TS5090: Non-relative paths are not allowed. Did you forget a leading './'?
```

Exit code: `1`

## Difference

| Area | classic TypeScript 6 | TypeScript 7 |
|---|---:|---:|
| Exit code | `2` | `1` |
| Main diagnostic | `TS5101` | `TS5102` |
| Extra diagnostic | none | `TS5090` |

## Why it matters

`extends`, `baseUrl`, and `paths` are common TypeScript configuration patterns in frontend, backend, and monorepo projects.

This repro is useful for migration tooling and documentation because teams moving from TypeScript 6 to TypeScript 7 can receive different diagnostics and process status for the same inherited configuration. It should be interpreted as an expected breaking-change boundary, not as proof that the native compiler is incorrectly diverging from TypeScript 7 semantics.

## Upstream resolution

The finding was reported as:

- https://github.com/microsoft/typescript-go/issues/4435

The issue was closed as **Working As Intended**. Maintainer guidance explains that the observed behavioral difference is expected because `baseUrl` is no longer supported in TypeScript 7.

## Next action

Keep this minimal repro as migration evidence. Re-run it only when validating migration messaging or when a later TypeScript version changes the configuration contract again.
