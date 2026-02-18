//! Performance benchmarking system
//!
//! Provides CPU and memory benchmarks for capability assessment.
//! Used for first-run experience and periodic health checks.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use tracing::{info, debug};

use crate::error::{Error, Result};

// ─────────────────────────────────────────────────────────────────
// Benchmark Results
// ─────────────────────────────────────────────────────────────────

/// Complete benchmark results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResults {
    /// When the benchmark was run
    pub timestamp: chrono::DateTime<chrono::Utc>,

    /// CPU benchmark results
    pub cpu: CpuBenchmarkResult,

    /// Memory benchmark results
    pub memory: MemoryBenchmarkResult,

    /// Overall compute score (0-1000)
    pub compute_score: u32,

    /// Estimated tokens per second capability
    pub estimated_tokens_per_second: f32,

    /// Duration of the full benchmark
    pub duration_secs: f32,
}

/// CPU benchmark results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuBenchmarkResult {
    /// Single-threaded score
    pub single_thread_score: u32,

    /// Multi-threaded score
    pub multi_thread_score: u32,

    /// Number of threads used
    pub thread_count: u32,

    /// SHA256 hashes per second (single thread)
    pub hashes_per_second: f64,

    /// Matrix operations per second (multi thread)
    pub matrix_ops_per_second: f64,
}

/// Memory benchmark results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryBenchmarkResult {
    /// Sequential read bandwidth (MB/s)
    pub seq_read_mbps: f64,

    /// Sequential write bandwidth (MB/s)
    pub seq_write_mbps: f64,

    /// Random access latency (ns)
    pub random_access_ns: f64,

    /// Memory score
    pub score: u32,
}

// ─────────────────────────────────────────────────────────────────
// Benchmark Runner
// ─────────────────────────────────────────────────────────────────

/// Runs performance benchmarks
pub struct BenchmarkRunner {
    /// Number of iterations for each benchmark
    iterations: u32,

    /// Benchmark results storage path
    results_path: Option<PathBuf>,
}

impl BenchmarkRunner {
    /// Create a new benchmark runner
    pub fn new(iterations: u32) -> Self {
        Self {
            iterations,
            results_path: None,
        }
    }

    /// Set the path to store benchmark results
    pub fn with_results_path(mut self, path: PathBuf) -> Self {
        self.results_path = Some(path);
        self
    }

    /// Run all benchmarks
    pub fn run(&self) -> Result<BenchmarkResults> {
        info!(iterations = self.iterations, "Starting benchmarks");
        let start = Instant::now();

        // Run CPU benchmarks
        let cpu = self.run_cpu_benchmarks()?;
        debug!(
            single_score = cpu.single_thread_score,
            multi_score = cpu.multi_thread_score,
            "CPU benchmark complete"
        );

        // Run memory benchmarks
        let memory = self.run_memory_benchmarks()?;
        debug!(
            read_mbps = memory.seq_read_mbps,
            write_mbps = memory.seq_write_mbps,
            "Memory benchmark complete"
        );

        // Calculate overall score
        let compute_score = self.calculate_compute_score(&cpu, &memory);
        let estimated_tokens_per_second = self.estimate_tokens_per_second(compute_score);

        let results = BenchmarkResults {
            timestamp: chrono::Utc::now(),
            cpu,
            memory,
            compute_score,
            estimated_tokens_per_second,
            duration_secs: start.elapsed().as_secs_f32(),
        };

        info!(
            compute_score = compute_score,
            estimated_tps = estimated_tokens_per_second,
            duration_secs = results.duration_secs,
            "Benchmark complete"
        );

        // Save results if path is configured
        if let Some(ref path) = self.results_path {
            self.save_results(&results, path)?;
        }

        Ok(results)
    }

    /// Run CPU benchmarks
    fn run_cpu_benchmarks(&self) -> Result<CpuBenchmarkResult> {
        let thread_count = num_cpus::get() as u32;

        // Single-threaded: SHA256 hashing benchmark
        let (single_score, hashes_per_second) = self.run_hash_benchmark()?;

        // Multi-threaded: Matrix operations benchmark
        let (multi_score, matrix_ops_per_second) = self.run_matrix_benchmark(thread_count)?;

        Ok(CpuBenchmarkResult {
            single_thread_score: single_score,
            multi_thread_score: multi_score,
            thread_count,
            hashes_per_second,
            matrix_ops_per_second,
        })
    }

