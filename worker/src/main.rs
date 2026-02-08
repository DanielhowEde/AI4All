//! AI4All Worker - Distributed AI compute worker
//!
//! This is the main entry point for the AI4All worker binary.
//! The worker connects to the coordinator, receives AI work assignments,
//! executes them using local CPU/GPU resources, and returns results.

mod backend;
mod cli;
mod config;
mod coordinator;
mod error;
mod executor;
#[cfg(feature = "gpu")]
mod gpu;
mod logging;
mod pairing;
#[cfg(feature = "gpu")]
mod plugins;
mod protocol;
mod system;
mod types;
mod version;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use parking_lot::RwLock;
use tracing::{debug, error, info, warn};

use crate::backend::{BackendConfig, BackendRegistry, BackendType};
use crate::cli::{Cli, Commands};
use crate::config::WorkerConfig;
use crate::coordinator::{ClientEvent, CoordinatorClient, CoordinatorClientConfig};
use crate::error::{Error, Result};
use crate::executor::{ExecutorConfig, TaskExecutor};
use crate::logging::LogGuards;
use crate::protocol::{WorkerCapabilities, WorkerStatus};
use crate::system::{BenchmarkRunner, FirstRunExperience, HealthMonitor};
use crate::types::TaskType;

fn main() -> Result<()> {
    // Parse CLI arguments first (before logging, so we know verbosity)
    let cli = Cli::parse();

    // For commands that don't need full logging, use simple setup
    match &cli.command {
        Commands::Version => {
            version::print_version();
            return Ok(());
        }
        Commands::Config { subcommand } => {
            // Config commands use minimal logging
            logging::init_simple(tracing::Level::WARN)?;
            return handle_config_command(subcommand.clone());
        }
        Commands::Pair { ref api_url, ref name, force } => {
            logging::init_simple(if cli.verbose > 0 {
                tracing::Level::DEBUG
            } else {
                tracing::Level::INFO
            })?;
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| Error::Internal(format!("Failed to create runtime: {}", e)))?;
            return rt.block_on(async {
                pairing::run_pairing(api_url, name, force)
                    .await
                    .map_err(|e| Error::Internal(e.to_string()))
            });
        }
        _ => {}
    }

    // Load configuration for run/benchmark commands
    let config_path = match &cli.command {
        Commands::Run { config } => config.clone(),
        _ => None,
    };

    // Load config (or use defaults)
    let config = match WorkerConfig::load(config_path.as_deref()) {
        Ok(cfg) => cfg,
        Err(e) => {
            // Use formatted error for terminal
            eprint!("{}", e.format_for_terminal());
            std::process::exit(e.exit_code());
        }
    };

    // Initialize logging with config settings
    // The guards must be kept alive for the lifetime of the program
    let _log_guards = init_logging_from_config(&config, cli.verbose, cli.quiet)?;

    // Log version info at startup
    let build = version::build_info();
    info!(
        version = %build.full_version(),
        target = %build.target,
        profile = %build.profile,
        "Starting AI4All Worker"
    );

    // Execute the appropriate command
    match cli.command {
        Commands::Run { .. } => {
            run_worker(config)?;
        }
        Commands::Benchmark { iterations, output } => {
            run_benchmark(iterations, output)?;
        }
        Commands::Version | Commands::Config { .. } | Commands::Pair { .. } => {
            // Already handled above
            unreachable!();
        }
    }

    Ok(())
}

/// Initialize logging from configuration
fn init_logging_from_config(
    config: &WorkerConfig,
    verbose: u8,
    quiet: bool,
) -> Result<LogGuards> {
    logging::init_logging(&config.logging, verbose, quiet)
}

/// Run the worker in normal operation mode
fn run_worker(config: WorkerConfig) -> Result<()> {
    info!(
        worker_id = %config.worker.id.as_deref().unwrap_or("(auto)"),
        coordinator_url = %config.coordinator.url,
        "Configuration loaded"
    );

    // Log resource limits
    info!(
        max_memory_mb = config.resources.max_memory_mb,
        max_gpu_percent = config.resources.max_gpu_percent,
        enable_gpu = config.resources.enable_gpu,
        "Resource limits configured"
    );

    // Log storage paths
    info!(
        data_dir = %config.storage.data_dir,
        model_dir = %config.storage.model_dir,
        "Storage paths configured"
    );

    // Ensure storage directories exist
    ensure_directories(&config)?;

    // Build and run the tokio runtime
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(
            if config.resources.max_threads > 0 {
                config.resources.max_threads as usize
            } else {
                num_cpus::get().min(8)
            }
        )
        .thread_name("ai4all-worker")
        .build()
        .map_err(|e| Error::Internal(format!("Failed to create async runtime: {}", e)))?;

    runtime.block_on(async_worker_main(config))
}

