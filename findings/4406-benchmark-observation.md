# Benchmark observation for `typescript-go`

- Issue: https://github.com/microsoft/typescript-go/issues/4406
- Status: completed

## Summary

Benchmark results were shared for `typescript-go` and compared against classic TypeScript behavior/performance expectations.

The TypeScript team accepted the report and closed the issue as completed.

## Maintainer note

Maintainer feedback suggested trying larger `--checkers` values depending on project shape and workload characteristics.

## Why it matters

Benchmark results depend not only on project size but also on:

- project graph shape
- type-checking density
- parallelism / checker count
- CLI invocation mode
- cold vs warm runs

This affects how `typescript-go` should be evaluated in realistic projects.

## Follow-up

Add a benchmark matrix with different `--checkers` values and document the shape of each tested project.

See: [`../docs/roadmap.md`](../docs/roadmap.md)
