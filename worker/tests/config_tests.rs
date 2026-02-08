//! Configuration system tests
//!
//! Tests configuration loading, validation, and environment overrides

use std::env;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

// Import the worker crate (it will be available as the crate name)
// For integration tests, we test the public API

/// Test fixture for configuration testing
struct ConfigFixture {
    temp_dir: TempDir,
    config_path: PathBuf,
}

impl ConfigFixture {
    fn new() -> Self {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.toml");
        Self { temp_dir, config_path }
    }

    fn write_config(&self, content: &str) {
        fs::write(&self.config_path, content).unwrap();
    }

    fn path(&self) -> &str {
        self.config_path.to_str().unwrap()
    }
}

// ─────────────────────────────────────────────────────────────────
// Valid Configuration Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_minimal_config() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[worker]

[coordinator]
url = "wss://example.com"

[resources]

[logging]

[storage]
"#);

    // Validate via CLI
    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .success();
}

#[test]
fn test_full_config() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[worker]
id = "test-worker-001"
name = "Test Worker"
tags = ["gpu", "fast", "test"]

[coordinator]
url = "wss://coordinator.example.com"
reconnect_interval_ms = 10000
max_reconnect_attempts = 5
connect_timeout_ms = 60000
heartbeat_interval_ms = 15000

[resources]
max_memory_mb = 16384
max_gpu_memory_mb = 8192
max_gpu_percent = 90
max_threads = 8
enable_gpu = true

[logging]
level = "debug"
file = "/tmp/worker.log"
max_file_size_mb = 50
max_files = 3
json_format = false

[storage]
data_dir = "/tmp/ai4all/data"
model_dir = "/tmp/ai4all/models"
temp_dir = "/tmp/ai4all/temp"
"#);

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .success();
}

// ─────────────────────────────────────────────────────────────────
// Invalid Configuration Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_invalid_coordinator_url() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[coordinator]
url = "http://not-websocket.com"
"#);

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .failure();
}

#[test]
fn test_invalid_gpu_percent() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[coordinator]
url = "wss://example.com"

[resources]
max_gpu_percent = 150
"#);

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .failure();
}

#[test]
fn test_invalid_log_level() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[coordinator]
url = "wss://example.com"

[logging]
level = "invalid_level"
"#);

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .failure();
}

#[test]
fn test_malformed_toml() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[coordinator
url = "wss://example.com"
"#);

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .failure();
}

// ─────────────────────────────────────────────────────────────────
// Config Show Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_config_show_custom() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[worker]
id = "custom-id-123"
name = "Custom Worker"

[coordinator]
url = "wss://custom.example.com"

[resources]
max_memory_mb = 32768
"#);

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("show")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .success()
        .stdout(predicates::str::contains("custom-id-123"))
        .stdout(predicates::str::contains("Custom Worker"))
        .stdout(predicates::str::contains("wss://custom.example.com"))
        .stdout(predicates::str::contains("32768"));
}

// ─────────────────────────────────────────────────────────────────
// Config Init Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_config_init_creates_file() {
    let temp_dir = TempDir::new().unwrap();
    let config_path = temp_dir.path().join("new_config.toml");

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("init")
        .arg("--path")
        .arg(config_path.to_str().unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("Configuration file created"));

    // Verify file was created
    assert!(config_path.exists());

    // Verify the created config is valid
    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg(config_path.to_str().unwrap())
        .assert()
        .success();
}

#[test]
fn test_config_init_refuses_overwrite() {
    let fixture = ConfigFixture::new();
    fixture.write_config("[worker]\n");

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("init")
        .arg("--path")
        .arg(fixture.path())
        .assert()
        .failure()
        .stderr(predicates::str::contains("already exists"));
}

#[test]
fn test_config_init_force_overwrite() {
    let fixture = ConfigFixture::new();
    fixture.write_config("[worker]\nid = \"old\"\n");

    assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("init")
        .arg("--path")
        .arg(fixture.path())
        .arg("--force")
        .assert()
        .success();

    // Verify file was overwritten (old id should be gone)
    let content = fs::read_to_string(fixture.path()).unwrap();
    assert!(!content.contains("old"));
}

// ─────────────────────────────────────────────────────────────────
// Environment Variable Override Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_env_override_coordinator_url() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[coordinator]
url = "wss://file.example.com"
"#);

    // Set environment variable to override
    env::set_var("AI4ALL_COORDINATOR_URL", "wss://env.example.com");

    let output = assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("show")
        .arg("--config")
        .arg(fixture.path())
        .env("AI4ALL_COORDINATOR_URL", "wss://env.example.com")
        .assert()
        .success();

    // Env var should override file
    output.stdout(predicates::str::contains("wss://env.example.com"));

    // Cleanup
    env::remove_var("AI4ALL_COORDINATOR_URL");
}

#[test]
fn test_env_override_resources() {
    let output = assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("show")
        .env("AI4ALL_MAX_MEMORY_MB", "65536")
        .env("AI4ALL_MAX_GPU_PERCENT", "50")
        .assert()
        .success();

    output
        .stdout(predicates::str::contains("65536"))
        .stdout(predicates::str::contains("50"));
}

// ─────────────────────────────────────────────────────────────────
// Path Expansion Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_tilde_expansion() {
    let fixture = ConfigFixture::new();
    fixture.write_config(r#"
[coordinator]
url = "wss://example.com"

[storage]
data_dir = "~/ai4all/data"
model_dir = "~/ai4all/models"
temp_dir = "~/ai4all/temp"
"#);

    let output = assert_cmd::Command::cargo_bin("ai4all-worker")
        .unwrap()
        .arg("config")
        .arg("show")
        .arg("--config")
        .arg(fixture.path())
        .assert()
        .success();

    // Tilde should be expanded (not present in output)
    // The exact path depends on the user, but ~ should be gone
    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();

    // data_dir should not start with ~ after expansion
    // This is a basic check - the path should be absolute
    assert!(!stdout.contains("data_dir = \"~"));
}

use predicates;
