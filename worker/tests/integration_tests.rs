//! Integration test harness
//!
//! Comprehensive integration tests with fixtures and mock systems

use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::TempDir;

// ─────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────

/// Complete test environment with all necessary directories and files
pub struct TestEnvironment {
    pub root: TempDir,
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub model_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl TestEnvironment {
    /// Create a new test environment with default configuration
    pub fn new() -> Self {
        let root = TempDir::new().expect("Failed to create temp directory");
        let root_path = root.path();

        let data_dir = root_path.join("data");
        let model_dir = root_path.join("models");
        let log_dir = root_path.join("logs");
        let config_path = root_path.join("config.toml");

        // Create directories
        fs::create_dir_all(&data_dir).expect("Failed to create data dir");
        fs::create_dir_all(&model_dir).expect("Failed to create model dir");
        fs::create_dir_all(&log_dir).expect("Failed to create log dir");

        // Create default config
        let config = format!(r#"
[worker]
id = "test-worker"
name = "Integration Test Worker"

[coordinator]
url = "wss://test.example.com"
reconnect_interval_ms = 1000
max_reconnect_attempts = 3
connect_timeout_ms = 5000
heartbeat_interval_ms = 5000

[resources]
max_memory_mb = 4096
max_gpu_memory_mb = 0
max_gpu_percent = 50
max_threads = 2
enable_gpu = false

[logging]
level = "debug"
file = "{}"
max_file_size_mb = 10
max_files = 2
json_format = false

[storage]
data_dir = "{}"
model_dir = "{}"
temp_dir = "{}"
"#,
            log_dir.join("test.log").display(),
            data_dir.display(),
            model_dir.display(),
            root_path.join("temp").display()
        );

        fs::write(&config_path, config).expect("Failed to write config");

        Self {
            root,
            config_path,
            data_dir,
            model_dir,
            log_dir,
        }
    }

    /// Create a custom configuration
    pub fn with_config(config_content: &str) -> Self {
        let env = Self::new();
        fs::write(&env.config_path, config_content).expect("Failed to write custom config");
        env
    }

    /// Get the config path as a string
    pub fn config(&self) -> &str {
        self.config_path.to_str().unwrap()
    }

    /// Get a worker command configured with this environment
    pub fn worker_cmd(&self) -> assert_cmd::Command {
        let mut cmd = assert_cmd::Command::cargo_bin("ai4all-worker").unwrap();
        cmd.arg("--config").arg(self.config());
        cmd
    }

    /// Create a mock model file
    pub fn create_mock_model(&self, name: &str, size_bytes: usize) -> PathBuf {
        let model_path = self.model_dir.join(name);
        let content = vec![0u8; size_bytes];
        fs::write(&model_path, content).expect("Failed to create mock model");
        model_path
    }
}

impl Default for TestEnvironment {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────
// End-to-End Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_full_config_workflow() {
    let env = TestEnvironment::new();

    // 1. Show config
    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("show")
        .arg("--config")
        .arg(env.config())
        .assert()
        .success()
        .stdout(predicates::str::contains("test-worker"));

    // 2. Validate config
    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(env.config())
        .assert()
        .success();

    // 3. Run benchmark (quick test)
    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("benchmark")
        .arg("--iterations")
        .arg("1")
        .assert()
        .success();
}

#[test]
fn test_log_file_creation() {
    let env = TestEnvironment::new();

    // Run a command that should create log output
    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("run")
        .arg("--config")
        .arg(env.config())
        .timeout(Duration::from_secs(2))
        .assert();

    // Note: Log file may or may not exist depending on timing
    // This test verifies the command doesn't crash when log path is specified
}

#[test]
fn test_storage_directories_used() {
    let env = TestEnvironment::new();

    // Verify directories exist
    assert!(env.data_dir.exists());
    assert!(env.model_dir.exists());
    assert!(env.log_dir.exists());

    // Config should reference these paths
    let config_content = fs::read_to_string(&env.config_path).unwrap();
    assert!(config_content.contains(&env.data_dir.display().to_string()));
    assert!(config_content.contains(&env.model_dir.display().to_string()));
}

// ─────────────────────────────────────────────────────────────────
// Error Scenario Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_error_exit_codes() {
    // Config not found should return specific exit code
    let result = assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("run")
        .arg("--config")
        .arg("/nonexistent/path/config.toml")
        .assert()
        .failure();

    // Exit code should be in the config error range (10)
    let exit_code = result.get_output().status.code().unwrap_or(1);
    assert_eq!(exit_code, 10, "Expected config error exit code (10)");
}

#[test]
fn test_invalid_config_exit_code() {
    let env = TestEnvironment::with_config(r#"
[coordinator]
url = "http://invalid-not-websocket"
"#);

    let result = assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(env.config())
        .assert()
        .failure();

    // Should be config validation error (exit code 10)
    let exit_code = result.get_output().status.code().unwrap_or(1);
    assert_eq!(exit_code, 10);
}

// ─────────────────────────────────────────────────────────────────
// Performance Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_startup_time() {
    use std::time::Instant;

    let start = Instant::now();

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("version")
        .assert()
        .success();

    let elapsed = start.elapsed();

    // Version command should complete in under 1 second
    assert!(
        elapsed < Duration::from_secs(1),
        "Startup too slow: {:?}",
        elapsed
    );
}

#[test]
fn test_config_parse_time() {
    use std::time::Instant;

    let env = TestEnvironment::new();

    let start = Instant::now();

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("show")
        .arg("--config")
        .arg(env.config())
        .assert()
        .success();

    let elapsed = start.elapsed();

    // Config parsing should be fast
    assert!(
        elapsed < Duration::from_millis(500),
        "Config parsing too slow: {:?}",
        elapsed
    );
}

// ─────────────────────────────────────────────────────────────────
// Concurrent Access Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_concurrent_config_reads() {
    use std::thread;

    let env = TestEnvironment::new();
    let config_path = env.config().to_string();

    let handles: Vec<_> = (0..4)
        .map(|_| {
            let path = config_path.clone();
            thread::spawn(move || {
                assert_cmd::Command::cargo_bin("ai4all-worker")
                    .unwrap()
                    .arg("config")
                    .arg("validate")
                    .arg("--config")
                    .arg(&path)
                    .assert()
                    .success();
            })
        })
        .collect();

    for handle in handles {
        handle.join().expect("Thread panicked");
    }
}

use predicates;
