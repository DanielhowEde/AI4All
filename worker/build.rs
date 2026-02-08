//! Build script for AI4All Worker
//!
//! Embeds build-time information into the binary:
//! - Git commit hash
//! - Build timestamp
//! - Target triple
//! - Rust version
//! - Feature flags

use std::env;
use std::process::Command;

fn main() {
    // Rerun if git HEAD changes
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/index");

    // Get git information
    let git_hash = get_git_hash();
    let git_branch = get_git_branch();
    let git_dirty = is_git_dirty();

    // Get build information
    let build_timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string();
    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "unknown".to_string());
    let rustc_version = get_rustc_version();
    let host = env::var("HOST").unwrap_or_else(|_| "unknown".to_string());

    // Set environment variables for compilation
    println!("cargo:rustc-env=AI4ALL_GIT_HASH={}", git_hash);
    println!("cargo:rustc-env=AI4ALL_GIT_BRANCH={}", git_branch);
    println!("cargo:rustc-env=AI4ALL_GIT_DIRTY={}", git_dirty);
    println!("cargo:rustc-env=AI4ALL_BUILD_TIMESTAMP={}", build_timestamp);
    println!("cargo:rustc-env=AI4ALL_TARGET={}", target);
    println!("cargo:rustc-env=AI4ALL_PROFILE={}", profile);
    println!("cargo:rustc-env=AI4ALL_RUSTC_VERSION={}", rustc_version);
    println!("cargo:rustc-env=AI4ALL_HOST={}", host);

    // Print build info during compilation
    eprintln!("Building AI4All Worker:");
    eprintln!("  Git:     {}{}",git_hash, if git_dirty == "true" { " (dirty)" } else { "" });
    eprintln!("  Branch:  {}", git_branch);
    eprintln!("  Target:  {}", target);
    eprintln!("  Profile: {}", profile);
}

/// Get the current git commit hash (short form)
fn get_git_hash() -> String {
    Command::new("git")
        .args(["rev-parse", "--short=8", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Get the current git branch name
fn get_git_branch() -> String {
    Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Check if the git working directory is dirty
fn is_git_dirty() -> &'static str {
    Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .map(|output| {
            if output.status.success() && !output.stdout.is_empty() {
                "true"
            } else {
                "false"
            }
        })
        .unwrap_or("unknown")
}

/// Get the rustc version
fn get_rustc_version() -> String {
    Command::new("rustc")
        .args(["--version"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}
