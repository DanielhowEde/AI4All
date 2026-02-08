//! System health and resource monitoring
//!
//! Provides resource usage metrics for heartbeat reporting.

use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::protocol::ResourceUsageReport;

// ─────────────────────────────────────────────────────────────────
// System Info
// ─────────────────────────────────────────────────────────────────

/// System information collected at startup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    /// Number of CPU cores
    pub cpu_count: usize,

    /// Total system memory (MB)
    pub total_memory_mb: u64,

    /// Operating system name
    pub os_name: String,

    /// OS version
    pub os_version: String,

    /// CPU architecture
    pub arch: String,

    /// Hostname
    pub hostname: String,
}

impl SystemInfo {
    /// Collect system information
    pub fn collect() -> Self {
        Self {
            cpu_count: num_cpus::get(),
            total_memory_mb: get_total_memory_mb(),
            os_name: std::env::consts::OS.to_string(),
            os_version: get_os_version(),
            arch: std::env::consts::ARCH.to_string(),
            hostname: get_hostname(),
        }
    }
}

/// Get total system memory in MB
fn get_total_memory_mb() -> u64 {
    // On Windows, use simple estimation based on available environment
    // For accurate values, we'd use sysinfo crate
    #[cfg(target_os = "windows")]
    {
        // Default to 8GB if we can't determine
        8192
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Try to read from /proc/meminfo on Linux
        if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
            for line in content.lines() {
                if line.starts_with("MemTotal:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<u64>() {
                            return kb / 1024;
                        }
                    }
                }
            }
        }
        8192 // Default fallback
    }
}

/// Get OS version string
fn get_os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        "Windows".to_string()
    }

    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|content| {
                content.lines()
                    .find(|l| l.starts_with("PRETTY_NAME="))
                    .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
            })
            .unwrap_or_else(|| "Linux".to_string())
    }

    #[cfg(target_os = "macos")]
    {
        "macOS".to_string()
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        "Unknown".to_string()
    }
}

/// Get hostname
fn get_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

// ─────────────────────────────────────────────────────────────────
// Health Monitor
// ─────────────────────────────────────────────────────────────────

/// Monitors system health and resource usage
pub struct HealthMonitor {
    /// System info collected at startup
    system_info: SystemInfo,

    /// Worker start time
    start_time: Instant,
}

impl HealthMonitor {
    /// Create a new health monitor
    pub fn new() -> Self {
        Self {
            system_info: SystemInfo::collect(),
            start_time: Instant::now(),
        }
    }

    /// Get system info
    pub fn system_info(&self) -> &SystemInfo {
        &self.system_info
    }

    /// Get uptime in seconds
    pub fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }

    /// Get current resource usage report
    pub fn resource_usage(&self) -> ResourceUsageReport {
        ResourceUsageReport {
            cpu_percent: self.get_cpu_usage(),
            memory_used_mb: self.get_memory_used_mb(),
            memory_available_mb: self.get_memory_available_mb(),
            gpu_percent: self.get_gpu_usage(),
            gpu_memory_used_mb: self.get_gpu_memory_used_mb(),
            active_threads: self.system_info.cpu_count as u32,
        }
    }

    /// Get CPU usage percentage (0-100)
    fn get_cpu_usage(&self) -> f32 {
        // Simplified: would use sysinfo crate for accurate values
        // For now, return a placeholder
        0.0
    }

    /// Get memory used in MB
    fn get_memory_used_mb(&self) -> u64 {
        // Simplified: would use sysinfo crate for accurate values
        // Try to estimate based on process memory
        #[cfg(target_os = "linux")]
        {
            if let Ok(content) = std::fs::read_to_string("/proc/self/statm") {
                let parts: Vec<&str> = content.split_whitespace().collect();
                if let Some(pages_str) = parts.get(1) {
                    if let Ok(pages) = pages_str.parse::<u64>() {
                        // Page size is typically 4KB
                        return (pages * 4) / 1024;
                    }
                }
            }
        }

        // Default: assume some base usage
        256
    }

    /// Get available memory in MB
    fn get_memory_available_mb(&self) -> u64 {
        self.system_info.total_memory_mb.saturating_sub(self.get_memory_used_mb())
    }

    /// Get GPU usage percentage
    fn get_gpu_usage(&self) -> Option<f32> {
        // Would require platform-specific GPU libraries (nvidia-ml, rocm-smi, etc.)
        None
    }

    /// Get GPU memory used in MB
    fn get_gpu_memory_used_mb(&self) -> Option<u64> {
        // Would require platform-specific GPU libraries
        None
    }

    /// Check if system is healthy
    pub fn is_healthy(&self) -> bool {
        // Check basic health conditions
        let usage = self.resource_usage();

        // Memory check: ensure we have at least 512MB available
        if usage.memory_available_mb < 512 {
            return false;
        }

        // CPU check: if measurable and too high
        if usage.cpu_percent > 95.0 {
            return false;
        }

        true
    }

    /// Get health status message
    pub fn health_status(&self) -> HealthStatus {
        let usage = self.resource_usage();

        if !self.is_healthy() {
            return HealthStatus {
                healthy: false,
                message: "System resources critically low".to_string(),
                checks: vec![
                    HealthCheck {
                        name: "memory".to_string(),
                        passed: usage.memory_available_mb >= 512,
                        detail: Some(format!("{}MB available", usage.memory_available_mb)),
                    },
                    HealthCheck {
                        name: "cpu".to_string(),
                        passed: usage.cpu_percent <= 95.0,
                        detail: Some(format!("{:.1}% usage", usage.cpu_percent)),
                    },
                ],
            };
        }

        HealthStatus {
            healthy: true,
            message: "System healthy".to_string(),
            checks: vec![
                HealthCheck {
                    name: "memory".to_string(),
                    passed: true,
                    detail: Some(format!("{}MB available", usage.memory_available_mb)),
                },
                HealthCheck {
                    name: "cpu".to_string(),
                    passed: true,
                    detail: Some(format!("{:.1}% usage", usage.cpu_percent)),
                },
            ],
        }
    }
}

impl Default for HealthMonitor {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────
// Health Status
// ─────────────────────────────────────────────────────────────────

/// Overall health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    /// Whether the system is healthy
    pub healthy: bool,

    /// Status message
    pub message: String,

    /// Individual health checks
    pub checks: Vec<HealthCheck>,
}

/// Individual health check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    /// Check name
    pub name: String,

    /// Whether the check passed
    pub passed: bool,

    /// Optional detail message
    pub detail: Option<String>,
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_info_collect() {
        let info = SystemInfo::collect();
        assert!(info.cpu_count > 0);
        assert!(info.total_memory_mb > 0);
        assert!(!info.os_name.is_empty());
    }

    #[test]
    fn test_health_monitor() {
        let monitor = HealthMonitor::new();
        assert!(monitor.uptime_secs() < 1);

        let usage = monitor.resource_usage();
        assert!(usage.memory_available_mb > 0);
    }

    #[test]
    fn test_health_status() {
        let monitor = HealthMonitor::new();
        let status = monitor.health_status();

        assert!(!status.checks.is_empty());
    }
}
