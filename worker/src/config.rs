//! Configuration system for AI4All Worker
//!
//! Supports multiple configuration sources with the following precedence (highest to lowest):
//! 1. CLI arguments
//! 2. Environment variables (AI4ALL_* prefix)
//! 3. Configuration file (TOML)
//! 4. Default values

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::error::{Error, Result};

/// Main worker configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkerConfig {
    /// Worker identity and basic settings
    pub worker: WorkerSettings,

    /// Coordinator connection settings
    pub coordinator: CoordinatorSettings,

    /// Resource limits
    pub resources: ResourceSettings,

    /// GPU settings
    pub gpu: GpuSettings,

    /// Plugin settings
    pub plugins: PluginSettings,

    /// Logging configuration
    pub logging: LoggingSettings,

    /// Data storage paths
    pub storage: StorageSettings,

    /// Peer-to-peer communication settings
    pub peer: PeerSettings,

    /// OpenAI-compatible API backend settings
    pub openai: OpenAiSettings,
}

/// Worker identity settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkerSettings {
    /// Unique worker identifier (auto-generated if not set)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Human-readable worker name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Worker tags for filtering assignments
    #[serde(default)]
    pub tags: Vec<String>,

    /// Account ID for coordinator registration (from POST /nodes/register)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,

    /// Node key for authentication (returned by POST /nodes/register)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_key: Option<String>,
}

/// Coordinator connection settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CoordinatorSettings {
    /// Coordinator WebSocket URL
    pub url: String,

    /// Reconnection interval in milliseconds
    pub reconnect_interval_ms: u64,

    /// Maximum reconnection attempts (0 = infinite)
    pub max_reconnect_attempts: u32,

    /// Connection timeout in milliseconds
    pub connect_timeout_ms: u64,

    /// Heartbeat interval in milliseconds
    pub heartbeat_interval_ms: u64,
}

/// Resource limit settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ResourceSettings {
    /// Maximum memory usage in MB
    pub max_memory_mb: u64,

    /// Maximum GPU memory usage in MB (0 = no limit)
    pub max_gpu_memory_mb: u64,

    /// Maximum GPU utilization percentage (1-100)
    pub max_gpu_percent: u8,

    /// Maximum CPU threads to use (0 = auto)
    pub max_threads: u32,

    /// Enable GPU acceleration
    pub enable_gpu: bool,
}

/// Logging settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LoggingSettings {
    /// Log level: trace, debug, info, warn, error
    pub level: String,

    /// Log file path (empty = no file logging)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,

    /// Maximum log file size in MB before rotation
    pub max_file_size_mb: u64,

    /// Number of rotated log files to keep
    pub max_files: u32,

    /// Enable JSON formatted logging
    pub json_format: bool,
}

/// Storage path settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StorageSettings {
    /// Base data directory
    pub data_dir: String,

    /// Model cache directory
    pub model_dir: String,

    /// Temporary files directory
    pub temp_dir: String,
}

/// GPU configuration settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GpuSettings {
    /// Enable GPU acceleration
    pub enable: bool,

    /// Preferred GPU device ID (None = auto-select)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<u32>,

    /// Number of layers to offload to GPU (None = auto)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_gpu_layers: Option<u32>,

    /// Preferred vendor priority (empty = default: AMD > NVIDIA > Intel)
    #[serde(default)]
    pub vendor_priority: Vec<String>,

    /// Force specific backend (vulkan, cuda, rocm)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_backend: Option<String>,
}

/// Peer-to-peer communication settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PeerSettings {
    /// Enable peer-to-peer mesh networking
    pub enabled: bool,

    /// TCP listen port for peer connections (0 = auto-assign)
    pub listen_port: u16,

    /// Maximum number of peer connections
    pub max_peers: usize,

    /// Ping interval in milliseconds for peer health checks
    pub ping_interval_ms: u64,

    /// Timeout in milliseconds before a peer is considered stale
    pub stale_timeout_ms: u64,

    /// Auto-connect to discovered peers
    pub auto_connect: bool,
}

