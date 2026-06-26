# Alignment with microsoft/typescript-go#3259 — 2026-06-26

## Existing upstream direction

The upstream project already has an open proposal to flatten the AST to reduce garbage-collector scan cost. The issue reports that more than 20% of execution time can appear in GC, `GOGC=off` improved a VS Code compile by about 1.24x in the reported experiment, and parser AST data represented about half of `inuse_space`.

Maintainer feedback identifies the exact proof gaps our next work must address:

- the current AST is already arena-allocated and substantially contiguous;
- the latest Go collector may scan pages differently, reducing expected locality gains;
- concurrent GC samples may not all be on the wall-clock critical path;
- replacing pointers with IDs introduces arena-identity and API propagation costs;
- command-line compilation retains most data until the end, so GC tuning or disabling may be more practical than flattening the entire AST;
- allocation-heavy paths outside AST representation may be better targets.

## How our current evidence contributes

Our controlled arena experiment adds evidence that was not present in the upstream thread:

- deterministic parity across Go current-style, Go chunked, and Rust chunked implementations;
- reproduction on Linux x64 and macOS arm64;
- separation of chunking strategy from language/runtime effects;
- substantially lower allocation-call counts and Linux peak RSS for chunked layouts;
- residual Rust timing advantage after controlling for chunk geometry;
- explicit Amdahl thresholds required for a 5% full-compiler improvement.

It does not yet answer whether GC is on the critical path in real `tsgo` compilation or whether a tuned Go implementation can close the gap.

## Recommended upstream contribution

The highest-value contribution is not a duplicate issue or a broad Rust proposal. It is a real-project runtime-trace study plus a minimal command-line GC-policy experiment, followed by an optimized Go arena sweep.

Only after those controls should the project consider a pointer-light parser representation or coarse parser/AST subsystem prototype.
