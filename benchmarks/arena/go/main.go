package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
)

type Trace struct {
	SchemaVersion  int
	ID             string
	Seed           uint64
	Arenas         int
	NodesPerArena  int
	NodeJitter     int
	MaxChildren    int
	CloneEvery     int
	LargeListEvery int
	LargeListSize  int
}

type RawSample struct {
	ElapsedNs      int64  `json:"elapsedNs"`
	AllocatedBytes uint64 `json:"allocatedBytes"`
	Allocations    uint64 `json:"allocations"`
}

type Report struct {
	Implementation string      `json:"implementation"`
	Trace          string      `json:"trace"`
	Toolchain      string      `json:"toolchain"`
	Checksum       string      `json:"checksum"`
	Operations     uint64      `json:"operations"`
	Samples        []RawSample `json:"samples"`
}

type Arena[T any] struct {
	data []T
}

func (a *Arena[T]) New() *T {
	if len(a.data) == cap(a.data) {
		nextSize := nextArenaSize(len(a.data))
		a.data = slices.Grow([]T(nil), nextSize)
	}
	index := len(a.data)
	a.data = a.data[:index+1]
	return &a.data[index]
}

func (a *Arena[T]) NewSlice(size int) []T {
	if size == 0 {
		return nil
	}
	if len(a.data)+size > cap(a.data) {
		nextSize := nextArenaSize(len(a.data))
		if size > nextSize {
			return make([]T, size)
		}
		a.data = slices.Grow([]T(nil), nextSize)
	}
	newLength := len(a.data) + size
	result := a.data[len(a.data):newLength:newLength]
	a.data = a.data[:newLength]
	return result
}

func (a *Arena[T]) Clone(values []T) []T {
	if len(values) == 0 {
		return nil
	}
	result := a.NewSlice(len(values))
	copy(result, values)
	return result
}

func nextArenaSize(size int) int {
	if size < 1 {
		size = 1
	}
	size *= 2
	if size > 256 {
		size = 256
	}
	return size
}

type Node struct {
	Kind     uint32
	Flags    uint32
	Value    uint64
	Children []uint32
}

type RunResult struct {
	Checksum   uint64
	Operations uint64
}

