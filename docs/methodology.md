# Methodology

This repository focuses on compatibility-oriented QA checks for `typescript-go` compared with classic TypeScript (`tsc`).

## Comparison principles

For each scenario, compare:

1. process exit code
2. stdout diagnostics
3. stderr output
4. emitted files, when applicable
5. generated declaration output, when applicable
6. behavior under the same source files and tsconfig settings

## CLI checks

CLI behavior matters because many TypeScript users do not call the compiler manually only. They use it through:

- CI pipelines
- npm scripts
- shell scripts
- build wrappers
- monorepo orchestration tools
- editor and dev tooling integrations

Even small behavioral differences can create migration risk.

## Benchmark checks

For benchmark-oriented checks, record:

- compiler version / package version / commit if available
- command used
- project shape
- machine context if relevant
- cold vs warm run notes
- elapsed time
- `--checkers` value, when used

## Finding statuses

Suggested statuses:

- `candidate` - observed locally, not reported upstream yet
- `reported` - upstream issue/comment created
- `confirmed` - maintainer or fix activity confirms the finding
- `fixed` - upstream fix merged
- `released` - fix available in a published release
- `completed` - feedback accepted or investigation closed without an active bug
