//! AI4All Worker - Distributed AI compute worker
//!
//! This is the main entry point for the AI4All worker binary.
//! The worker connects to the coordinator, receives AI work assignments,
//! executes them using local CPU/GPU resources, and returns results.

mod backend;
mod cli;
mod config;
mod coordinator;
mod crawler;
mod error;
mod executor;
#[cfg(feature = "gpu")]
mod gpu;
mod logging;
mod pairing;
mod peer;
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
use crate::peer::{GroupManager, GroupRole, MeshConfig, PeerEvent, PeerMesh, PeerRegistry};
use crate::protocol::{PeerMessage, WorkerCapabilities, WorkerStatus};
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
                pairing::run_pairing(api_url, name, *force)
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
            openai: None,
        };

        let reg = registry.read();
        match reg.register(BackendType::Cpu, cpu_config) {
            Ok(_) => info!("CPU backend registered"),
            Err(e) => warn!(error = %e, "Failed to register CPU backend (llama feature may not be enabled)"),
        }
    }

    // Register OpenAI backend (for API-based inference via OpenAI, Ollama, vLLM, etc.)
    if config.openai.enabled {
        use crate::backend::OpenAiConfig;

        let openai_config = BackendConfig {
            openai: Some(OpenAiConfig {
                base_url: config.openai.base_url.clone(),
                api_key: config.openai.api_key.clone(),
                default_model: config.openai.default_model.clone(),
                timeout_secs: config.openai.timeout_secs,
                max_retries: config.openai.max_retries,
            }),
            ..BackendConfig::default()
        };

        let reg = registry.read();
        match reg.register(BackendType::OpenAi, openai_config) {
            Ok(_) => info!(
                base_url = %config.openai.base_url,
                model = %config.openai.default_model,
                "OpenAI backend registered"
            ),
            Err(e) => warn!(error = %e, "Failed to register OpenAI backend"),
        }
    }

    // Register Crawler backend if web crawling is enabled
    if config.crawler.enabled {
        use crate::backend::CrawlerBackend;
        let crawler_backend = CrawlerBackend::new(&config.crawler, &config.openai);
        let reg = registry.read();
        reg.register_boxed(BackendType::Crawler, Box::new(crawler_backend));
        info!("Crawler backend registered");
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

    // Collect task type strings before capabilities is moved into CoordinatorClient
    let supported_task_strings: Vec<String> = capabilities.supported_tasks
        .iter()
        .map(|t| t.to_string())
        .collect();

    // Initialize peer-to-peer mesh networking
    let peer_registry = Arc::new(PeerRegistry::new());
    let group_manager = Arc::new(GroupManager::new(worker_id.clone()));

    let mesh_config = MeshConfig {
        listen_port: config.peer.listen_port,
        max_peers: config.peer.max_peers,
        ..MeshConfig::default()
    };

    let (peer_event_tx, mut peer_event_rx) = tokio::sync::mpsc::channel::<PeerEvent>(100);
    let peer_mesh = Arc::new(PeerMesh::new(
        mesh_config,
        worker_id.clone(),
        capabilities.clone(),
        peer_registry.clone(),
        peer_event_tx,
    ));

    // Start peer mesh listener if enabled
    if config.peer.enabled {
        match peer_mesh.start().await {
            Ok(addr) => {
                info!(listen_addr = %addr, "Peer mesh listener started");
            }
            Err(e) => {
                warn!(error = %e, "Failed to start peer mesh listener, P2P disabled");
            }
        }
    }

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

    // HTTP task polling setup (for on-demand task API)
    let coordinator_http_base = config.coordinator.url
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .trim_end_matches('/')
        .to_string();

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let mut task_poll_timer = tokio::time::interval(Duration::from_secs(5));
    task_poll_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // Track task IDs received via HTTP polling (vs WebSocket)
    let mut http_polled_tasks: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Self-register as a peer if account_id and secret_key are configured.
    // This makes the worker visible for HTTP task polling.
    let mut coordinator_worker_id = worker_id.clone();
    if let (Some(account_id), Some(secret_key)) = (&config.worker.account_id, &config.worker.secret_key) {
        let listen_addr = peer_mesh.listen_addr()
            .map(|a| a.to_string())
            .unwrap_or_else(|| format!("127.0.0.1:{}", config.peer.listen_port));

        // Sign canonical auth message: "AI4ALL:v1:{accountId}:{timestamp}"
        use pqcrypto_dilithium::dilithium3;
        use pqcrypto_traits::sign::{DetachedSignature, SecretKey as PqSecretKey};
        let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let message = format!("AI4ALL:v1:{}:{}", account_id, timestamp);
        let maybe_sig_hex: Option<String> = (|| {
            let sk_bytes = hex::decode(secret_key).ok()?;
            let sk = dilithium3::SecretKey::from_bytes(&sk_bytes).ok()?;
            let sig = dilithium3::detached_sign(message.as_bytes(), &sk);
            Some(hex::encode(sig.as_bytes()))
        })();

        match maybe_sig_hex {
            None => {
                warn!("Failed to sign peer registration — check secret_key in config");
            }
            Some(sig_hex) => {
                let register_body = serde_json::json!({
                    "accountId": account_id,
                    "timestamp": timestamp,
                    "signature": sig_hex,
                    "listenAddr": listen_addr,
                    "capabilities": {
                        "supportedTasks": supported_task_strings,
                        "maxConcurrentTasks": 4,
                        "availableMemoryMb": sys_info.total_memory_mb,
                        "gpuAvailable": false,
                        "maxContextLength": 4096,
                        "workerVersion": env!("CARGO_PKG_VERSION"),
                    }
                });

                let url = format!("{}/peers/register", coordinator_http_base);
                match http_client.post(&url).json(&register_body).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(body) = resp.json::<serde_json::Value>().await {
                            if let Some(wid) = body["workerId"].as_str() {
                                coordinator_worker_id = wid.to_string();
                                info!(
                                    worker_id = %coordinator_worker_id,
                                    account_id = %account_id,
                                    "Registered as peer with coordinator"
                                );
                            }
                        }
                    }
                    Ok(resp) => {
                        let status = resp.status();
                        let text = resp.text().await.unwrap_or_default();
                        warn!(
                            status = %status,
                            body = %text,
                            "Peer registration failed (task polling will not work)"
                        );
                    }
                    Err(e) => {
                        warn!(
                            error = %e,
                            "Could not reach coordinator for peer registration"
                        );
                    }
                }
            }
        }
    } else {
        info!("No account_id/secret_key configured — skipping peer registration (task polling requires registration)");
    }

    // Spawn background crawler service if seeds are configured
    if config.crawler.enabled && !config.crawler.seeds.is_empty() {
        if let (Some(account_id), Some(secret_key)) = (&config.worker.account_id, &config.worker.secret_key) {
            use crate::crawler::CrawlerService;
            let svc = CrawlerService::new(config.crawler.clone(), config.openai.clone());
            svc.start(
                coordinator_http_base.clone(),
                account_id.clone(),
                secret_key.clone(),
            );
            info!(seeds = config.crawler.seeds.len(), "Background crawler started");
        } else {
            warn!("Crawler enabled with seeds but no account_id/secret_key — background crawler disabled");
        }
    }

    info!(
        coordinator_http = %coordinator_http_base,
        polling_worker_id = %coordinator_worker_id,
        "Worker event loop started"
    );

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
                        // Announce P2P listen address if mesh is running
                        if let Some(addr) = peer_mesh.listen_addr() {
                            info!(peer_addr = %addr, "Announcing P2P address to coordinator");
                        }
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
                    Some(ClientEvent::PeerDirectory(peers)) => {
                        info!(count = peers.len(), "Received peer directory");
                        for entry in &peers {
                            if entry.worker_id == worker_id {
                                continue; // Skip self
                            }
                            if let Ok(addr) = entry.listen_addr.parse() {
                                let peer_info = peer::PeerInfo {
                                    worker_id: entry.worker_id.clone(),
                                    name: entry.name.clone(),
                                    listen_addr: addr,
                                    capabilities: entry.capabilities.clone(),
                                    status: WorkerStatus::Ready,
                                    last_seen: std::time::Instant::now(),
                                    latency_ms: None,
                                    groups: vec![],
                                };
                                peer_registry.register(peer_info);
                            }
                        }
                        // Auto-connect to discovered peers if enabled
                        if config.peer.auto_connect {
                            let all_peers = peer_registry.all_peers();
                            let mesh = peer_mesh.clone();
                            tokio::spawn(async move {
                                for p in &all_peers {
                                    if let Err(e) = mesh.connect(p).await {
                                        debug!(
                                            peer = %p.worker_id,
                                            error = %e,
                                            "Failed to connect to peer"
                                        );
                                    }
                                }
                            });
                        }
                    }
                    Some(ClientEvent::PeerDiscovered(entry)) => {
                        if entry.worker_id != worker_id {
                            info!(peer = %entry.worker_id, "New peer discovered");
                            if let Ok(addr) = entry.listen_addr.parse() {
                                let peer_info = peer::PeerInfo {
                                    worker_id: entry.worker_id.clone(),
                                    name: entry.name.clone(),
                                    listen_addr: addr,
                                    capabilities: entry.capabilities.clone(),
                                    status: WorkerStatus::Ready,
                                    last_seen: std::time::Instant::now(),
                                    latency_ms: None,
                                    groups: vec![],
                                };
                                peer_registry.register(peer_info.clone());
                                if config.peer.auto_connect {
                                    let mesh = peer_mesh.clone();
                                    tokio::spawn(async move {
                                        if let Err(e) = mesh.connect(&peer_info).await {
                                            debug!(error = %e, "Failed to connect to new peer");
                                        }
                                    });
                                }
                            }
                        }
                    }
                    Some(ClientEvent::PeerLeft { worker_id: peer_id }) => {
                        info!(peer = %peer_id, "Peer left network");
                        peer_registry.remove(&peer_id);
                        let mesh = peer_mesh.clone();
                        let pid = peer_id.clone();
                        tokio::spawn(async move {
                            mesh.disconnect(&pid);
                        });
                    }
                    Some(ClientEvent::GroupAssigned(group_msg)) => {
                        info!(
                            group_id = %group_msg.group_id,
                            "Assigned to work group"
                        );
                        // Convert wire-format purpose to internal GroupPurpose
                        let purpose = match group_msg.purpose {
                            protocol::GroupPurposeMessage::ModelShard { model_id, total_shards } => {
                                peer::GroupPurpose::ModelShard { model_id, total_shards }
                            }
                            protocol::GroupPurposeMessage::TaskPipeline { pipeline_id, stages } => {
                                peer::GroupPurpose::TaskPipeline { pipeline_id, stages }
                            }
                            protocol::GroupPurposeMessage::General => {
                                peer::GroupPurpose::General
                            }
                        };
                        let group = peer::WorkGroup {
                            group_id: group_msg.group_id.clone(),
                            purpose,
                            members: group_msg.members.iter().map(|m| {
                                peer::GroupMember {
                                    worker_id: m.worker_id.clone(),
                                    role: if m.role == "coordinator" {
                                        GroupRole::Coordinator
                                    } else {
                                        GroupRole::Member
                                    },
                                    shard_index: m.shard_index,
                                    pipeline_stage: m.pipeline_stage.map(|s| s as usize),
                                    ready: false,
                                }
                            }).collect(),
                            created_at: chrono::Utc::now(),
                        };
                        group_manager.add_group(group);
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
                        let is_http_task = http_polled_tasks.remove(&task_result.task_id);
                        info!(
                            task_id = %task_result.task_id,
                            success = task_result.success,
                            execution_ms = task_result.metrics.execution_time_ms,
                            source = if is_http_task { "http" } else { "ws" },
                            "Task completed"
                        );

                        if is_http_task {
                            // POST result back to coordinator via HTTP task API
                            let output_text = task_result.output.as_ref().map(|o| match o {
                                types::TaskOutput::TextCompletion(tc) => tc.text.clone(),
                                other => format!("{:?}", other),
                            }).unwrap_or_default();

                            let finish_reason = if task_result.success { "stop" } else { "error" };

                            let complete_body = serde_json::json!({
                                "workerId": coordinator_worker_id,
                                "taskId": task_result.task_id,
                                "output": output_text,
                                "finishReason": finish_reason,
                                "tokenUsage": {
                                    "promptTokens": task_result.metrics.tokens_processed.unwrap_or(0) / 2,
                                    "completionTokens": (task_result.metrics.tokens_processed.unwrap_or(0) + 1) / 2,
                                    "totalTokens": task_result.metrics.tokens_processed.unwrap_or(0),
                                },
                                "executionTimeMs": task_result.metrics.execution_time_ms,
                                "error": task_result.error.as_ref().map(|e| &e.message),
                            });

                            let url = format!("{}/tasks/complete", coordinator_http_base);
                            match http_client.post(&url).json(&complete_body).send().await {
                                Ok(resp) if resp.status().is_success() => {
                                    info!(task_id = %task_result.task_id, "HTTP task result posted");
                                }
                                Ok(resp) => {
                                    warn!(
                                        task_id = %task_result.task_id,
                                        status = %resp.status(),
                                        "Failed to post HTTP task result"
                                    );
                                }
                                Err(e) => {
                                    error!(
                                        task_id = %task_result.task_id,
                                        error = %e,
                                        "Failed to post HTTP task result"
                                    );
                                }
                            }
                        } else {
                            // Forward result to coordinator via WebSocket
                            if let Err(e) = client.submit_result(task_result).await {
                                error!(error = %e, "Failed to submit task result");
                            }
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

            // Events from peer mesh
            peer_event = peer_event_rx.recv() => {
                match peer_event {
                    Some(PeerEvent::Connected { worker_id: peer_id }) => {
                        info!(peer = %peer_id, "Peer connected");
                    }
                    Some(PeerEvent::Disconnected { worker_id: peer_id, reason }) => {
                        info!(peer = %peer_id, reason = %reason, "Peer disconnected");
                    }
                    Some(PeerEvent::MessageReceived { from, message }) => {
                        match message {
                            PeerMessage::PeerStatus { status, .. } => {
                                debug!(peer = %from, status = ?status, "Peer status update");
                                peer_registry.update_status(&from, status);
                            }
                            PeerMessage::Ping { seq } => {
                                debug!(peer = %from, seq, "Peer ping");
                                // Pong is handled by the mesh read loop
                            }
                            PeerMessage::GroupJoin { group_id, role } => {
                                let role = if role == "coordinator" {
                                    GroupRole::Coordinator
                                } else {
                                    GroupRole::Member
                                };
                                group_manager.add_member(&group_id, &from, role);
                                info!(peer = %from, group = %group_id, "Peer joined group");
                            }
                            PeerMessage::GroupLeave { group_id } => {
                                group_manager.remove_member(&group_id, &from);
                                info!(peer = %from, group = %group_id, "Peer left group");
                            }
                            PeerMessage::ShardReady { group_id, shard_index } => {
                                group_manager.set_member_ready(&group_id, &from);
                                info!(
                                    peer = %from,
                                    group = %group_id,
                                    shard = shard_index,
                                    "Peer shard ready"
                                );
                                if group_manager.all_members_ready(&group_id) {
                                    info!(group = %group_id, "All shards ready");
                                }
                            }
                            _ => {
                                debug!(
                                    peer = %from,
                                    msg_type = %message.type_name(),
                                    "Unhandled peer message"
                                );
                            }
                        }
                    }
                    Some(PeerEvent::ListenerReady { addr }) => {
                        info!(addr = %addr, "Peer mesh listener ready");
                    }
                    Some(PeerEvent::Error { worker_id: peer_id, error }) => {
                        warn!(peer = ?peer_id, error = %error, "Peer error");
                    }
                    None => {
                        debug!("Peer event channel closed");
                    }
                }
            }

            // HTTP task polling (on-demand task API)
            _ = task_poll_timer.tick() => {
                if executor.can_accept() {
                    let url = format!(
                        "{}/tasks/pending?workerId={}&limit=1",
                        coordinator_http_base, coordinator_worker_id
                    );
                    match http_client.get(&url).send().await {
                        Ok(resp) if resp.status().is_success() => {
                            if let Ok(body) = resp.json::<serde_json::Value>().await {
                                if let Some(tasks) = body["tasks"].as_array() {
                                    for task_json in tasks {
                                        if let (Some(task_id), Some(prompt)) = (
                                            task_json["taskId"].as_str(),
                                            task_json["prompt"].as_str(),
                                        ) {
                                            let model = task_json["model"]
                                                .as_str()
                                                .unwrap_or("default");
                                            let system_prompt = task_json["systemPrompt"]
                                                .as_str()
                                                .map(|s| s.to_string());

                                            let priority = match task_json["priority"].as_str() {
                                                Some("CRITICAL") => protocol::TaskPriority::Critical,
                                                Some("HIGH") => protocol::TaskPriority::High,
                                                Some("LOW") => protocol::TaskPriority::Low,
                                                _ => protocol::TaskPriority::Normal,
                                            };

                                            // Build TaskAssignmentMessage from HTTP response
                                            let assignment = protocol::TaskAssignmentMessage {
                                                task_id: task_id.to_string(),
                                                block_id: None,
                                                day_id: None,
                                                priority,
                                                deadline: None,
                                                model_id: model.to_string(),
                                                input: types::TaskInput::TextCompletion(
                                                    types::TextCompletionInput {
                                                        prompt: prompt.to_string(),
                                                        system_prompt,
                                                        params: types::GenerationParams {
                                                            max_tokens: task_json["params"]["max_tokens"]
                                                                .as_u64()
                                                                .map(|v| v as u32)
                                                                .unwrap_or(4096),
                                                            temperature: task_json["params"]["temperature"]
                                                                .as_f64()
                                                                .map(|v| v as f32)
                                                                .unwrap_or(0.7),
                                                            top_p: task_json["params"]["top_p"]
                                                                .as_f64()
                                                                .map(|v| v as f32)
                                                                .unwrap_or(0.9),
                                                            ..types::GenerationParams::default()
                                                        },
                                                    },
                                                ),
                                                is_canary: false,
                                                expected_hash: None,
                                                timeout_secs: 300,
                                            };

                                            // Track as HTTP-polled task
                                            http_polled_tasks.insert(task_id.to_string());

                                            info!(
                                                task_id = %task_id,
                                                model = %model,
                                                priority = ?priority,
                                                "HTTP-polled task received"
                                            );

                                            let _ = client.update_status(WorkerStatus::Busy).await;

                                            match executor.submit(assignment).await {
                                                Ok(_) => {
                                                    debug!(task_id = %task_id, "HTTP task submitted to executor");
                                                }
                                                Err(e) => {
                                                    error!(task_id = %task_id, error = %e, "Failed to submit HTTP task");
                                                    http_polled_tasks.remove(task_id);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Ok(_) => {
                            // Non-success status (404, 400, etc.) — silently skip
                        }
                        Err(e) => {
                            debug!(error = %e, "Task poll request failed");
                        }
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
        connected_peers = peer_mesh.connected_peers().len(),
        "Worker shutting down"
    );

    // Shut down peer mesh
    peer_mesh.shutdown();

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
