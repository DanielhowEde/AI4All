//! Error types for the AI4All Worker
//!
//! Provides structured error handling with:
//! - Numeric error codes for machine parsing
//! - User-friendly messages with suggestions
//! - Error context and chaining
//! - Exit codes for CLI

use std::fmt;
use std::path::PathBuf;

use thiserror::Error;

/// Result type alias for worker operations
pub type Result<T> = std::result::Result<T, Error>;

/// Numeric error codes for machine parsing and documentation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum ErrorCode {
    // Configuration errors (1xx)
    ConfigNotFound = 100,
    ConfigParseError = 101,
    ConfigValidation = 102,
    ConfigPermission = 103,

    // IO errors (2xx)
    IoRead = 200,
    IoWrite = 201,
    IoPermission = 202,
    IoNotFound = 203,

    // Connection errors (3xx)
    ConnectionFailed = 300,
    ConnectionTimeout = 301,
    ConnectionRefused = 302,
    ConnectionLost = 303,
    TlsError = 304,

    // Protocol errors (4xx)
    ProtocolVersion = 400,
    ProtocolMalformed = 401,
    ProtocolUnexpected = 402,
    AuthenticationFailed = 403,

    // Execution errors (5xx)
    ExecutionFailed = 500,
    ExecutionTimeout = 501,
    ExecutionCancelled = 502,
    ExecutionOom = 503,

    // Model errors (6xx)
    ModelNotFound = 600,
    ModelLoadFailed = 601,
    ModelIncompatible = 602,
    ModelCorrupted = 603,

    // Resource errors (7xx)
    ResourceMemory = 700,
    ResourceGpu = 701,
    ResourceDisk = 702,
    ResourceCpu = 703,

    // GPU/Plugin errors (8xx)
    GpuNotFound = 810,
    GpuDetectionFailed = 811,
    GpuMemoryInsufficient = 812,
    PluginNotFound = 820,
    PluginDownloadFailed = 821,
    PluginLoadFailed = 822,
    PluginChecksumMismatch = 823,
    PluginIncompatible = 824,
    VulkanError = 830,

    // Internal errors (9xx)
    InternalError = 900,
    NotImplemented = 901,
    NotSupported = 902,
}

impl ErrorCode {
    /// Get the string code (e.g., "E100")
    pub fn as_str(&self) -> String {
        format!("E{}", *self as u16)
    }

