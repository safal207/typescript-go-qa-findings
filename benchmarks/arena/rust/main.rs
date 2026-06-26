use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::mem::MaybeUninit;
use std::process;
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

struct CountingAllocator;
static ALLOCATED_BYTES: AtomicU64 = AtomicU64::new(0);
static ALLOCATION_CALLS: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATED_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        System.alloc(layout)
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCATED_BYTES.fetch_add(layout.size() as u64, Ordering::Relaxed);
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        System.alloc_zeroed(layout)
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCATED_BYTES.fetch_add(new_size as u64, Ordering::Relaxed);
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        System.realloc(pointer, layout, new_size)
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout)
    }
}

#[global_allocator]
static GLOBAL_ALLOCATOR: CountingAllocator = CountingAllocator;

#[derive(Clone)]
struct Trace {
    id: String,
    seed: u64,
    arenas: usize,
    nodes_per_arena: usize,
    node_jitter: usize,
    max_children: usize,
    clone_every: usize,
    large_list_every: usize,
    large_list_size: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RunResult {
    checksum: u64,
    operations: u64,
}

struct Sample {
    elapsed_ns: u128,
    allocated_bytes: u64,
    allocations: u64,
}

#[derive(Clone, Copy)]
struct RawSlice<T: Copy> {
    pointer: *mut T,
    length: usize,
}

#[derive(Clone, Copy)]
struct Node {
    kind: u32,
    flags: u32,
    value: u64,
    children: RawSlice<u32>,
}

struct Chunk<T: Copy> {
    storage: Box<[MaybeUninit<T>]>,
    used: usize,
}

impl<T: Copy> Chunk<T> {
    fn with_capacity(capacity: usize) -> Self {
        let mut storage: Vec<MaybeUninit<T>> = Vec::with_capacity(capacity);
        unsafe {
            storage.set_len(capacity);
        }
        Self {
            storage: storage.into_boxed_slice(),
            used: 0,
        }
    }

    fn remaining(&self) -> usize {
        self.storage.len() - self.used
    }
}

struct ChunkedArena<T: Copy> {
    chunks: Vec<Chunk<T>>,
    next_capacity: usize,
}

impl<T: Copy> ChunkedArena<T> {
    fn new() -> Self {
        Self {
            chunks: Vec::new(),
            next_capacity: 4096,
        }
    }

    fn allocate_slice(&mut self, length: usize) -> RawSlice<T> {
        if length == 0 {
            return RawSlice {
                pointer: ptr::NonNull::<T>::dangling().as_ptr(),
                length: 0,
            };
        }

        let requires_chunk = self
            .chunks
            .last()
            .map(|chunk| chunk.remaining() < length)
            .unwrap_or(true);

        if requires_chunk {
            let capacity = self.next_capacity.max(length);
            self.chunks.push(Chunk::with_capacity(capacity));
            self.next_capacity = capacity.saturating_mul(2).clamp(4096, 1_048_576);
        }

        let chunk = self.chunks.last_mut().expect("chunk must exist");
        let start = chunk.used;
        chunk.used += length;
        let pointer = unsafe { chunk.storage.as_mut_ptr().add(start) as *mut T };
        RawSlice { pointer, length }
    }

    fn allocate_one(&mut self, value: T) -> *mut T {
        let raw_slice = self.allocate_slice(1);
        unsafe {
            raw_slice.pointer.write(value);
        }
        raw_slice.pointer
    }

    fn clone_slice(&mut self, source: RawSlice<T>) -> RawSlice<T> {
        if source.length == 0 {
            return self.allocate_slice(0);
        }
        let target = self.allocate_slice(source.length);
        unsafe {
            ptr::copy_nonoverlapping(source.pointer, target.pointer, source.length);
        }
        target
    }
}

fn main() {
    let arguments: Vec<String> = env::args().collect();
    let trace_path = argument_value(&arguments, "--trace").unwrap_or_else(|| fail("--trace is required"));
    let warmups = parse_argument_usize(&arguments, "--warmups", 2);
    let iterations = parse_argument_usize(&arguments, "--iterations", 7);
    if iterations == 0 {
        fail("iterations must be positive");
    }

    let trace = read_trace(&trace_path).unwrap_or_else(|error| fail(&error));
    let mut expected: Option<RunResult> = None;

    for _ in 0..warmups {
        let result = run_trace(&trace);
        if let Some(previous) = expected {
            if result != previous {
                fail("warm-up parity mismatch");
            }
        } else {
            expected = Some(result);
        }
    }

    let mut samples: Vec<Sample> = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        ALLOCATED_BYTES.store(0, Ordering::SeqCst);
        ALLOCATION_CALLS.store(0, Ordering::SeqCst);
        let started = Instant::now();
        let result = run_trace(&trace);
        let elapsed = started.elapsed();
        let allocated_bytes = ALLOCATED_BYTES.load(Ordering::SeqCst);
        let allocations = ALLOCATION_CALLS.load(Ordering::SeqCst);

        if let Some(previous) = expected {
            if result != previous {
                fail("measured parity mismatch");
            }
        } else {
            expected = Some(result);
        }

        samples.push(Sample {
            elapsed_ns: elapsed.as_nanos(),
            allocated_bytes,
            allocations,
        });
    }

    let result = expected.expect("at least one run must execute");
    let sample_json = samples
        .iter()
        .map(|sample| {
            format!(
                "{{\"elapsedNs\":{},\"allocatedBytes\":{},\"allocations\":{}}}",
                sample.elapsed_ns, sample.allocated_bytes, sample.allocations
            )
        })
        .collect::<Vec<String>>()
        .join(",");

