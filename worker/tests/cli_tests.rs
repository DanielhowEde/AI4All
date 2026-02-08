//! CLI integration tests
//!
//! Tests the command-line interface using assert_cmd

use assert_cmd::Command;
use predicates::prelude::*;

/// Get a command for the ai4all-worker binary
fn worker_cmd() -> Command {
    Command::cargo_bin("ai4all-worker").unwrap()
}

// ─────────────────────────────────────────────────────────────────
// Help and Version Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_help_flag() {
    worker_cmd()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("AI4All Worker"))
        .stdout(predicate::str::contains("run"))
        .stdout(predicate::str::contains("benchmark"))
        .stdout(predicate::str::contains("version"))
        .stdout(predicate::str::contains("config"));
}

#[test]
fn test_version_command() {
    worker_cmd()
        .arg("version")
        .assert()
        .success()
        .stdout(predicate::str::contains("ai4all-worker"))
        .stdout(predicate::str::contains("Build Information"))
        .stdout(predicate::str::contains("Git Hash"))
        .stdout(predicate::str::contains("Target"));
}

#[test]
fn test_short_version_flag() {
    worker_cmd()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("ai4all-worker"));
}

// ─────────────────────────────────────────────────────────────────
// Config Command Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_config_show_default() {
    worker_cmd()
        .arg("config")
        .arg("show")
        .assert()
        .success()
        .stdout(predicate::str::contains("[worker]"))
        .stdout(predicate::str::contains("[coordinator]"))
        .stdout(predicate::str::contains("[resources]"))
        .stdout(predicate::str::contains("[logging]"))
        .stdout(predicate::str::contains("[storage]"));
}

#[test]
fn test_config_validate_default() {
    // Default config should always be valid
    worker_cmd()
        .arg("config")
        .arg("validate")
        .assert()
        .success()
        .stdout(predicate::str::contains("Configuration is valid"));
}

#[test]
fn test_config_validate_nonexistent_file() {
    worker_cmd()
        .arg("config")
        .arg("validate")
        .arg("--config")
        .arg("/nonexistent/path/config.toml")
        .assert()
        .failure()
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("Error")));
}

#[test]
fn test_config_init_help() {
    worker_cmd()
        .arg("config")
        .arg("init")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Initialize"))
        .stdout(predicate::str::contains("--path"))
        .stdout(predicate::str::contains("--force"));
}

// ─────────────────────────────────────────────────────────────────
// Benchmark Command Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_benchmark_help() {
    worker_cmd()
        .arg("benchmark")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("benchmark"))
        .stdout(predicate::str::contains("--iterations"))
        .stdout(predicate::str::contains("--output"));
}

#[test]
fn test_benchmark_default() {
    worker_cmd()
        .arg("benchmark")
        .assert()
        .success()
        .stdout(predicate::str::contains("Benchmark Results"))
        .stdout(predicate::str::contains("Iterations: 3")); // Default
}

#[test]
fn test_benchmark_custom_iterations() {
    worker_cmd()
        .arg("benchmark")
        .arg("--iterations")
        .arg("5")
        .assert()
        .success()
        .stdout(predicate::str::contains("Iterations: 5"));
}

// ─────────────────────────────────────────────────────────────────
// Run Command Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_run_help() {
    worker_cmd()
        .arg("run")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Run the worker"))
        .stdout(predicate::str::contains("--config"));
}

#[test]
fn test_run_with_invalid_config() {
    worker_cmd()
        .arg("run")
        .arg("--config")
        .arg("/nonexistent/config.toml")
        .assert()
        .failure();
}

// ─────────────────────────────────────────────────────────────────
// Verbosity Flag Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_verbose_flag() {
    // -v should work without errors
    worker_cmd()
        .arg("-v")
        .arg("version")
        .assert()
        .success();
}

#[test]
fn test_very_verbose_flag() {
    // -vv should work without errors
    worker_cmd()
        .arg("-vv")
        .arg("version")
        .assert()
        .success();
}

#[test]
fn test_quiet_flag() {
    worker_cmd()
        .arg("--quiet")
        .arg("version")
        .assert()
        .success();
}

// ─────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_unknown_command() {
    worker_cmd()
        .arg("unknown-command")
        .assert()
        .failure()
        .stderr(predicate::str::contains("error"));
}

#[test]
fn test_missing_subcommand() {
    // Running without any command should show help or error
    worker_cmd()
        .assert()
        .failure();
}