    /// Get the exit code for CLI (maps to 1-125 range)
    pub fn exit_code(&self) -> i32 {
        match *self as u16 {
            100..=199 => 10, // Config errors
            200..=299 => 20, // IO errors
            300..=399 => 30, // Connection errors
            400..=499 => 40, // Protocol errors
            500..=599 => 50, // Execution errors
            600..=699 => 60, // Model errors
            700..=799 => 70, // Resource errors
            800..=899 => 80, // GPU/Plugin errors
            900..=999 => 90, // Internal errors
            _ => 1,
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Main error type for the worker
#[derive(Error, Debug)]
pub enum Error {
    // ─────────────────────────────────────────────────────────────
    // Configuration Errors
    // ─────────────────────────────────────────────────────────────

    /// Configuration file not found
    #[error("Configuration file not found: {path}")]
    ConfigNotFound {
        path: PathBuf,
        #[source]
        source: Option<std::io::Error>,
    },

    /// Configuration parse error
    #[error("Failed to parse configuration: {message}")]
    ConfigParse {
        message: String,
        #[source]
        source: Option<toml::de::Error>,
    },

    /// Configuration validation error
    #[error("Configuration validation failed: {message}")]
    ConfigValidation { message: String, field: Option<String> },

    /// Generic configuration error (for backwards compatibility)
    #[error("Configuration error: {0}")]
    Config(String),

    // ─────────────────────────────────────────────────────────────
    // IO Errors
    // ─────────────────────────────────────────────────────────────

    /// File read error
    #[error("Failed to read file: {path}")]
    IoRead {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// File write error
    #[error("Failed to write file: {path}")]
    IoWrite {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// Generic IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// TOML serialization error
    #[error("TOML serialization error: {0}")]
    Toml(#[from] toml::ser::Error),

    /// WebSocket error
    #[error("WebSocket error: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),

    // ─────────────────────────────────────────────────────────────
    // Connection Errors
    // ─────────────────────────────────────────────────────────────

    /// Connection failed
    #[error("Failed to connect to {url}: {message}")]
    ConnectionFailed { url: String, message: String },

    /// Connection timeout
    #[error("Connection to {url} timed out after {timeout_secs}s")]
    ConnectionTimeout { url: String, timeout_secs: u64 },

    /// Connection lost
    #[error("Lost connection to coordinator: {message}")]
    ConnectionLost { message: String },

    /// Generic connection error
    #[error("Connection error: {0}")]
    Connection(String),

    // ─────────────────────────────────────────────────────────────
    // Protocol Errors
    // ─────────────────────────────────────────────────────────────

    /// Protocol version mismatch
    #[error("Protocol version mismatch: expected {expected}, got {actual}")]
    ProtocolVersion { expected: String, actual: String },

    /// Malformed message
    #[error("Malformed protocol message: {message}")]
    ProtocolMalformed { message: String },

    /// Authentication failed
    #[error("Authentication failed: {message}")]
    AuthenticationFailed { message: String },

    /// Generic protocol error
    #[error("Protocol error: {0}")]
    Protocol(String),

    // ─────────────────────────────────────────────────────────────
    // Execution Errors
    // ─────────────────────────────────────────────────────────────

    /// Task execution failed
    #[error("Task execution failed: {message}")]
    ExecutionFailed {
        task_id: Option<String>,
        message: String,
    },

    /// Task timeout
    #[error("Task {task_id} timed out after {timeout_secs}s")]
    TaskTimeout { task_id: String, timeout_secs: u64 },

    /// Generic execution error
    #[error("Execution error: {0}")]
    Execution(String),

    /// Task timeout (legacy)
    #[error("Task timeout: {0}")]
    Timeout(String),

    // ─────────────────────────────────────────────────────────────
    // Model Errors
    // ─────────────────────────────────────────────────────────────

    /// Model not found
    #[error("Model not found: {model_id}")]
    ModelNotFound { model_id: String },

    /// Model load failed
    #[error("Failed to load model {model_id}: {message}")]
    ModelLoadFailed { model_id: String, message: String },

    /// Model incompatible with hardware
    #[error("Model {model_id} incompatible: {reason}")]
    ModelIncompatible { model_id: String, reason: String },

    /// Generic model error
    #[error("Model error: {0}")]
    Model(String),

    // ─────────────────────────────────────────────────────────────
    // Resource Errors
    // ─────────────────────────────────────────────────────────────

    /// Memory limit exceeded
    #[error("Memory limit exceeded: requested {requested_mb}MB, available {available_mb}MB")]
    MemoryLimit {
        requested_mb: u64,
        available_mb: u64,
    },

    /// GPU resource error
    #[error("GPU error: {message}")]
    GpuError { message: String, device_id: Option<u32> },

    /// Generic resource limit
    #[error("Resource limit exceeded: {0}")]
    ResourceLimit(String),

    // ─────────────────────────────────────────────────────────────
    // GPU/Plugin Errors
    // ─────────────────────────────────────────────────────────────

    /// No compatible GPU found
    #[error("No compatible GPU found: {message}")]
    GpuNotFound { message: String },

    /// GPU detection failed
    #[error("GPU detection failed: {message}")]
    GpuDetectionFailed { message: String },

    /// Insufficient GPU memory
    #[error("Insufficient GPU memory: need {required_mb}MB, have {available_mb}MB")]
    GpuMemoryInsufficient { required_mb: u64, available_mb: u64 },

    /// Plugin not found
    #[error("Plugin not found: {name}")]
    PluginNotFound { name: String },

    /// Plugin download failed
    #[error("Failed to download plugin {name}: {message}")]
    PluginDownloadFailed { name: String, message: String, url: Option<String> },

    /// Plugin load failed
    #[error("Failed to load plugin {name}: {message}")]
    PluginLoadFailed { name: String, message: String, path: Option<std::path::PathBuf> },

    /// Plugin checksum mismatch
    #[error("Plugin checksum mismatch for {name}: expected {expected}, got {actual}")]
    PluginChecksumMismatch { name: String, expected: String, actual: String },

    /// Plugin incompatible
    #[error("Plugin {name} incompatible: {reason}")]
    PluginIncompatible { name: String, reason: String },

    /// Vulkan error
    #[error("Vulkan error: {message}")]
    VulkanError { message: String, error_code: Option<i32> },

    // ─────────────────────────────────────────────────────────────
    // Internal Errors
    // ─────────────────────────────────────────────────────────────

    /// Feature not supported
    #[error("Not supported: {0}")]
    NotSupported(String),

    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),
}

impl Error {
    // ─────────────────────────────────────────────────────────────
    // Error Classification
    // ─────────────────────────────────────────────────────────────

    /// Get the numeric error code
    pub fn code(&self) -> ErrorCode {
        match self {
            Error::ConfigNotFound { .. } => ErrorCode::ConfigNotFound,
            Error::ConfigParse { .. } => ErrorCode::ConfigParseError,
            Error::ConfigValidation { .. } => ErrorCode::ConfigValidation,
            Error::Config(_) => ErrorCode::ConfigValidation,

            Error::IoRead { .. } => ErrorCode::IoRead,
            Error::IoWrite { .. } => ErrorCode::IoWrite,
            Error::Io(e) => match e.kind() {
                std::io::ErrorKind::NotFound => ErrorCode::IoNotFound,
                std::io::ErrorKind::PermissionDenied => ErrorCode::IoPermission,
                _ => ErrorCode::IoRead,
            },
            Error::Toml(_) => ErrorCode::ConfigParseError,
            Error::WebSocket(_) => ErrorCode::ConnectionFailed,

            Error::ConnectionFailed { .. } => ErrorCode::ConnectionFailed,
            Error::ConnectionTimeout { .. } => ErrorCode::ConnectionTimeout,
            Error::ConnectionLost { .. } => ErrorCode::ConnectionLost,
            Error::Connection(_) => ErrorCode::ConnectionFailed,

            Error::ProtocolVersion { .. } => ErrorCode::ProtocolVersion,
            Error::ProtocolMalformed { .. } => ErrorCode::ProtocolMalformed,
            Error::AuthenticationFailed { .. } => ErrorCode::AuthenticationFailed,
            Error::Protocol(_) => ErrorCode::ProtocolMalformed,

            Error::ExecutionFailed { .. } => ErrorCode::ExecutionFailed,
            Error::TaskTimeout { .. } => ErrorCode::ExecutionTimeout,
            Error::Execution(_) => ErrorCode::ExecutionFailed,
            Error::Timeout(_) => ErrorCode::ExecutionTimeout,

            Error::ModelNotFound { .. } => ErrorCode::ModelNotFound,
            Error::ModelLoadFailed { .. } => ErrorCode::ModelLoadFailed,
            Error::ModelIncompatible { .. } => ErrorCode::ModelIncompatible,
            Error::Model(_) => ErrorCode::ModelLoadFailed,

            Error::MemoryLimit { .. } => ErrorCode::ResourceMemory,
            Error::GpuError { .. } => ErrorCode::ResourceGpu,
            Error::ResourceLimit(_) => ErrorCode::ResourceMemory,

            Error::GpuNotFound { .. } => ErrorCode::GpuNotFound,
            Error::GpuDetectionFailed { .. } => ErrorCode::GpuDetectionFailed,
            Error::GpuMemoryInsufficient { .. } => ErrorCode::GpuMemoryInsufficient,
            Error::PluginNotFound { .. } => ErrorCode::PluginNotFound,
            Error::PluginDownloadFailed { .. } => ErrorCode::PluginDownloadFailed,
            Error::PluginLoadFailed { .. } => ErrorCode::PluginLoadFailed,
            Error::PluginChecksumMismatch { .. } => ErrorCode::PluginChecksumMismatch,
            Error::PluginIncompatible { .. } => ErrorCode::PluginIncompatible,
            Error::VulkanError { .. } => ErrorCode::VulkanError,

            Error::NotSupported(_) => ErrorCode::NotSupported,
            Error::Internal(_) => ErrorCode::InternalError,
        }
    }

    /// Check if the error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Error::ConnectionFailed { .. }
                | Error::ConnectionTimeout { .. }
                | Error::ConnectionLost { .. }
                | Error::Connection(_)
                | Error::TaskTimeout { .. }
                | Error::Timeout(_)
                | Error::Io(_)
                | Error::IoRead { .. }
                | Error::IoWrite { .. }
        )
    }

    /// Check if the error is fatal (worker should exit)
    pub fn is_fatal(&self) -> bool {
        matches!(
            self,
            Error::ConfigNotFound { .. }
                | Error::ConfigParse { .. }
                | Error::ConfigValidation { .. }
                | Error::AuthenticationFailed { .. }
                | Error::ProtocolVersion { .. }
                | Error::Internal(_)
        )
    }

    /// Get the exit code for CLI
    pub fn exit_code(&self) -> i32 {
        self.code().exit_code()
    }

    // ─────────────────────────────────────────────────────────────
    // User-Friendly Messages
    // ─────────────────────────────────────────────────────────────

    /// Get a user-friendly suggestion for how to fix this error
    pub fn suggestion(&self) -> Option<&'static str> {
        match self {
            Error::ConfigNotFound { .. } => Some(
                "Run 'ai4all-worker config init' to create a default configuration file."
            ),
            Error::ConfigParse { .. } => Some(
                "Check your configuration file syntax. Run 'ai4all-worker config validate' to see details."
            ),
            Error::ConfigValidation { .. } => Some(
                "Review the configuration file and fix the invalid values. See documentation for valid options."
            ),

            Error::ConnectionFailed { .. } => Some(
                "Check your network connection and verify the coordinator URL is correct."
            ),
            Error::ConnectionTimeout { .. } => Some(
                "The coordinator may be down or unreachable. Check your firewall settings."
            ),
            Error::ConnectionLost { .. } => Some(
                "Connection was interrupted. The worker will automatically attempt to reconnect."
            ),

            Error::AuthenticationFailed { .. } => Some(
                "Verify your worker credentials. You may need to re-register with the coordinator."
            ),
            Error::ProtocolVersion { .. } => Some(
                "Your worker version may be outdated. Run 'ai4all-worker --version' and check for updates."
            ),

            Error::ModelNotFound { .. } => Some(
                "The requested model is not available. It may need to be downloaded first."
            ),
            Error::ModelLoadFailed { .. } => Some(
                "The model file may be corrupted. Try re-downloading it."
            ),
            Error::ModelIncompatible { .. } => Some(
                "This model requires hardware capabilities your system doesn't have."
            ),

            Error::MemoryLimit { .. } => Some(
                "Reduce 'max_memory_mb' in config or close other applications to free memory."
            ),
            Error::GpuError { .. } => Some(
                "Check that GPU drivers are installed correctly. Try 'ai4all-worker benchmark' to test."
            ),

            Error::GpuNotFound { .. } => Some(
                "Ensure your system has a compatible GPU. Run 'ai4all-worker benchmark --gpu' to detect GPUs."
            ),
            Error::GpuDetectionFailed { .. } => Some(
                "Install Vulkan drivers for your GPU. AMD: amdvlk, NVIDIA: nvidia-drivers, Intel: intel-vulkan."
            ),
            Error::GpuMemoryInsufficient { .. } => Some(
                "Try a smaller model or use CPU-only mode with --disable-gpu."
            ),
            Error::PluginNotFound { .. } => Some(
                "The required GPU plugin is not installed. It will be downloaded automatically on next run."
            ),
            Error::PluginDownloadFailed { .. } => Some(
                "Check your internet connection. You can manually download plugins to ~/.ai4all/plugins/."
            ),
            Error::PluginLoadFailed { .. } => Some(
                "The plugin file may be corrupted. Delete it and restart to re-download."
            ),
            Error::PluginChecksumMismatch { .. } => Some(
                "The downloaded plugin is corrupted. Delete it and try again."
            ),
            Error::VulkanError { .. } => Some(
                "Update your GPU drivers and ensure Vulkan is properly installed."
            ),

            _ => None,
        }
    }

    /// Format the error for terminal display with colors
    pub fn format_for_terminal(&self) -> String {
        let code = self.code();
        let suggestion = self.suggestion();

        let mut output = format!(
            "\x1b[31mError [{}]\x1b[0m: {}\n",
            code.as_str(),
            self
        );

        if let Some(hint) = suggestion {
            output.push_str(&format!("\n\x1b[33mHint\x1b[0m: {}\n", hint));
        }

        output
    }

    /// Format the error for logging (no colors)
    pub fn format_for_log(&self) -> String {
        let code = self.code();
        format!("[{}] {}", code.as_str(), self)
    }
}

// ─────────────────────────────────────────────────────────────────
// Error Constructors (for ergonomic error creation)
// ─────────────────────────────────────────────────────────────────

impl Error {
    /// Create a config not found error
    pub fn config_not_found(path: impl Into<PathBuf>) -> Self {
        Error::ConfigNotFound {
            path: path.into(),
            source: None,
        }
    }

    /// Create a config parse error
    pub fn config_parse(message: impl Into<String>) -> Self {
        Error::ConfigParse {
            message: message.into(),
            source: None,
        }
    }

    /// Create a config validation error
    pub fn config_validation(message: impl Into<String>) -> Self {
        Error::ConfigValidation {
            message: message.into(),
            field: None,
        }
    }

    /// Create a config validation error with field name
    pub fn config_field_invalid(field: impl Into<String>, message: impl Into<String>) -> Self {
        Error::ConfigValidation {
            message: message.into(),
            field: Some(field.into()),
        }
    }

    /// Create a connection failed error
    pub fn connection_failed(url: impl Into<String>, message: impl Into<String>) -> Self {
        Error::ConnectionFailed {
            url: url.into(),
            message: message.into(),
        }
    }

    /// Create a connection timeout error
    pub fn connection_timeout(url: impl Into<String>, timeout_secs: u64) -> Self {
        Error::ConnectionTimeout {
            url: url.into(),
            timeout_secs,
        }
    }

    /// Create an execution failed error
    pub fn execution_failed(message: impl Into<String>) -> Self {
        Error::ExecutionFailed {
            task_id: None,
            message: message.into(),
        }
    }

    /// Create a model not found error
    pub fn model_not_found(model_id: impl Into<String>) -> Self {
        Error::ModelNotFound {
            model_id: model_id.into(),
        }
    }

    /// Create a memory limit error
    pub fn memory_limit(requested_mb: u64, available_mb: u64) -> Self {
        Error::MemoryLimit {
            requested_mb,
            available_mb,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_format() {
        assert_eq!(ErrorCode::ConfigNotFound.as_str(), "E100");
        assert_eq!(ErrorCode::ConnectionFailed.as_str(), "E300");
        assert_eq!(ErrorCode::InternalError.as_str(), "E900");
    }

    #[test]
    fn test_error_exit_codes() {
        assert_eq!(ErrorCode::ConfigNotFound.exit_code(), 10);
        assert_eq!(ErrorCode::IoRead.exit_code(), 20);
        assert_eq!(ErrorCode::ConnectionFailed.exit_code(), 30);
        assert_eq!(ErrorCode::ExecutionFailed.exit_code(), 50);
        assert_eq!(ErrorCode::InternalError.exit_code(), 90);
    }

    #[test]
    fn test_error_display() {
        let err = Error::ConfigNotFound {
            path: PathBuf::from("/path/to/config.toml"),
            source: None,
        };
        assert!(err.to_string().contains("/path/to/config.toml"));
    }

    #[test]
    fn test_error_codes() {
        let err = Error::config_not_found("/test");
        assert_eq!(err.code(), ErrorCode::ConfigNotFound);

        let err = Error::connection_failed("ws://test", "refused");
        assert_eq!(err.code(), ErrorCode::ConnectionFailed);

        let err = Error::memory_limit(16000, 8000);
        assert_eq!(err.code(), ErrorCode::ResourceMemory);
    }

    #[test]
    fn test_error_retryable() {
        assert!(Error::connection_failed("url", "test").is_retryable());
        assert!(Error::ConnectionTimeout { url: "url".into(), timeout_secs: 30 }.is_retryable());
        assert!(!Error::config_not_found("/test").is_retryable());
        assert!(!Error::AuthenticationFailed { message: "test".into() }.is_retryable());
    }

    #[test]
    fn test_error_fatal() {
        assert!(Error::config_not_found("/test").is_fatal());
        assert!(Error::AuthenticationFailed { message: "test".into() }.is_fatal());
        assert!(!Error::connection_failed("url", "test").is_fatal());
    }

    #[test]
    fn test_error_suggestions() {
        let err = Error::config_not_found("/test");
        assert!(err.suggestion().is_some());
        assert!(err.suggestion().unwrap().contains("config init"));

        let err = Error::memory_limit(16000, 8000);
        assert!(err.suggestion().is_some());
        assert!(err.suggestion().unwrap().contains("max_memory_mb"));
    }

    #[test]
    fn test_format_for_terminal() {
        let err = Error::config_not_found("/test/config.toml");
        let formatted = err.format_for_terminal();

        // Should contain error code
        assert!(formatted.contains("E100"));
        // Should contain ANSI color codes
        assert!(formatted.contains("\x1b[31m"));
        // Should contain hint
        assert!(formatted.contains("Hint"));
    }

    #[test]
    fn test_format_for_log() {
        let err = Error::config_not_found("/test/config.toml");
        let formatted = err.format_for_log();

        // Should contain error code
        assert!(formatted.contains("[E100]"));
        // Should NOT contain ANSI codes
        assert!(!formatted.contains("\x1b["));
    }

    #[test]
    fn test_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err: Error = io_err.into();

        assert_eq!(err.code(), ErrorCode::IoNotFound);
    }

    #[test]
    fn test_legacy_error_compatibility() {
        // Ensure old-style errors still work
        let err = Error::Config("old style error".to_string());
        assert_eq!(err.code(), ErrorCode::ConfigValidation);
        assert!(err.is_fatal());

        let err = Error::Connection("connection issue".to_string());
        assert_eq!(err.code(), ErrorCode::ConnectionFailed);
        assert!(err.is_retryable());
    }
}
