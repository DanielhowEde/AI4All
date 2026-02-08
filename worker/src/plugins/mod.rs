//! Plugin system for GPU backends
//!
//! Provides:
//! - Plugin registry with known plugin metadata
//! - Plugin manager for downloading, loading, and validating plugins
//! - Dynamic library loading for backend implementations

mod registry;
mod manager;

pub use registry::*;
pub use manager::*;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::gpu::GpuVendor;

// ─────────────────────────────────────────────────────────────────
// Plugin Metadata
// ─────────────────────────────────────────────────────────────────

/// Information about a downloadable plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    /// Plugin name (e.g., "vulkan-backend")
    pub name: String,

    /// Plugin version
    pub version: String,

    /// Description
    pub description: String,

    /// Supported GPU vendors
    pub supported_vendors: Vec<GpuVendor>,

    /// Download URL template (with placeholders for version, platform, arch)
    pub download_url: String,

    /// Expected SHA256 checksum
    pub checksum: String,

    /// File name (without platform-specific extension)
    pub file_name: String,

    /// Minimum worker version required
    pub min_worker_version: String,

    /// Plugin API version (for compatibility)
    pub api_version: u32,
}

impl PluginInfo {
    /// Get the platform-specific file extension
    pub fn platform_extension() -> &'static str {
        #[cfg(target_os = "windows")]
        { ".dll" }

        #[cfg(target_os = "linux")]
        { ".so" }

        #[cfg(target_os = "macos")]
        { ".dylib" }

        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        { ".so" }
    }

    /// Get the full file name with platform extension
    pub fn full_file_name(&self) -> String {
        format!("{}{}", self.file_name, Self::platform_extension())
    }

    /// Get the download URL for current platform
    pub fn get_download_url(&self) -> String {
        let platform = current_platform();
        let arch = current_arch();

        self.download_url
            .replace("{version}", &self.version)
            .replace("{platform}", platform)
            .replace("{arch}", arch)
            .replace("{ext}", Self::platform_extension().trim_start_matches('.'))
    }

    /// Check if this plugin supports a GPU vendor
    pub fn supports_vendor(&self, vendor: GpuVendor) -> bool {
        self.supported_vendors.contains(&vendor)
    }
}

// ─────────────────────────────────────────────────────────────────
// Loaded Plugin
// ─────────────────────────────────────────────────────────────────

/// A loaded plugin with its dynamic library
pub struct LoadedPlugin {
    /// Plugin metadata
    pub info: PluginInfo,

    /// Path to the loaded library
    pub path: PathBuf,

    /// Dynamic library handle
    #[cfg(feature = "gpu")]
    pub library: libloading::Library,

    /// Plugin state
    pub state: PluginState,
}

/// Plugin state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginState {
    /// Plugin is loaded and ready
    Ready,
    /// Plugin failed to initialize
    Failed,
    /// Plugin is being used
    Active,
    /// Plugin has been unloaded
    Unloaded,
}

// ─────────────────────────────────────────────────────────────────
// Plugin ABI
// ─────────────────────────────────────────────────────────────────

/// Plugin metadata returned by plugin's info function
#[repr(C)]
#[derive(Debug, Clone)]
pub struct PluginMetadata {
    /// Plugin name (null-terminated)
    pub name: [u8; 64],
    /// Plugin version (null-terminated)
    pub version: [u8; 32],
    /// API version
    pub api_version: u32,
}

/// Current plugin API version
pub const PLUGIN_API_VERSION: u32 = 1;

// ─────────────────────────────────────────────────────────────────
// Platform Helpers
// ─────────────────────────────────────────────────────────────────

/// Get the current platform name
fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    { "windows" }

    #[cfg(target_os = "linux")]
    { "linux" }

    #[cfg(target_os = "macos")]
    { "macos" }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    { "unknown" }
}

/// Get the current architecture
fn current_arch() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    { "x86_64" }

    #[cfg(target_arch = "aarch64")]
    { "aarch64" }

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    { "unknown" }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_extension() {
        let ext = PluginInfo::platform_extension();
        assert!(!ext.is_empty());
        assert!(ext.starts_with('.'));
    }

    #[test]
    fn test_plugin_info_url_substitution() {
        let info = PluginInfo {
            name: "test-plugin".to_string(),
            version: "1.0.0".to_string(),
            description: "Test".to_string(),
            supported_vendors: vec![GpuVendor::Amd],
            download_url: "https://example.com/{version}/{platform}-{arch}.{ext}".to_string(),
            checksum: "abc123".to_string(),
            file_name: "test_plugin".to_string(),
            min_worker_version: "0.1.0".to_string(),
            api_version: 1,
        };

        let url = info.get_download_url();
        assert!(url.contains("1.0.0"));
        assert!(!url.contains("{version}"));
        assert!(!url.contains("{platform}"));
    }

    #[test]
    fn test_vendor_support() {
        let info = PluginInfo {
            name: "vulkan".to_string(),
            version: "1.0.0".to_string(),
            description: "Vulkan backend".to_string(),
            supported_vendors: vec![GpuVendor::Amd, GpuVendor::Nvidia],
            download_url: "".to_string(),
            checksum: "".to_string(),
            file_name: "vulkan_backend".to_string(),
            min_worker_version: "0.1.0".to_string(),
            api_version: 1,
        };

        assert!(info.supports_vendor(GpuVendor::Amd));
        assert!(info.supports_vendor(GpuVendor::Nvidia));
        assert!(!info.supports_vendor(GpuVendor::Intel));
    }
}