/// OpenAI-compatible API backend settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OpenAiSettings {
    /// Enable OpenAI-compatible API backend
    pub enabled: bool,

    /// API base URL (e.g., "https://api.openai.com/v1", "http://localhost:11434/v1")
    pub base_url: String,

    /// API key (empty string for local servers like Ollama)
    pub api_key: String,

    /// Default model identifier
    pub default_model: String,

    /// Request timeout in seconds
    pub timeout_secs: u64,

    /// Maximum retries on transient failures
    pub max_retries: u32,
}

/// Plugin system settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PluginSettings {
    /// Directory for downloaded plugins
    pub plugin_dir: String,

    /// Auto-download missing plugins
    pub auto_download: bool,

    /// Plugin registry URL
    pub registry_url: String,

    /// Verify plugin checksums
    pub verify_checksums: bool,

    /// Download timeout in seconds
    pub download_timeout_secs: u64,
}

// Default implementations

impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            worker: WorkerSettings::default(),
            coordinator: CoordinatorSettings::default(),
            resources: ResourceSettings::default(),
            gpu: GpuSettings::default(),
            plugins: PluginSettings::default(),
            logging: LoggingSettings::default(),
            storage: StorageSettings::default(),
            peer: PeerSettings::default(),
            openai: OpenAiSettings::default(),
        }
    }
}

impl Default for WorkerSettings {
    fn default() -> Self {
        Self {
            id: None,
            name: None,
            tags: vec![],
            account_id: None,
            node_key: None,
        }
    }
}

impl Default for CoordinatorSettings {
    fn default() -> Self {
        Self {
            url: "wss://coordinator.ai4all.network".to_string(),
            reconnect_interval_ms: 5000,
            max_reconnect_attempts: 0, // Infinite
            connect_timeout_ms: 30000,
            heartbeat_interval_ms: 30000,
        }
    }
}

impl Default for ResourceSettings {
    fn default() -> Self {
        Self {
            max_memory_mb: 8192,
            max_gpu_memory_mb: 0,
            max_gpu_percent: 75,
            max_threads: 0, // Auto-detect
            enable_gpu: true,
        }
    }
}

impl Default for LoggingSettings {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            file: None,
            max_file_size_mb: 100,
            max_files: 5,
            json_format: false,
        }
    }
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            data_dir: "~/.ai4all/worker".to_string(),
            model_dir: "~/.ai4all/worker/models".to_string(),
            temp_dir: "~/.ai4all/worker/temp".to_string(),
        }
    }
}

impl Default for GpuSettings {
    fn default() -> Self {
        Self {
            enable: true,
            device_id: None,
            n_gpu_layers: None,
            vendor_priority: vec![],
            force_backend: None,
        }
    }
}

impl Default for PeerSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            listen_port: 0, // Auto-assign
            max_peers: 32,
            ping_interval_ms: 15000,
            stale_timeout_ms: 60000,
            auto_connect: true,
        }
    }
}

impl Default for OpenAiSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            base_url: "http://localhost:11434/v1".to_string(),
            api_key: String::new(),
            default_model: "llama3".to_string(),
            timeout_secs: 120,
            max_retries: 2,
        }
    }
}

impl Default for PluginSettings {
    fn default() -> Self {
        Self {
            plugin_dir: "~/.ai4all/plugins".to_string(),
            auto_download: true,
            registry_url: "https://plugins.ai4all.network".to_string(),
            verify_checksums: true,
            download_timeout_secs: 300,
        }
    }
}

