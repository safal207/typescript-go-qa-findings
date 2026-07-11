# Benchmark observation for `typescript-go`

- Issue: https://github.com/microsoft/typescript-go/issues/4406
- Status: completed
- Pinned stable harness: https://github.com/safal207/typescript-7-rc-qa-benchmark/pull/11

## Summary

Independent benchmark results were shared for `typescript-go` and compared against classic TypeScript performance and compatibility expectations.

The TypeScript team accepted the report and closed the issue as completed.

## Maintainer note

Maintainer feedback suggested trying larger `--checkers` values depending on project shape and workload characteristics.

## Completed follow-up

The requested broader checker-scaling matrix was implemented as a separate cross-platform workflow.

- Checker-scaling evidence: [workflow run 29121518759](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29121518759)
- Result: Ubuntu, Windows, and macOS passed
- Stable compiler: TypeScript 7.0.2
- Full stable report: [2026-07-10 TypeScript 7 stable evidence](https://github.com/safal207/typescript-7-rc-qa-benchmark/blob/agent/typescript-7-stable-validation/docs/results/2026-07-10-typescript-7-stable-full.md)
- Full-profile run: [29120482675](https://github.com/safal207/typescript-7-rc-qa-benchmark/actions/runs/29120482675)

The full stable profile used 15 measured randomized rounds per scenario on each operating system. For the documented workloads, TypeScript 7.0.2 median speedups ranged from 4.51× to 6.18× against classic TypeScript 6.0.3, with normalized output parity for JavaScript, declarations, and project-reference outputs.

## Evidence boundary

The exact stable results come from the pinned benchmark harness, not from this repository's moving `latest` preview dependencies. The checker-scaling workflow is separate from the main stable QA workflow; claims about checker scaling must cite its own run rather than infer it from the main `qa` command.

## Why it matters

Benchmark results depend not only on project size but also on:

- project graph shape
- type-checking density
- parallelism / checker count
- CLI invocation mode
- cold vs warm runs
- runner variability

This affects how `typescript-go` should be evaluated in realistic projects and why performance claims need explicit workload, compiler, operating-system, and workflow provenance.

## Next action

Repeat the pinned experiment only for a new compiler release, a material harness change, or a targeted regression hypothesis. Preserve the existing report as the stable 7.0.2 evidence baseline.