    /// Run SHA256 hashing benchmark (single-threaded)
    fn run_hash_benchmark(&self) -> Result<(u32, f64)> {
        let data = vec![0u8; 4096]; // 4KB blocks
        let iterations = self.iterations * 1000;

        let start = Instant::now();
        for i in 0..iterations {
            let mut hasher = Sha256::new();
            hasher.update(&data);
            hasher.update(&i.to_le_bytes());
            let _ = hasher.finalize();
        }
        let elapsed = start.elapsed();

        let hashes_per_second = iterations as f64 / elapsed.as_secs_f64();

        // Score: normalized to ~500 for a typical modern CPU
        // Reference: ~2M hashes/sec = 500 score
        let score = ((hashes_per_second / 2_000_000.0) * 500.0).min(1000.0) as u32;

        Ok((score, hashes_per_second))
    }

    /// Run matrix operations benchmark (multi-threaded)
    fn run_matrix_benchmark(&self, thread_count: u32) -> Result<(u32, f64)> {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;

        let matrix_size = 128;
        let iterations_per_thread = self.iterations * 10;
        let total_ops = Arc::new(AtomicU64::new(0));

        let start = Instant::now();

        // Spawn threads for parallel matrix operations
        let handles: Vec<_> = (0..thread_count)
            .map(|_| {
                let ops = total_ops.clone();
                std::thread::spawn(move || {
                    let mut matrix_a = vec![vec![0.0f32; matrix_size]; matrix_size];
                    let mut matrix_b = vec![vec![0.0f32; matrix_size]; matrix_size];
                    let mut result = vec![vec![0.0f32; matrix_size]; matrix_size];

                    // Initialize with some values
                    for i in 0..matrix_size {
                        for j in 0..matrix_size {
                            matrix_a[i][j] = (i * j) as f32 / 1000.0;
                            matrix_b[i][j] = (i + j) as f32 / 1000.0;
                        }
                    }

                    // Simple matrix multiplication
                    for _ in 0..iterations_per_thread {
                        for i in 0..matrix_size {
                            for j in 0..matrix_size {
                                let mut sum = 0.0f32;
                                for k in 0..matrix_size {
                                    sum += matrix_a[i][k] * matrix_b[k][j];
                                }
                                result[i][j] = sum;
                            }
                        }
                        ops.fetch_add(1, Ordering::Relaxed);
                    }
                })
            })
            .collect();

        // Wait for all threads
        for handle in handles {
            let _ = handle.join();
        }

        let elapsed = start.elapsed();
        let total = total_ops.load(Ordering::Relaxed);
        let ops_per_second = total as f64 / elapsed.as_secs_f64();

        // Score: normalized considering thread count
        // Reference: ~1000 ops/sec per thread = 500 score
        let expected_ops = 1000.0 * thread_count as f64;
        let mut score = ((ops_per_second / expected_ops) * 500.0).min(1000.0) as u32;
        // Ensure minimum score of 1 when work was completed (debug builds are slow)
        if total > 0 && score == 0 {
            score = 1;
        }

        Ok((score, ops_per_second))
    }