impl WorkerConfig {
    /// Load configuration from file with environment variable overrides
    pub fn load(config_path: Option<&str>) -> Result<Self> {
        let mut config = Self::default();

        // 1. Load from config file if it exists
        let config_file = Self::find_config_file(config_path)?;
        if let Some(path) = config_file {
            debug!(path = %path.display(), "Loading configuration file");
            let content = fs::read_to_string(&path)
                .map_err(|e| Error::Config(format!("Failed to read config file: {}", e)))?;
            config = toml::from_str(&content)
                .map_err(|e| Error::Config(format!("Failed to parse config file: {}", e)))?;
            info!(path = %path.display(), "Configuration loaded from file");
        }

        // 2. Apply environment variable overrides
        config.apply_env_overrides();

        // 3. Expand paths
        config.expand_paths();

        // 4. Validate
        config.validate()?;

        Ok(config)
    }

    /// Find the configuration file to use
    fn find_config_file(explicit_path: Option<&str>) -> Result<Option<PathBuf>> {
        // If explicit path provided, use it (error if not found)
        if let Some(path) = explicit_path {
            let expanded = shellexpand::tilde(path);
            let path = PathBuf::from(expanded.as_ref());
            if path.exists() {
                return Ok(Some(path));
            } else {
                return Err(Error::Config(format!(
                    "Configuration file not found: {}",
                    path.display()
                )));
            }
        }

        // Search in standard locations
        let search_paths = [
            // Current directory
            PathBuf::from("ai4all-worker.toml"),
            PathBuf::from("config.toml"),
            // User config directory
            dirs::config_dir()
                .map(|p| p.join("ai4all").join("worker.toml"))
                .unwrap_or_default(),
            // Home directory
            dirs::home_dir()
                .map(|p| p.join(".ai4all").join("worker.toml"))
                .unwrap_or_default(),
            // System config (Linux)
            PathBuf::from("/etc/ai4all/worker.toml"),
        ];

        for path in &search_paths {
            if path.exists() {
                debug!(path = %path.display(), "Found configuration file");
                return Ok(Some(path.clone()));
            }
        }

        debug!("No configuration file found, using defaults");
        Ok(None)
    }

