//! Logging infrastructure using tracing + tracing-subscriber
//!
//! Features:
//! - Console output with colors
//! - File logging with rotation (daily or size-based)
//! - JSON format option
//! - Dynamic log level filtering
//! - Per-module log levels via RUST_LOG

use std::fs;
use std::path::Path;
use std::sync::Arc;

use tracing::Level;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::format::FmtSpan;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter, Layer};

use crate::config::LoggingSettings;
use crate::error::{Error, Result};

/// Guards that must be held for the lifetime of the application
/// to ensure logs are flushed properly
pub struct LogGuards {
    _file_guard: Option<WorkerGuard>,
}

/// Initialize the logging system
///
/// Returns guards that must be kept alive for the duration of the program.
/// When dropped, these guards will flush any remaining log entries.
pub fn init_logging(
    settings: &LoggingSettings,
    verbose: u8,
    quiet: bool,
) -> Result<LogGuards> {
    // Determine the effective log level
    let level = determine_level(settings, verbose, quiet);

    // Build the environment filter
    let env_filter = build_env_filter(&settings.level, level)?;

    // Create the console layer
    let console_layer = build_console_layer(settings.json_format, level);

    // Create the file layer if configured
    let (file_layer, file_guard) = if let Some(ref log_file) = settings.file {
        let (layer, guard) = build_file_layer(
            log_file,
            settings.max_file_size_mb,
            settings.max_files,
            settings.json_format,
            level,
        )?;
        (Some(layer), Some(guard))
    } else {
        (None, None)
    };

    // Combine layers and initialize
    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    tracing::info!(
        level = %level,
        file = ?settings.file,
        json = settings.json_format,
        "Logging initialized"
    );

    Ok(LogGuards {
        _file_guard: file_guard,
    })
}

/// Determine the effective log level based on settings and CLI flags
fn determine_level(settings: &LoggingSettings, verbose: u8, quiet: bool) -> Level {
    if quiet {
        return Level::ERROR;
    }

    match verbose {
        0 => parse_level(&settings.level),
        1 => Level::DEBUG,
        _ => Level::TRACE,
    }
}

/// Parse a log level string
fn parse_level(level_str: &str) -> Level {
    match level_str.to_lowercase().as_str() {
        "trace" => Level::TRACE,
        "debug" => Level::DEBUG,
        "info" => Level::INFO,
        "warn" | "warning" => Level::WARN,
        "error" => Level::ERROR,
        _ => Level::INFO,
    }
}

/// Build the environment filter with support for RUST_LOG
fn build_env_filter(default_level: &str, cli_level: Level) -> Result<EnvFilter> {
    // Start with the CLI-determined level
    let base_filter = format!("{}", cli_level).to_lowercase();

    // Allow RUST_LOG to override for specific modules
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&base_filter))
        // Always show our own crate's logs at the configured level
        .add_directive(
            format!("ai4all_worker={}", cli_level)
                .parse()
                .unwrap_or_else(|_| format!("ai4all_worker={}", default_level).parse().unwrap()),
        )
        // Reduce noise from dependencies
        .add_directive("hyper=warn".parse().unwrap())
        .add_directive("tokio_tungstenite=warn".parse().unwrap())
        .add_directive("tungstenite=warn".parse().unwrap());

    Ok(filter)
}

/// Build the console output layer
fn build_console_layer<S>(json_format: bool, _level: Level) -> Box<dyn Layer<S> + Send + Sync>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    if json_format {
        Box::new(
            fmt::layer()
                .json()
                .with_target(true)
                .with_thread_ids(true)
                .with_file(true)
                .with_line_number(true)
                .with_span_events(FmtSpan::CLOSE),
        )
    } else {
        Box::new(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false)
                .with_ansi(true)
                .compact(),
        )
    }
}