func main() {
	tracePath := flag.String("trace", "", "path to a .trace file")
	warmups := flag.Int("warmups", 2, "warm-up iterations")
	iterations := flag.Int("iterations", 7, "measured iterations")
	flag.Parse()

	if *tracePath == "" {
		fail(errors.New("--trace is required"))
	}
	if *warmups < 0 || *iterations <= 0 {
		fail(errors.New("warmups must be non-negative and iterations positive"))
	}

	trace, err := readTrace(*tracePath)
	if err != nil {
		fail(err)
	}

	var expected RunResult
	for index := 0; index < *warmups; index++ {
		result := runTrace(trace)
		if index == 0 {
			expected = result
		} else if result != expected {
			fail(fmt.Errorf("warm-up parity mismatch: got %+v expected %+v", result, expected))
		}
	}

	samples := make([]RawSample, 0, *iterations)
	for index := 0; index < *iterations; index++ {
		runtime.GC()
		var before runtime.MemStats
		runtime.ReadMemStats(&before)
		started := time.Now()
		result := runTrace(trace)
		elapsed := time.Since(started)
		var after runtime.MemStats
		runtime.ReadMemStats(&after)

		if index == 0 && *warmups == 0 {
			expected = result
		} else if result != expected {
			fail(fmt.Errorf("measured parity mismatch: got %+v expected %+v", result, expected))
		}

		samples = append(samples, RawSample{
			ElapsedNs:      elapsed.Nanoseconds(),
			AllocatedBytes: after.TotalAlloc - before.TotalAlloc,
			Allocations:    after.Mallocs - before.Mallocs,
		})
	}

	report := Report{
		Implementation: "go-current-typed-arena",
		Trace:          trace.ID,
		Toolchain:      runtime.Version(),
		Checksum:       fmt.Sprintf("%016x", expected.Checksum),
		Operations:     expected.Operations,
		Samples:        samples,
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(report); err != nil {
		fail(err)
	}
}

func runTrace(trace Trace) RunResult {
	state := trace.Seed
	checksum := uint64(1469598103934665603)
	operations := uint64(0)

	for arenaIndex := 0; arenaIndex < trace.Arenas; arenaIndex++ {
		nodeCount := trace.NodesPerArena
		if trace.NodeJitter > 0 {
			jitterWidth := uint64(trace.NodeJitter*2 + 1)
			nodeCount += int(nextRandom(&state)%jitterWidth) - trace.NodeJitter
		}
		if nodeCount < 1 {
			nodeCount = 1
		}

		var nodeArena Arena[Node]
		var childArena Arena[uint32]
		nodes := make([]*Node, 0, nodeCount)

		for nodeIndex := 0; nodeIndex < nodeCount; nodeIndex++ {
			randomValue := nextRandom(&state)
			childCount := 0
			if trace.MaxChildren > 0 {
				childCount = int(randomValue % uint64(trace.MaxChildren+1))
			}
			if trace.LargeListEvery > 0 && nodeIndex > 0 && nodeIndex%trace.LargeListEvery == 0 {
				childCount = trace.LargeListSize
			}

			children := childArena.NewSlice(childCount)
			for childIndex := range children {
				bound := uint64(nodeIndex + 1)
				children[childIndex] = uint32((nextRandom(&state) + uint64(childIndex)) % bound)
			}
			operations += uint64(childCount)

			if trace.CloneEvery > 0 && childCount > 0 && nodeIndex%trace.CloneEvery == 0 {
				children = childArena.Clone(children)
				operations += uint64(childCount)
			}

			node := nodeArena.New()
			node.Kind = uint32(randomValue & 0x3ff)
			node.Flags = uint32((randomValue >> 10) & 0xff)
			node.Value = nextRandom(&state)
			node.Children = children
			nodes = append(nodes, node)
			operations++
		}

		for _, node := range nodes {
			checksum = mix(checksum, uint64(node.Kind))
			checksum = mix(checksum, uint64(node.Flags))
			checksum = mix(checksum, node.Value)
			checksum = mix(checksum, uint64(len(node.Children)))
			for _, child := range node.Children {
				checksum = mix(checksum, uint64(child))
				operations++
			}
		}
		runtime.KeepAlive(nodeArena)
		runtime.KeepAlive(childArena)
		runtime.KeepAlive(nodes)
	}

	return RunResult{Checksum: checksum, Operations: operations}
}

func mix(current, value uint64) uint64 {
	return (current ^ value) * 1099511628211
}

func nextRandom(state *uint64) uint64 {
	*state += 0x9e3779b97f4a7c15
	value := *state
	value = (value ^ (value >> 30)) * 0xbf58476d1ce4e5b9
	value = (value ^ (value >> 27)) * 0x94d049bb133111eb
	return value ^ (value >> 31)
}

func readTrace(filePath string) (Trace, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return Trace{}, err
	}
	defer file.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return Trace{}, fmt.Errorf("invalid trace line: %q", line)
		}
		values[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	if err := scanner.Err(); err != nil {
		return Trace{}, err
	}

	schemaVersion, err := parseInt(values, "schema_version")
	if err != nil {
		return Trace{}, err
	}
	if schemaVersion != 1 {
		return Trace{}, fmt.Errorf("unsupported schema_version %d", schemaVersion)
	}
	seed, err := parseUint64(values, "seed")
	if err != nil {
		return Trace{}, err
	}

	trace := Trace{SchemaVersion: schemaVersion, ID: values["id"], Seed: seed}
	if trace.ID == "" {
		return Trace{}, errors.New("trace id is required")
	}
	targets := []struct {
		key    string
		target *int
	}{
		{"arenas", &trace.Arenas},
		{"nodes_per_arena", &trace.NodesPerArena},
		{"node_jitter", &trace.NodeJitter},
		{"max_children", &trace.MaxChildren},
		{"clone_every", &trace.CloneEvery},
		{"large_list_every", &trace.LargeListEvery},
		{"large_list_size", &trace.LargeListSize},
	}
	for _, item := range targets {
		value, parseErr := parseInt(values, item.key)
		if parseErr != nil {
			return Trace{}, parseErr
		}
		*item.target = value
	}
	if trace.Arenas <= 0 || trace.NodesPerArena <= 0 || trace.NodeJitter < 0 || trace.MaxChildren < 0 || trace.CloneEvery < 0 || trace.LargeListEvery < 0 || trace.LargeListSize < 0 {
		return Trace{}, errors.New("trace contains invalid negative or zero dimensions")
	}
	return trace, nil
}

func parseInt(values map[string]string, key string) (int, error) {
	raw, ok := values[key]
	if !ok {
		return 0, fmt.Errorf("missing trace key %q", key)
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return value, nil
}

func parseUint64(values map[string]string, key string) (uint64, error) {
	raw, ok := values[key]
	if !ok {
		return 0, fmt.Errorf("missing trace key %q", key)
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return value, nil
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