    /// Run memory benchmarks
    fn run_memory_benchmarks(&self) -> Result<MemoryBenchmarkResult> {
        // Sequential read/write benchmark
        let buffer_size = 64 * 1024 * 1024; // 64MB
        let iterations = self.iterations.max(1);

        let mut buffer: Vec<u8> = vec![0; buffer_size];

        // Sequential write
        let start = Instant::now();
        for iter in 0..iterations {
            for (i, byte) in buffer.iter_mut().enumerate() {
                *byte = ((i + iter as usize) & 0xFF) as u8;
            }
        }
        let write_elapsed = start.elapsed();
        let seq_write_mbps = (buffer_size as f64 * iterations as f64)
            / (1024.0 * 1024.0)
            / write_elapsed.as_secs_f64();

        // Sequential read
        let start = Instant::now();
        let mut checksum: u64 = 0;
        for _ in 0..iterations {
            for byte in buffer.iter() {
                checksum = checksum.wrapping_add(*byte as u64);
            }
        }
        let read_elapsed = start.elapsed();
        let seq_read_mbps = (buffer_size as f64 * iterations as f64)
            / (1024.0 * 1024.0)
            / read_elapsed.as_secs_f64();

        // Prevent optimization
        std::hint::black_box(checksum);

        // Random access latency
        let random_access_ns = self.measure_random_access_latency(&buffer);

        // Calculate memory score
        // Reference: 10GB/s = 500 score
        let bandwidth_score = ((seq_read_mbps + seq_write_mbps) / 2.0 / 10000.0 * 500.0).min(500.0);
        // Reference: 50ns = 500 score (lower is better)
        let latency_score = ((50.0 / random_access_ns) * 500.0).min(500.0);
        let score = ((bandwidth_score + latency_score) / 2.0) as u32;

        Ok(MemoryBenchmarkResult {
            seq_read_mbps,
            seq_write_mbps,
            random_access_ns,
            score,
        })
    }

    /// Measure random access latency
    fn measure_random_access_latency(&self, buffer: &[u8]) -> f64 {
        let accesses = 10000;
        let len = buffer.len();

        // Use a simple LCG for pseudo-random indices
        let mut index: usize = 12345;
        let a: usize = 1103515245;
        let c: usize = 12345;

        let start = Instant::now();
        let mut sum: u64 = 0;
        for _ in 0..accesses {
            index = (a.wrapping_mul(index).wrapping_add(c)) % len;
            sum = sum.wrapping_add(buffer[index] as u64);
        }
        let elapsed = start.elapsed();

        // Prevent optimization
        std::hint::black_box(sum);

        elapsed.as_nanos() as f64 / accesses as f64
    }

    /// Calculate overall compute score
    fn calculate_compute_score(
        &self,
        cpu: &CpuBenchmarkResult,
        memory: &MemoryBenchmarkResult,
    ) -> u32 {
        // Weighted average: 60% CPU, 40% memory
        let cpu_score = (cpu.single_thread_score + cpu.multi_thread_score) / 2;
        let combined = (cpu_score as f64 * 0.6 + memory.score as f64 * 0.4) as u32;
        combined.min(1000)
    }

    /// Estimate tokens per second based on compute score
    fn estimate_tokens_per_second(&self, compute_score: u32) -> f32 {
        // Rough estimation based on compute score
        // Score 500 ~= 30 tokens/sec for 7B model
        // This is a rough approximation; actual depends on model, quantization, etc.
        (compute_score as f32 / 500.0) * 30.0
    }

    /// Save benchmark results to file
    fn save_results(&self, results: &BenchmarkResults, path: &Path) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| Error::IoWrite {
                path: parent.to_path_buf(),
                source: e,
            })?;
        }

        let json = serde_json::to_string_pretty(results)
            .map_err(|e| Error::Config(e.to_string()))?;

        std::fs::write(path, json).map_err(|e| Error::IoWrite {
            path: path.to_path_buf(),
            source: e,
        })?;

        info!(path = %path.display(), "Benchmark results saved");
        Ok(())
    }

    /// Load previous benchmark results
    pub fn load_results(path: &Path) -> Result<BenchmarkResults> {
        let content = std::fs::read_to_string(path).map_err(|e| Error::IoRead {
            path: path.to_path_buf(),
            source: e,
        })?;

        serde_json::from_str(&content)
            .map_err(|e| Error::Config(format!("Failed to parse benchmark results: {}", e)))
    }

    /// Check if benchmark results exist
    pub fn results_exist(path: &Path) -> bool {
        path.exists()
    }
}

impl Default for BenchmarkRunner {
    fn default() -> Self {
        Self::new(10)
    }
}

// ─────────────────────────────────────────────────────────────────
// First Run Experience
// ─────────────────────────────────────────────────────────────────