/// Build the file logging layer with rotation
fn build_file_layer<S>(
    log_file: &str,
    max_size_mb: u64,
    max_files: u32,
    json_format: bool,
    _level: Level,
) -> Result<(Box<dyn Layer<S> + Send + Sync>, WorkerGuard)>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    let path = Path::new(log_file);

    // Ensure the directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            Error::Config(format!(
                "Failed to create log directory '{}': {}",
                parent.display(),
                e
            ))
        })?;
    }

    // Get directory and filename
    let directory = path.parent().unwrap_or(Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("worker.log");

    // Determine rotation strategy
    // For size-based rotation, we use daily rotation as a proxy
    // tracing-appender doesn't support pure size-based rotation,
    // but we can combine daily rotation with the file size concept
    let rotation = if max_size_mb > 0 && max_size_mb < 10 {
        // Small files = more frequent rotation (hourly)
        Rotation::HOURLY
    } else {
        // Default to daily rotation
        Rotation::DAILY
    };

    // Create the rolling file appender
    let file_appender = RollingFileAppender::builder()
        .rotation(rotation)
        .filename_prefix(file_name)
        .filename_suffix("log")
        .max_log_files(max_files as usize)
        .build(directory)
        .map_err(|e| Error::Config(format!("Failed to create log file appender: {}", e)))?;

    // Make it non-blocking
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // Build the layer
    let layer: Box<dyn Layer<S> + Send + Sync> = if json_format {
        Box::new(
            fmt::layer()
                .json()
                .with_writer(non_blocking)
                .with_target(true)
                .with_thread_ids(true)
                .with_file(true)
                .with_line_number(true)
                .with_span_events(FmtSpan::CLOSE)
                .with_ansi(false),
        )
    } else {
        Box::new(
            fmt::layer()
                .with_writer(non_blocking)
                .with_target(true)
                .with_thread_ids(true)
                .with_file(true)
                .with_line_number(true)
                .with_ansi(false),
        )
    };

    Ok((layer, guard))
}

/// Simple logging initialization for testing or minimal setup
pub fn init_simple(level: Level) -> Result<()> {
    let filter = EnvFilter::from_default_env()
        .add_directive(level.into());

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().compact())
        .try_init()
        .map_err(|e| Error::Config(format!("Failed to initialize logging: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parse_level() {
        assert_eq!(parse_level("trace"), Level::TRACE);
        assert_eq!(parse_level("TRACE"), Level::TRACE);
        assert_eq!(parse_level("debug"), Level::DEBUG);
        assert_eq!(parse_level("DEBUG"), Level::DEBUG);
        assert_eq!(parse_level("info"), Level::INFO);
        assert_eq!(parse_level("INFO"), Level::INFO);
        assert_eq!(parse_level("warn"), Level::WARN);
        assert_eq!(parse_level("warning"), Level::WARN);
        assert_eq!(parse_level("error"), Level::ERROR);
        assert_eq!(parse_level("invalid"), Level::INFO); // Default
    }

    #[test]
    fn test_determine_level_quiet() {
        let settings = LoggingSettings::default();
        assert_eq!(determine_level(&settings, 0, true), Level::ERROR);
    }

    #[test]
    fn test_determine_level_verbose() {
        let settings = LoggingSettings::default();
        assert_eq!(determine_level(&settings, 0, false), Level::INFO);
        assert_eq!(determine_level(&settings, 1, false), Level::DEBUG);
        assert_eq!(determine_level(&settings, 2, false), Level::TRACE);
    }

    #[test]
    fn test_determine_level_from_settings() {
        let mut settings = LoggingSettings::default();
        settings.level = "debug".to_string();
        assert_eq!(determine_level(&settings, 0, false), Level::DEBUG);

        settings.level = "error".to_string();
        assert_eq!(determine_level(&settings, 0, false), Level::ERROR);
    }

    #[test]
    fn test_build_env_filter() {
        let filter = build_env_filter("info", Level::INFO);
        assert!(filter.is_ok());
    }

    #[test]
    fn test_file_layer_creates_directory() {
        let temp_dir = TempDir::new().unwrap();
        let log_path = temp_dir.path().join("logs").join("test.log");

        let settings = LoggingSettings {
            file: Some(log_path.to_string_lossy().to_string()),
            ..Default::default()
        };

        // The parent directory should be created
        let result = build_file_layer::<tracing_subscriber::Registry>(
            settings.file.as_ref().unwrap(),
            settings.max_file_size_mb,
            settings.max_files,
            settings.json_format,
            Level::INFO,
        );

        assert!(result.is_ok());
        assert!(temp_dir.path().join("logs").exists());
    }
}
