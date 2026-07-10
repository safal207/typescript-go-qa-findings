package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"runtime/trace"
	"strconv"
	"time"
)

type benchmarkMemorySnapshot struct {
	TimestampUnixNano int64   `json:"timestampUnixNano"`
	Alloc             uint64  `json:"alloc"`
	TotalAlloc        uint64  `json:"totalAlloc"`
	Sys               uint64  `json:"sys"`
	Mallocs           uint64  `json:"mallocs"`
	Frees             uint64  `json:"frees"`
	HeapAlloc         uint64  `json:"heapAlloc"`
	HeapSys           uint64  `json:"heapSys"`
	HeapIdle          uint64  `json:"heapIdle"`
	HeapInuse         uint64  `json:"heapInuse"`
	HeapReleased      uint64  `json:"heapReleased"`
	HeapObjects       uint64  `json:"heapObjects"`
	NextGC            uint64  `json:"nextGC"`
	LastGC            uint64  `json:"lastGC"`
	PauseTotalNs      uint64  `json:"pauseTotalNs"`
	NumGC             uint32  `json:"numGC"`
	NumForcedGC       uint32  `json:"numForcedGC"`
	GCCPUFraction     float64 `json:"gcCpuFraction"`
}

type benchmarkMemoryDelta struct {
	ElapsedNs    int64  `json:"elapsedNs"`
	TotalAlloc   uint64 `json:"totalAlloc"`
	Mallocs      uint64 `json:"mallocs"`
	Frees        uint64 `json:"frees"`
	PauseTotalNs uint64 `json:"pauseTotalNs"`
	NumGC        uint32 `json:"numGC"`
	NumForcedGC  uint32 `json:"numForcedGC"`
}

type benchmarkRuntimeReport struct {
	SchemaVersion    int                     `json:"schemaVersion"`
	GeneratedAt      string                  `json:"generatedAt"`
	GoVersion        string                  `json:"goVersion"`
	GCPercentRequest *int                    `json:"gcPercentRequest"`
	MemoryLimitBytes *int64                  `json:"memoryLimitBytes"`
	TracePath        string                  `json:"tracePath,omitempty"`
	Before           benchmarkMemorySnapshot `json:"before"`
	After            benchmarkMemorySnapshot `json:"after"`
	Delta            benchmarkMemoryDelta    `json:"delta"`
}

func startBenchmarkRuntime() func() {
	reportPath := os.Getenv("TSGO_BENCH_RUNTIME_STATS")
	tracePath := os.Getenv("TSGO_BENCH_RUNTIME_TRACE")
	gcPercentRaw := os.Getenv("TSGO_BENCH_GC_PERCENT")
	memoryLimitRaw := os.Getenv("TSGO_BENCH_MEMORY_LIMIT")

	if reportPath == "" && tracePath == "" && gcPercentRaw == "" && memoryLimitRaw == "" {
		return func() {}
	}

	report := benchmarkRuntimeReport{
		SchemaVersion: 1,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		GoVersion:     runtime.Version(),
		TracePath:     tracePath,
	}

	var restoreGCPercent func()
	if gcPercentRaw != "" {
		requested, err := strconv.Atoi(gcPercentRaw)
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid TSGO_BENCH_GC_PERCENT=%q: %v\n", gcPercentRaw, err)
			os.Exit(86)
		}
		previous := debug.SetGCPercent(requested)
		report.GCPercentRequest = &requested
		restoreGCPercent = func() { debug.SetGCPercent(previous) }
	}

	var restoreMemoryLimit func()
	if memoryLimitRaw != "" {
		requested, err := strconv.ParseInt(memoryLimitRaw, 10, 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid TSGO_BENCH_MEMORY_LIMIT=%q: %v\n", memoryLimitRaw, err)
			os.Exit(87)
		}
		previous := debug.SetMemoryLimit(requested)
		report.MemoryLimitBytes = &requested
		restoreMemoryLimit = func() { debug.SetMemoryLimit(previous) }
	}

	var traceFile *os.File
	traceStarted := false
	if tracePath != "" {
		file, err := os.Create(tracePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "create runtime trace %q: %v\n", tracePath, err)
			os.Exit(88)
		}
		traceFile = file
		if err := trace.Start(file); err != nil {
			_ = file.Close()
			fmt.Fprintf(os.Stderr, "start runtime trace %q: %v\n", tracePath, err)
			os.Exit(89)
		}
		traceStarted = true
	}

	report.Before = readBenchmarkMemorySnapshot()

	return func() {
		report.After = readBenchmarkMemorySnapshot()
		report.Delta = benchmarkMemoryDelta{
			ElapsedNs:    report.After.TimestampUnixNano - report.Before.TimestampUnixNano,
			TotalAlloc:   report.After.TotalAlloc - report.Before.TotalAlloc,
			Mallocs:      report.After.Mallocs - report.Before.Mallocs,
			Frees:        report.After.Frees - report.Before.Frees,
			PauseTotalNs: report.After.PauseTotalNs - report.Before.PauseTotalNs,
			NumGC:        report.After.NumGC - report.Before.NumGC,
			NumForcedGC:  report.After.NumForcedGC - report.Before.NumForcedGC,
		}

		if traceStarted {
			trace.Stop()
			_ = traceFile.Close()
		}

		if reportPath != "" {
			if err := writeBenchmarkRuntimeReport(reportPath, report); err != nil {
				fmt.Fprintf(os.Stderr, "write runtime report %q: %v\n", reportPath, err)
			}
		}

		if restoreMemoryLimit != nil {
			restoreMemoryLimit()
		}
		if restoreGCPercent != nil {
			restoreGCPercent()
		}
	}
}

func readBenchmarkMemorySnapshot() benchmarkMemorySnapshot {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return benchmarkMemorySnapshot{
		TimestampUnixNano: time.Now().UnixNano(),
		Alloc:             stats.Alloc,
		TotalAlloc:        stats.TotalAlloc,
		Sys:               stats.Sys,
		Mallocs:           stats.Mallocs,
		Frees:             stats.Frees,
		HeapAlloc:         stats.HeapAlloc,
		HeapSys:           stats.HeapSys,
		HeapIdle:          stats.HeapIdle,
		HeapInuse:         stats.HeapInuse,
		HeapReleased:      stats.HeapReleased,
		HeapObjects:       stats.HeapObjects,
		NextGC:            stats.NextGC,
		LastGC:            stats.LastGC,
		PauseTotalNs:      stats.PauseTotalNs,
		NumGC:             stats.NumGC,
		NumForcedGC:       stats.NumForcedGC,
		GCCPUFraction:     stats.GCCPUFraction,
	}
}

func writeBenchmarkRuntimeReport(filePath string, report benchmarkRuntimeReport) error {
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
