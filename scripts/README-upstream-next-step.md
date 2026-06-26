# Immediate next implementation

The next implementation should add a real-compiler benchmark harness capable of running `tsgo` under several GC policies while collecting runtime traces and preserving correctness parity.

Required modes:

- default
- environment `GOGC=off`
- environment `GOGC=500`
- environment `GOGC=1000`
- patched command-line-only dynamic policy

The first deliverable should not modify upstream. It should produce reproducible commands and artifacts against pinned commits of TypeScript, VS Code, and one additional large project.