/// Ensure required storage directories exist
fn ensure_directories(config: &WorkerConfig) -> Result<()> {
    let dirs = [
        &config.storage.data_dir,
        &config.storage.model_dir,
        &config.storage.temp_dir,
    ];

    for dir in dirs {
        let path = shellexpand::tilde(dir).to_string();
        let path = std::path::Path::new(&path);
        if !path.exists() {
            std::fs::create_dir_all(path).map_err(|e| Error::IoWrite {
                path: path.to_path_buf(),
                source: e,
            })?;
            info!(path = %path.display(), "Created directory");
        }
    }

    Ok(())
}

/// Async worker main loop
async fn async_worker_main(config: WorkerConfig) -> Result<()> {
    // Initialize health monitor
    let health_monitor = HealthMonitor::new();
    let sys_info = health_monitor.system_info();
    info!(
        cpu_count = sys_info.cpu_count,
        memory_mb = sys_info.total_memory_mb,
        os = %sys_info.os_name,
        arch = %sys_info.arch,
        "System info collected"
    );

    // First-run benchmark if needed
    let data_dir = shellexpand::tilde(&config.storage.data_dir).to_string();
    let first_run = FirstRunExperience::new(std::path::Path::new(&data_dir));
    if first_run.is_first_run() {
        info!("First run detected, running system benchmarks");
        match first_run.run_first_time_setup() {
            Ok(results) => {
                info!(
                    compute_score = results.compute_score,
                    estimated_tps = results.estimated_tokens_per_second,
                    "Benchmarks complete"
                );
            }
            Err(e) => {
                warn!(error = %e, "Benchmarks failed, continuing without benchmark data");
            }
        }
    }

    // Initialize backend registry
    let registry = Arc::new(RwLock::new(BackendRegistry::new()));

    // Register the mock backend (always available, used for testing and as fallback)
    {
        let reg = registry.read();
        if let Err(e) = reg.register(BackendType::Mock, BackendConfig::default()) {
            warn!(error = %e, "Failed to register mock backend");
        }
    }

    // Register CPU backend
    {
        let cpu_config = BackendConfig {
            num_threads: if config.resources.max_threads > 0 {
                Some(config.resources.max_threads)
            } else {
                None
            },
            context_size: 4096,
            batch_size: 512,
            gpu_layers: 0,
            use_mmap: true,
            use_mlock: false,
            seed: None,
        };

        let reg = registry.read();
        match reg.register(BackendType::Cpu, cpu_config) {
            Ok(_) => info!("CPU backend registered"),
            Err(e) => warn!(error = %e, "Failed to register CPU backend (llama feature may not be enabled)"),
        }
    }

    // Determine worker capabilities from registered backends
    let capabilities = build_worker_capabilities(&registry, &config);
    info!(
        supported_tasks = ?capabilities.supported_tasks,
        max_concurrent = capabilities.max_concurrent_tasks,
        gpu = capabilities.gpu_available,
        "Worker capabilities determined"
    );

    // Create the task executor
    let worker_id = config.worker.id.clone().unwrap_or_else(|| {
        format!("worker-{}", &uuid::Uuid::new_v4().to_string()[..8])
    });

    let executor_config = ExecutorConfig {
        max_concurrent_tasks: capabilities.max_concurrent_tasks as usize,
        default_timeout_secs: 300,
        detailed_metrics: true,
        queue_size: 100,
    };

    let (executor, mut result_rx) = TaskExecutor::new(
        executor_config,
        registry.clone(),
        worker_id.clone(),
    );
    let executor = Arc::new(executor);

    // Create coordinator client
    let coordinator_config = CoordinatorClientConfig {
        url: config.coordinator.url.clone(),
        connect_timeout: Duration::from_millis(config.coordinator.connect_timeout_ms),
        max_reconnect_attempts: config.coordinator.max_reconnect_attempts,
        initial_reconnect_delay: Duration::from_millis(config.coordinator.reconnect_interval_ms),
        max_reconnect_delay: Duration::from_secs(60),
        heartbeat_interval: Duration::from_millis(config.coordinator.heartbeat_interval_ms),
        message_queue_size: 100,
    };

    let worker_name = config.worker.name.clone()
        .unwrap_or_else(|| format!("AI4All Worker ({})", sys_info.hostname));

    let mut client = CoordinatorClient::new(
        coordinator_config,
        worker_name.clone(),
        capabilities,
    );

    info!(
        worker_id = %worker_id,
        worker_name = %worker_name,
        coordinator_url = %config.coordinator.url,
        "Starting worker"
    );

    // Start the coordinator client
    let mut event_rx = client.start().await?;

    // Set up graceful shutdown on Ctrl+C
    let shutdown_signal = tokio::signal::ctrl_c();
    tokio::pin!(shutdown_signal);

    // Periodic cleanup timer
    let mut cleanup_timer = tokio::time::interval(Duration::from_secs(300));
    cleanup_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // Periodic health check timer
    let mut health_timer = tokio::time::interval(Duration::from_secs(60));
    health_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    info!("Worker event loop started");

    // Main event loop
    loop {
        tokio::select! {
            // Ctrl+C shutdown
            _ = &mut shutdown_signal => {
                info!("Shutdown signal received");
                if let Err(e) = client.shutdown().await {
                    warn!(error = %e, "Error sending shutdown notification");
                }
                break;
            }

            // Events from coordinator
            event = event_rx.recv() => {
                match event {
                    Some(ClientEvent::Connected) => {
                        info!("Connected to coordinator");
                    }
                    Some(ClientEvent::Registered { worker_id: assigned_id }) => {
                        info!(worker_id = %assigned_id, "Registered with coordinator");
                    }
                    Some(ClientEvent::TaskAssigned(assignment)) => {
                        let task_id = assignment.task_id.clone();
                        let task_type = assignment.input.task_type();
                        info!(
                            task_id = %task_id,
                            task_type = %task_type,
                            priority = ?assignment.priority,
                            canary = assignment.is_canary,
                            "Task assigned"
                        );

                        // Update status to busy
                        let _ = client.update_status(WorkerStatus::Busy).await;

                        // Submit task to executor
                        match executor.submit(assignment).await {
                            Ok(_) => {
                                debug!(task_id = %task_id, "Task submitted to executor");
                            }
                            Err(e) => {
                                error!(task_id = %task_id, error = %e, "Failed to submit task");
                                // Send error result back to coordinator
                                let error_result = protocol::TaskResultMessage {
                                    task_id,
                                    worker_id: worker_id.clone(),
                                    success: false,
                                    output: None,
                                    error: Some(protocol::TaskError {
                                        code: format!("E{}", e.code() as u16),
                                        message: e.to_string(),
                                        retryable: e.is_retryable(),
                                        details: None,
                                    }),
                                    metrics: protocol::TaskMetrics::default(),
                                };
                                let _ = client.submit_result(error_result).await;
                            }
                        }
                    }
                    Some(ClientEvent::TaskCancelled { task_id, reason }) => {
                        info!(task_id = %task_id, reason = %reason, "Task cancelled by coordinator");
                        executor.cancel(&task_id);
                    }
                    Some(ClientEvent::Disconnected { reason }) => {
                        warn!(reason = %reason, "Disconnected from coordinator");
                    }
                    Some(ClientEvent::Reconnecting { attempt }) => {
                        info!(attempt = attempt, "Reconnecting to coordinator");
                    }
                    Some(ClientEvent::HeartbeatAck) => {
                        debug!("Heartbeat acknowledged");
                    }
                    Some(ClientEvent::ConfigUpdate(new_config)) => {
                        info!("Configuration update received from coordinator");
                        debug!(config = %new_config, "New config values");
                    }
                    Some(ClientEvent::Error { message, fatal }) => {
                        if fatal {
                            error!(message = %message, "Fatal error from coordinator");
                            break;
                        } else {
                            warn!(message = %message, "Error from coordinator");
                        }
                    }
                    None => {
                        info!("Coordinator event channel closed");
                        break;
                    }
                }
            }

            // Task results from executor
            result = result_rx.recv() => {
                match result {
                    Some(task_result) => {
                        info!(
                            task_id = %task_result.task_id,
                            success = task_result.success,
                            execution_ms = task_result.metrics.execution_time_ms,
                            "Task completed"
                        );

                        // Forward result to coordinator
                        if let Err(e) = client.submit_result(task_result).await {
                            error!(error = %e, "Failed to submit task result");
                        }

                        // Update status based on remaining work
                        if executor.running_count() == 0 && executor.queued_count() == 0 {
                            let _ = client.update_status(WorkerStatus::Ready).await;
                        }
                    }
                    None => {
                        warn!("Task result channel closed");
                    }
                }
            }

            // Periodic health check
            _ = health_timer.tick() => {
                if !health_monitor.is_healthy() {
                    let status = health_monitor.health_status();
                    warn!(
                        message = %status.message,
                        "System health degraded"
                    );
                }
            }

            // Periodic cleanup of completed tasks from tracker
            _ = cleanup_timer.tick() => {
                executor.tracker().cleanup_old_tasks(100);
                debug!(
                    completed = executor.completed_count(),
                    failed = executor.failed_count(),
                    running = executor.running_count(),
                    "Task tracker cleanup"
                );
            }
        }
    }

    // Graceful shutdown
    info!(
        completed = executor.completed_count(),
        failed = executor.failed_count(),
        "Worker shutting down"
    );

    Ok(())
}