/// Handles first-run benchmarking and setup
pub struct FirstRunExperience {
    /// Path to store benchmark results
    results_path: PathBuf,

    /// Path to store first-run marker
    marker_path: PathBuf,
}

impl FirstRunExperience {
    /// Create a new first-run experience handler
    pub fn new(data_dir: &Path) -> Self {
        Self {
            results_path: data_dir.join("benchmark.json"),
            marker_path: data_dir.join(".first-run-complete"),
        }
    }

    /// Check if this is the first run
    pub fn is_first_run(&self) -> bool {
        !self.marker_path.exists()
    }

    /// Check if we have valid benchmark results
    pub fn has_benchmark_results(&self) -> bool {
        self.results_path.exists()
    }

    /// Run first-run setup (benchmarks, etc.)
    pub fn run_first_time_setup(&self) -> Result<BenchmarkResults> {
        info!("Running first-time setup...");

        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║           AI4All Worker - First Run Setup                ║");
        println!("╚══════════════════════════════════════════════════════════╝");
        println!();
        println!("Running performance benchmarks to determine your system's");
        println!("compute capabilities. This will take a few moments...");
        println!();

        // Run benchmarks
        let runner = BenchmarkRunner::new(10)
            .with_results_path(self.results_path.clone());

        let results = runner.run()?;

        // Print results
        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║                  Benchmark Results                       ║");
        println!("╠══════════════════════════════════════════════════════════╣");
        println!("║ CPU Single-Thread Score: {:>6}                          ║", results.cpu.single_thread_score);
        println!("║ CPU Multi-Thread Score:  {:>6}                          ║", results.cpu.multi_thread_score);
        println!("║ Memory Score:            {:>6}                          ║", results.memory.score);
        println!("║ Overall Compute Score:   {:>6}                          ║", results.compute_score);
        println!("╠══════════════════════════════════════════════════════════╣");
        println!("║ Estimated Performance:   ~{:.0} tokens/sec               ║", results.estimated_tokens_per_second);
        println!("╚══════════════════════════════════════════════════════════╝");
        println!();

        // Mark first run as complete
        self.mark_complete()?;

        Ok(results)
    }

    /// Load existing benchmark results
    pub fn load_benchmark_results(&self) -> Result<BenchmarkResults> {
        BenchmarkRunner::load_results(&self.results_path)
    }

    /// Mark first run as complete
    fn mark_complete(&self) -> Result<()> {
        if let Some(parent) = self.marker_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| Error::IoWrite {
                path: parent.to_path_buf(),
                source: e,
            })?;
        }

        std::fs::write(&self.marker_path, chrono::Utc::now().to_rfc3339())
            .map_err(|e| Error::IoWrite {
                path: self.marker_path.clone(),
                source: e,
            })
    }

    /// Get or run benchmarks (runs if first time or missing)
    pub fn get_or_run_benchmarks(&self) -> Result<BenchmarkResults> {
        if self.has_benchmark_results() {
            info!("Loading existing benchmark results");
            self.load_benchmark_results()
        } else {
            self.run_first_time_setup()
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_benchmark_runner() {
        let runner = BenchmarkRunner::new(1); // Minimal iterations for test
        let results = runner.run().unwrap();

        assert!(results.cpu.single_thread_score > 0);
        assert!(results.cpu.multi_thread_score > 0);
        assert!(results.memory.score > 0);
        assert!(results.compute_score > 0);
        assert!(results.estimated_tokens_per_second > 0.0);
    }

    #[test]
    fn test_benchmark_save_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("benchmark.json");

        let runner = BenchmarkRunner::new(1)
            .with_results_path(path.clone());

        let results = runner.run().unwrap();

        // Load and verify
        let loaded = BenchmarkRunner::load_results(&path).unwrap();
        assert_eq!(results.compute_score, loaded.compute_score);
    }

    #[test]
    fn test_first_run_experience() {
        let dir = tempdir().unwrap();
        let fre = FirstRunExperience::new(dir.path());

        assert!(fre.is_first_run());
        assert!(!fre.has_benchmark_results());
    }
}
