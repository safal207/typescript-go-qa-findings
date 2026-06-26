# Finding: `tsconfig` extends + paths behavior mismatch

- Local repo issue: https://github.com/safal207/typescript-go-qa-findings/issues/5
- Upstream issue: https://github.com/microsoft/typescript-go/issues/4435
- Status: reported upstream / waiting for maintainer response
- Scenario: `extends` + `baseUrl` + wildcard `paths`

## Summary

A `tsconfig` scenario using inherited compiler options, `baseUrl`, and wildcard `paths` produced different behavior between classic `tsc` and `typescript-go`.

The mismatch affects both diagnostics and process exit code.

## Repro

See:

- [`../repros/tsconfig-paths-extends`](../repros/tsconfig-paths-extends)

Command:

```bash
npm run compare:tsconfig-extends
```

## CI result

From the QA workflow artifact:

### classic `tsc`

```text
tsconfig.json(4,5): error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
  Visit https://aka.ms/ts6 for migration information.
```

Exit code: `2`

### `typescript-go`

```text
tsconfig.json(4,5): error TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.
  Use '"paths": {"*": ["./*"]}' instead.
tsconfig.json(6,18): error TS5090: Non-relative paths are not allowed. Did you forget a leading './'?
```

Exit code: `1`

## Difference

| Area | classic `tsc` | `typescript-go` |
|---|---:|---:|
| Exit code | `2` | `1` |
| Main diagnostic | `TS5101` | `TS5102` |
| Extra diagnostic | none | `TS5090` |

## Why it matters

`extends`, `baseUrl`, and `paths` are common TypeScript configuration patterns in frontend, backend, and monorepo projects.

A behavior mismatch here may affect migration safety because users can get different diagnostics and different process exit codes from equivalent project configuration.

This is especially relevant for teams validating TypeScript Go against existing codebases where path aliases and inherited configs are common.

## Current upstream watch

The finding has been reported upstream as:

- https://github.com/microsoft/typescript-go/issues/4435

Next useful updates to watch for:

- maintainer confirmation or clarification
- labels such as CLI/config/module resolution
- a linked PR
- requests for additional repro data or version checks

## Notes

This finding may be related to TypeScript 7 migration behavior around `baseUrl` removal/deprecation and path alias validation.