    println!(
        "{{\"implementation\":\"rust-chunked-arena\",\"trace\":\"{}\",\"toolchain\":\"rustc\",\"checksum\":\"{:016x}\",\"operations\":{},\"samples\":[{}]}}",
        escape_json(&trace.id),
        result.checksum,
        result.operations,
        sample_json
    );
}

fn run_trace(trace: &Trace) -> RunResult {
    let mut state = trace.seed;
    let mut checksum: u64 = 1_469_598_103_934_665_603;
    let mut operations: u64 = 0;

    for _arena_index in 0..trace.arenas {
        let mut node_count = trace.nodes_per_arena as i64;
        if trace.node_jitter > 0 {
            let jitter_width = (trace.node_jitter * 2 + 1) as u64;
            node_count += (next_random(&mut state) % jitter_width) as i64 - trace.node_jitter as i64;
        }
        if node_count < 1 {
            node_count = 1;
        }
        let node_count = node_count as usize;

        let mut node_arena = ChunkedArena::<Node>::new();
        let mut child_arena = ChunkedArena::<u32>::new();
        let mut nodes: Vec<*mut Node> = Vec::with_capacity(node_count);

        for node_index in 0..node_count {
            let random_value = next_random(&mut state);
            let mut child_count = if trace.max_children > 0 {
                (random_value % (trace.max_children as u64 + 1)) as usize
            } else {
                0
            };
            if trace.large_list_every > 0
                && node_index > 0
                && node_index % trace.large_list_every == 0
            {
                child_count = trace.large_list_size;
            }

            let mut children = child_arena.allocate_slice(child_count);
            for child_index in 0..child_count {
                let bound = (node_index + 1) as u64;
                let child = ((next_random(&mut state) + child_index as u64) % bound) as u32;
                unsafe {
                    children.pointer.add(child_index).write(child);
                }
            }
            operations = operations.wrapping_add(child_count as u64);

            if trace.clone_every > 0 && child_count > 0 && node_index % trace.clone_every == 0 {
                children = child_arena.clone_slice(children);
                operations = operations.wrapping_add(child_count as u64);
            }

            let node = Node {
                kind: (random_value & 0x3ff) as u32,
                flags: ((random_value >> 10) & 0xff) as u32,
                value: next_random(&mut state),
                children,
            };
            nodes.push(node_arena.allocate_one(node));
            operations = operations.wrapping_add(1);
        }

        for node_pointer in nodes {
            let node = unsafe { &*node_pointer };
            checksum = mix(checksum, node.kind as u64);
            checksum = mix(checksum, node.flags as u64);
            checksum = mix(checksum, node.value);
            checksum = mix(checksum, node.children.length as u64);
            for child_index in 0..node.children.length {
                let child = unsafe { *node.children.pointer.add(child_index) };
                checksum = mix(checksum, child as u64);
                operations = operations.wrapping_add(1);
            }
        }
    }

    RunResult {
        checksum,
        operations,
    }
}

fn mix(current: u64, value: u64) -> u64 {
    (current ^ value).wrapping_mul(1_099_511_628_211)
}

fn next_random(state: &mut u64) -> u64 {
    *state = (*state).wrapping_add(0x9e3779b97f4a7c15);
    let mut value = *state;
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

fn read_trace(file_path: &str) -> Result<Trace, String> {
    let content = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    let mut values: HashMap<String, String> = HashMap::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| format!("invalid trace line: {line}"))?;
        values.insert(key.trim().to_string(), value.trim().to_string());
    }

    let schema_version = parse_trace_usize(&values, "schema_version")?;
    if schema_version != 1 {
        return Err(format!("unsupported schema_version {schema_version}"));
    }
    let id = values
        .get("id")
        .cloned()
        .ok_or_else(|| "trace id is required".to_string())?;
    let seed = parse_trace_u64(&values, "seed")?;
    let trace = Trace {
        id,
        seed,
        arenas: parse_trace_usize(&values, "arenas")?,
        nodes_per_arena: parse_trace_usize(&values, "nodes_per_arena")?,
        node_jitter: parse_trace_usize(&values, "node_jitter")?,
        max_children: parse_trace_usize(&values, "max_children")?,
        clone_every: parse_trace_usize(&values, "clone_every")?,
        large_list_every: parse_trace_usize(&values, "large_list_every")?,
        large_list_size: parse_trace_usize(&values, "large_list_size")?,
    };
    if trace.arenas == 0 || trace.nodes_per_arena == 0 {
        return Err("trace dimensions must be positive".to_string());
    }
    Ok(trace)
}

fn parse_trace_usize(values: &HashMap<String, String>, key: &str) -> Result<usize, String> {
    values
        .get(key)
        .ok_or_else(|| format!("missing trace key {key}"))?
        .parse::<usize>()
        .map_err(|error| format!("invalid {key}: {error}"))
}

fn parse_trace_u64(values: &HashMap<String, String>, key: &str) -> Result<u64, String> {
    values
        .get(key)
        .ok_or_else(|| format!("missing trace key {key}"))?
        .parse::<u64>()
        .map_err(|error| format!("invalid {key}: {error}"))
}

fn argument_value(arguments: &[String], name: &str) -> Option<String> {
    arguments
        .iter()
        .position(|argument| argument == name)
        .and_then(|index| arguments.get(index + 1))
        .cloned()
}

fn parse_argument_usize(arguments: &[String], name: &str, fallback: usize) -> usize {
    argument_value(arguments, name)
        .map(|value| {
            value
                .parse::<usize>()
                .unwrap_or_else(|_| fail(&format!("invalid {name}")))
        })
        .unwrap_or(fallback)
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    process::exit(1);
}