/// Build worker capabilities from the registered backends
fn build_worker_capabilities(
    registry: &Arc<RwLock<BackendRegistry>>,
    config: &WorkerConfig,
) -> WorkerCapabilities {
    let reg = registry.read();
    let all_caps = reg.all_capabilities();

    // Collect all supported task types
    let mut supported_tasks: Vec<TaskType> = all_caps
        .values()
        .flat_map(|c| c.supported_tasks.clone())
        .collect();
    supported_tasks.sort_by_key(|t| *t as u8);
    supported_tasks.dedup();

    // Determine GPU status
    let gpu_available = all_caps.values().any(|c| c.gpu_available);
    let gpu_device = all_caps.values()
        .find_map(|c| c.gpu_device.clone());

    // Max context length from all backends
    let max_context_length = all_caps.values()
        .map(|c| c.max_context_length)
        .max()
        .unwrap_or(4096);

    let sys_info = system::SystemInfo::collect();

    WorkerCapabilities {
        supported_tasks,
        max_concurrent_tasks: 4, // Default concurrency
        available_memory_mb: sys_info.total_memory_mb,
        gpu_available,
        gpu_device,
        gpu_memory_mb: None,
        max_context_length,
        worker_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Run benchmarks to measure local compute capability
fn run_benchmark(iterations: u32, output: Option<String>) -> Result<()> {
    info!(iterations, "Running benchmarks...");

    let mut runner = BenchmarkRunner::new(iterations);
    if let Some(ref path) = output {
        runner = runner.with_results_path(PathBuf::from(path));
    }

    let results = runner.run()?;

    println!();
    println!("Benchmark Results ({} iterations):", iterations);
    println!("  CPU Single-Thread Score: {}", results.cpu.single_thread_score);
    println!("  CPU Multi-Thread Score:  {} ({} threads)",
        results.cpu.multi_thread_score, results.cpu.thread_count);
    println!("  Memory Score:            {}", results.memory.score);
    println!("  Overall Compute Score:   {}", results.compute_score);
    println!("  Estimated Throughput:    ~{:.0} tokens/sec", results.estimated_tokens_per_second);
    println!("  Duration:                {:.2}s", results.duration_secs);

    if let Some(ref path) = output {
        println!("  Results saved to: {}", path);
    }

    Ok(())
}

/// Handle configuration subcommands
fn handle_config_command(subcommand: cli::ConfigSubcommand) -> Result<()> {
    use cli::ConfigSubcommand;

    match subcommand {
        ConfigSubcommand::Show { config } => {
            let cfg = WorkerConfig::load(config.as_deref())?;
            println!("{}", toml::to_string_pretty(&cfg)?);
        }
        ConfigSubcommand::Init { path, force } => {
            config::init_config(path.as_deref(), force)?;
        }
        ConfigSubcommand::Validate { config } => {
            let path = config.as_deref();
            match WorkerConfig::load(path) {
                Ok(_) => {
                    println!("Configuration is valid.");
                }
                Err(e) => {
                    eprint!("{}", e.format_for_terminal());
                    std::process::exit(e.exit_code());
                }
            }
        }
    }

    Ok(())
}
