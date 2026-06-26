# Workload matrix and native pprof findings — 2026-06-26

## Environment

- GitHub Actions `ubuntu-24.04`
- 4 logical CPUs
- TypeScript `6.0.3`
- TypeScript Go `7.0.0-dev.20260624.1`
- one warm-up and three measured iterations per command
- `tsgo` checker counts: 1, 2, 4, 8

## Performance matrix

| Workload | `tsc` median | Best `tsgo` median | Best checkers | Speedup | `tsc` peak RSS | Best-speed `tsgo` peak RSS |
|---|---:|---:|---:|---:|---:|---:|
| many small files | 1062.806 ms | 356.481 ms | 4 | 2.981x | 164872 KiB | 84416 KiB |
| few large files | 1575.592 ms | 388.748 ms | 8 | 4.053x | 192860 KiB | 87120 KiB |
| type-heavy | 1931.189 ms | 444.130 ms | 8 | 4.348x | 222184 KiB | 112124 KiB |
| module-resolution-heavy | 987.520 ms | 352.791 ms | 2 | 2.799x | 164764 KiB | 87228 KiB |

All commands completed successfully after updating the module-resolution fixture for TypeScript 7 path-mapping semantics. Exit status and normalized diagnostic hashes matched in every measured workload.

## Checker-count result

There is no universal best checker count:

- many small files: 4
- few large files: 8
- type-heavy: 8
- module-resolution-heavy: 2

This supports workload-aware tuning rather than a global recommendation.

## Migration finding discovered by the matrix

The first matrix run used `baseUrl` with path aliases.

- TypeScript 6 reported `baseUrl` as deprecated and requested `ignoreDeprecations: "6.0"`.
- TypeScript Go / TypeScript 7 reported `baseUrl` as removed and rejected non-relative path substitutions.

The benchmark fixture was corrected to remove `baseUrl` and use substitutions such as `./src/core/*`. This is a useful migration signal but is not treated as a performance result.

## Native profile

Profile workload: `few-large-files`, 5 generated source files, `--checkers 4`.

### CPU observations

The CPU profile was distributed. No narrow application function dominated the run:

- `Checker.getConditionalFlowTypeOfType`: 6.67% flat
- `Binder.bindEachStatementFunctionsFirst`: 3.33% flat / 10% cumulative
- `Checker.getTypeFromTypeReference`: 3.33% flat / 23.33% cumulative
- `Parser.nextToken`: 3.33% flat / 6.67% cumulative
- `Scanner.Scan`: 3.33% flat / 6.67% cumulative
- AST traversal through `ForEachChild` / node-list visits appeared cumulatively, but not as one isolated leaf operation
- runtime allocation, write-barrier, and GC scanning frames were also material

This does **not** support porting a tiny scanner or checker function across FFI. The boundary cost and duplicated semantic surface would likely consume the available gain.

### Allocation observations

The allocation profile was more directional:

- source-file parsing accounted for 82.47% cumulative allocation space
- `os.readFileContents`: 15.81% flat
- multiple typed `slices.Grow` arena paths appeared between roughly 2.7% and 11.2% flat each
- `NodeFactory.NewSpreadAssignment`: 8.24% flat on this synthetic shape
- `Parser.internIdentifier`: 5.71% flat
- several AST node/list factory allocations appeared independently

The exact `NewSpreadAssignment` share is workload-specific. The recurring arena growth and AST storage pattern is the stronger architectural signal.

## Rust candidate decision

### Rejected for now

- scanner-only FFI
- one checker helper
- identifier interning called across FFI per token
- filesystem reading

These candidates are either too small, too semantic, too boundary-heavy, or not TypeScript-specific enough.

### Selected next experiment

**Standalone AST-shaped arena allocation benchmark: current Go typed-arena strategy versus a Rust chunked/bump-style arena.**

The experiment should estimate an upper bound before any compiler integration:

1. replay the same deterministic allocation trace in Go and Rust;
2. include single-node allocations, small node lists, clones, and occasional larger slices;
3. measure throughput, allocation count/bytes, peak RSS, and latency variance;
4. preserve stable references and whole-arena lifetime semantics;
5. avoid FFI in the first comparison;
6. reject integration unless the result implies at least a plausible 5% end-to-end gain or 10% memory reduction after boundary costs.

A positive standalone result would still imply a parser/AST subsystem boundary, not a collection of per-node Rust calls.

## Conclusion

The matrix confirms that TypeScript Go is already strong: roughly 2.8x–4.35x faster than TypeScript 6 on these generated shapes while using around half the peak memory.

The native profile does not justify a broad Rust rewrite or a tiny FFI hot-path patch. It justifies one narrower architectural experiment around AST allocation and data layout. A negative result would close the Rust hypothesis cleanly; a strong result would define the minimum subsystem that would need redesign rather than transliteration.