    /// Apply environment variable overrides
    fn apply_env_overrides(&mut self) {
        // Worker settings
        if let Ok(val) = std::env::var("AI4ALL_WORKER_ID") {
            self.worker.id = Some(val);
        }
        if let Ok(val) = std::env::var("AI4ALL_WORKER_NAME") {
            self.worker.name = Some(val);
        }
        if let Ok(val) = std::env::var("AI4ALL_ACCOUNT_ID") {
            self.worker.account_id = Some(val);
        }
        if let Ok(val) = std::env::var("AI4ALL_NODE_KEY") {
            self.worker.node_key = Some(val);
        }

        // Coordinator settings
        if let Ok(val) = std::env::var("AI4ALL_COORDINATOR_URL") {
            self.coordinator.url = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_RECONNECT_INTERVAL_MS") {
            if let Ok(n) = val.parse() {
                self.coordinator.reconnect_interval_ms = n;
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_MAX_RECONNECT_ATTEMPTS") {
            if let Ok(n) = val.parse() {
                self.coordinator.max_reconnect_attempts = n;
            }
        }

        // Resource settings
        if let Ok(val) = std::env::var("AI4ALL_MAX_MEMORY_MB") {
            if let Ok(n) = val.parse() {
                self.resources.max_memory_mb = n;
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_MAX_GPU_MEMORY_MB") {
            if let Ok(n) = val.parse() {
                self.resources.max_gpu_memory_mb = n;
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_MAX_GPU_PERCENT") {
            if let Ok(n) = val.parse() {
                self.resources.max_gpu_percent = n;
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_MAX_THREADS") {
            if let Ok(n) = val.parse() {
                self.resources.max_threads = n;
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_ENABLE_GPU") {
            self.resources.enable_gpu = val.to_lowercase() == "true" || val == "1";
        }

        // Logging settings
        if let Ok(val) = std::env::var("AI4ALL_LOG_LEVEL") {
            self.logging.level = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_LOG_FILE") {
            self.logging.file = Some(val);
        }
        if let Ok(val) = std::env::var("AI4ALL_LOG_JSON") {
            self.logging.json_format = val.to_lowercase() == "true" || val == "1";
        }

        // Storage settings
        if let Ok(val) = std::env::var("AI4ALL_DATA_DIR") {
            self.storage.data_dir = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_MODEL_DIR") {
            self.storage.model_dir = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_TEMP_DIR") {
            self.storage.temp_dir = val;
        }

        // GPU settings
        if let Ok(val) = std::env::var("AI4ALL_GPU_ENABLE") {
            self.gpu.enable = val.to_lowercase() == "true" || val == "1";
        }
        if let Ok(val) = std::env::var("AI4ALL_GPU_DEVICE_ID") {
            if let Ok(n) = val.parse() {
                self.gpu.device_id = Some(n);
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_GPU_LAYERS") {
            if let Ok(n) = val.parse() {
                self.gpu.n_gpu_layers = Some(n);
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_GPU_BACKEND") {
            self.gpu.force_backend = Some(val);
        }

        // Peer settings
        if let Ok(val) = std::env::var("AI4ALL_PEER_ENABLED") {
            self.peer.enabled = val.to_lowercase() == "true" || val == "1";
        }
        if let Ok(val) = std::env::var("AI4ALL_PEER_PORT") {
            if let Ok(n) = val.parse() {
                self.peer.listen_port = n;
            }
        }
        if let Ok(val) = std::env::var("AI4ALL_PEER_MAX_PEERS") {
            if let Ok(n) = val.parse() {
                self.peer.max_peers = n;
            }
        }

        // OpenAI settings
        if let Ok(val) = std::env::var("AI4ALL_OPENAI_ENABLED") {
            self.openai.enabled = val.to_lowercase() == "true" || val == "1";
        }
        if let Ok(val) = std::env::var("AI4ALL_OPENAI_BASE_URL") {
            self.openai.base_url = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_OPENAI_API_KEY") {
            self.openai.api_key = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_OPENAI_MODEL") {
            self.openai.default_model = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_OPENAI_TIMEOUT_SECS") {
            if let Ok(n) = val.parse() {
                self.openai.timeout_secs = n;
            }
        }

        // Plugin settings
        if let Ok(val) = std::env::var("AI4ALL_PLUGIN_DIR") {
            self.plugins.plugin_dir = val;
        }
        if let Ok(val) = std::env::var("AI4ALL_PLUGIN_AUTO_DOWNLOAD") {
            self.plugins.auto_download = val.to_lowercase() == "true" || val == "1";
        }
        if let Ok(val) = std::env::var("AI4ALL_PLUGIN_REGISTRY_URL") {
            self.plugins.registry_url = val;
        }
    }

    /// Expand ~ and other path variables
    fn expand_paths(&mut self) {
        self.storage.data_dir = expand_path(&self.storage.data_dir);
        self.storage.model_dir = expand_path(&self.storage.model_dir);
        self.storage.temp_dir = expand_path(&self.storage.temp_dir);
        self.plugins.plugin_dir = expand_path(&self.plugins.plugin_dir);

        if let Some(ref file) = self.logging.file {
            self.logging.file = Some(expand_path(file));
        }
    }

    /// Validate the configuration
    fn validate(&self) -> Result<()> {
        // Validate coordinator URL
        if self.coordinator.url.is_empty() {
            return Err(Error::Config("Coordinator URL cannot be empty".to_string()));
        }
        if !self.coordinator.url.starts_with("ws://") && !self.coordinator.url.starts_with("wss://") {
            return Err(Error::Config(
                "Coordinator URL must start with ws:// or wss://".to_string(),
            ));
        }

        // Validate GPU percentage
        if self.resources.max_gpu_percent > 100 {
            return Err(Error::Config(
                "max_gpu_percent must be between 0 and 100".to_string(),
            ));
        }

        // Validate log level
        let valid_levels = ["trace", "debug", "info", "warn", "error"];
        if !valid_levels.contains(&self.logging.level.to_lowercase().as_str()) {
            return Err(Error::Config(format!(
                "Invalid log level '{}'. Must be one of: {}",
                self.logging.level,
                valid_levels.join(", ")
            )));
        }

        Ok(())
    }

    /// Get the data directory as a PathBuf
    pub fn data_dir(&self) -> PathBuf {
        PathBuf::from(&self.storage.data_dir)
    }

    /// Get the model directory as a PathBuf
    pub fn model_dir(&self) -> PathBuf {
        PathBuf::from(&self.storage.model_dir)
    }

    /// Get the plugin directory as a PathBuf
    pub fn plugin_dir(&self) -> PathBuf {
        PathBuf::from(&self.plugins.plugin_dir)
    }
}

/// Expand ~ and environment variables in paths
fn expand_path(path: &str) -> String {
    shellexpand::full(path)
        .unwrap_or_else(|_| std::borrow::Cow::Borrowed(path))
        .into_owned()
}

/// Initialize a new configuration file
pub fn init_config(path: Option<&str>, force: bool) -> Result<()> {
    let config_path = path
        .map(|p| PathBuf::from(expand_path(p)))
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".ai4all")
                .join("worker.toml")
        });

    // Check if file exists
    if config_path.exists() && !force {
        return Err(Error::Config(format!(
            "Configuration file already exists: {}. Use --force to overwrite.",
            config_path.display()
        )));
    }

    // Create parent directories
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| Error::Config(format!("Failed to create config directory: {}", e)))?;
    }

    // Generate default config with comments
    let config_content = generate_default_config();

    // Write the file
    fs::write(&config_path, config_content)
        .map_err(|e| Error::Config(format!("Failed to write config file: {}", e)))?;

    println!("Configuration file created: {}", config_path.display());
    Ok(())
}

/// Generate default configuration content with comments
fn generate_default_config() -> String {
    r#"# AI4All Worker Configuration
# https://github.com/ai4all/worker

[worker]
# Unique worker identifier (auto-generated if not set)
# id = "worker-abc123"

# Human-readable worker name
# name = "My Worker"

# Tags for filtering work assignments
tags = []

[coordinator]
# Coordinator WebSocket URL
url = "wss://coordinator.ai4all.network"

# Reconnection interval in milliseconds
reconnect_interval_ms = 5000

# Maximum reconnection attempts (0 = infinite)
max_reconnect_attempts = 0

# Connection timeout in milliseconds
connect_timeout_ms = 30000

# Heartbeat interval in milliseconds
heartbeat_interval_ms = 30000

[resources]
# Maximum memory usage in MB
max_memory_mb = 8192

# Maximum GPU memory usage in MB (0 = no limit)
max_gpu_memory_mb = 0

# Maximum GPU utilization percentage (1-100)
max_gpu_percent = 75

# Maximum CPU threads to use (0 = auto-detect)
max_threads = 0

# Enable GPU acceleration
enable_gpu = true

[logging]
# Log level: trace, debug, info, warn, error
level = "info"

# Log file path (comment out to disable file logging)
# file = "~/.ai4all/worker/logs/worker.log"

# Maximum log file size in MB before rotation
max_file_size_mb = 100

# Number of rotated log files to keep
max_files = 5

# Enable JSON formatted logging
json_format = false

[storage]
# Base data directory
data_dir = "~/.ai4all/worker"

# Model cache directory
model_dir = "~/.ai4all/worker/models"

# Temporary files directory
temp_dir = "~/.ai4all/worker/temp"

[peer]
# Enable peer-to-peer mesh networking
enabled = true

# TCP listen port for peer connections (0 = auto-assign)
listen_port = 0

# Maximum number of peer connections
max_peers = 32

# Ping interval in milliseconds
ping_interval_ms = 15000

# Timeout before a peer is considered stale (milliseconds)
stale_timeout_ms = 60000

# Auto-connect to discovered peers
auto_connect = true

[openai]
# Enable OpenAI-compatible API backend
enabled = true

# API base URL (OpenAI, Ollama, vLLM, LM Studio, etc.)
base_url = "http://localhost:11434/v1"

# API key (leave empty for local servers like Ollama)
api_key = ""

# Default model identifier
default_model = "llama3"

# Request timeout in seconds
timeout_secs = 120

# Maximum retries on transient failures
max_retries = 2
"#.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_default_config() {
        let config = WorkerConfig::default();
        assert_eq!(config.coordinator.url, "wss://coordinator.ai4all.network");
        assert_eq!(config.resources.max_gpu_percent, 75);
        assert_eq!(config.logging.level, "info");
    }

    #[test]
    fn test_env_override() {
        // Set env vars
        env::set_var("AI4ALL_COORDINATOR_URL", "wss://test.example.com");
        env::set_var("AI4ALL_MAX_GPU_PERCENT", "50");
        env::set_var("AI4ALL_LOG_LEVEL", "debug");

        let mut config = WorkerConfig::default();
        config.apply_env_overrides();

        assert_eq!(config.coordinator.url, "wss://test.example.com");
        assert_eq!(config.resources.max_gpu_percent, 50);
        assert_eq!(config.logging.level, "debug");

        // Cleanup
        env::remove_var("AI4ALL_COORDINATOR_URL");
        env::remove_var("AI4ALL_MAX_GPU_PERCENT");
        env::remove_var("AI4ALL_LOG_LEVEL");
    }

    #[test]
    fn test_validation_invalid_url() {
        let mut config = WorkerConfig::default();
        config.coordinator.url = "http://invalid.com".to_string();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_invalid_gpu_percent() {
        let mut config = WorkerConfig::default();
        config.resources.max_gpu_percent = 150;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_invalid_log_level() {
        let mut config = WorkerConfig::default();
        config.logging.level = "invalid".to_string();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validation_valid_config() {
        let config = WorkerConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_path_expansion() {
        let mut config = WorkerConfig::default();
        config.storage.data_dir = "~/test/data".to_string();
        config.expand_paths();

        // Should not contain ~
        assert!(!config.storage.data_dir.contains('~'));
    }

    #[test]
    fn test_serialize_deserialize() {
        let config = WorkerConfig::default();
        let toml_str = toml::to_string(&config).unwrap();
        let parsed: WorkerConfig = toml::from_str(&toml_str).unwrap();

        assert_eq!(config.coordinator.url, parsed.coordinator.url);
        assert_eq!(config.resources.max_gpu_percent, parsed.resources.max_gpu_percent);
    }

    #[test]
    fn test_parse_config_file() {
        let config_str = r#"
[worker]
id = "test-worker"
name = "Test Worker"
tags = ["gpu", "fast"]

[coordinator]
url = "wss://custom.example.com"
reconnect_interval_ms = 10000

[resources]
max_memory_mb = 16384
max_gpu_percent = 90
enable_gpu = true

[logging]
level = "debug"
"#;

        let config: WorkerConfig = toml::from_str(config_str).unwrap();

        assert_eq!(config.worker.id, Some("test-worker".to_string()));
        assert_eq!(config.worker.name, Some("Test Worker".to_string()));
        assert_eq!(config.worker.tags, vec!["gpu", "fast"]);
        assert_eq!(config.coordinator.url, "wss://custom.example.com");
        assert_eq!(config.coordinator.reconnect_interval_ms, 10000);
        assert_eq!(config.resources.max_memory_mb, 16384);
        assert_eq!(config.resources.max_gpu_percent, 90);
        assert_eq!(config.logging.level, "debug");
    }
}
