//! Plugin registry with known plugin metadata
//!
//! Provides a registry of known/official plugins that can be downloaded.

use crate::gpu::{GpuInfo, GpuVendor};

use super::PluginInfo;

// ─────────────────────────────────────────────────────────────────
// Plugin Registry
// ─────────────────────────────────────────────────────────────────

/// Registry of known plugins
pub struct PluginRegistry {
    /// List of known plugins
    plugins: Vec<PluginInfo>,

    /// Base URL for plugin downloads
    base_url: String,
}

impl PluginRegistry {
    /// Create a new registry with default plugins
    pub fn new() -> Self {
        Self::with_base_url("https://plugins.ai4all.network")
    }

    /// Create a registry with custom base URL
    pub fn with_base_url(base_url: &str) -> Self {
        let plugins = vec![
            // Vulkan backend (cross-platform: AMD, NVIDIA, Intel)
            PluginInfo {
                name: "vulkan-backend".to_string(),
                version: "0.1.0".to_string(),
                description: "Vulkan-based GPU inference backend".to_string(),
                supported_vendors: vec![
                    GpuVendor::Amd,
                    GpuVendor::Nvidia,
                    GpuVendor::Intel,
                ],
                download_url: format!(
                    "{}/v{{version}}/vulkan-backend-{{platform}}-{{arch}}.{{ext}}",
                    base_url
                ),
                checksum: "".to_string(), // Will be fetched from manifest
                file_name: "vulkan_backend".to_string(),
                min_worker_version: "0.1.0".to_string(),
                api_version: 1,
            },

            // CUDA backend (NVIDIA only) - future
            PluginInfo {
                name: "cuda-backend".to_string(),
                version: "0.1.0".to_string(),
                description: "CUDA-based GPU inference backend (NVIDIA)".to_string(),
                supported_vendors: vec![GpuVendor::Nvidia],
                download_url: format!(
                    "{}/v{{version}}/cuda-backend-{{platform}}-{{arch}}.{{ext}}",
                    base_url
                ),
                checksum: "".to_string(),
                file_name: "cuda_backend".to_string(),
                min_worker_version: "0.1.0".to_string(),
                api_version: 1,
            },

            // ROCm backend (AMD only) - future
            PluginInfo {
                name: "rocm-backend".to_string(),
                version: "0.1.0".to_string(),
                description: "ROCm-based GPU inference backend (AMD)".to_string(),
                supported_vendors: vec![GpuVendor::Amd],
                download_url: format!(
                    "{}/v{{version}}/rocm-backend-{{platform}}-{{arch}}.{{ext}}",
                    base_url
                ),
                checksum: "".to_string(),
                file_name: "rocm_backend".to_string(),
                min_worker_version: "0.1.0".to_string(),
                api_version: 1,
            },
        ];

        Self {
            plugins,
            base_url: base_url.to_string(),
        }
    }

    /// Get all known plugins
    pub fn plugins(&self) -> &[PluginInfo] {
        &self.plugins
    }

    /// Find a plugin by name
    pub fn find_by_name(&self, name: &str) -> Option<&PluginInfo> {
        self.plugins.iter().find(|p| p.name == name)
    }

    /// Find plugins that support a specific GPU vendor
    pub fn find_for_vendor(&self, vendor: GpuVendor) -> Vec<&PluginInfo> {
        self.plugins
            .iter()
            .filter(|p| p.supports_vendor(vendor))
            .collect()
    }

    /// Find the best plugin for a specific GPU
    ///
    /// Priority: vendor-specific > cross-platform
    /// For AMD: ROCm > Vulkan
    /// For NVIDIA: CUDA > Vulkan
    pub fn find_best_for_gpu(&self, gpu: &GpuInfo) -> Option<&PluginInfo> {
        let compatible = self.find_for_vendor(gpu.vendor);

        if compatible.is_empty() {
            return None;
        }

        // Prefer vendor-specific backends
        match gpu.vendor {
            GpuVendor::Amd => {
                // ROCm first, then Vulkan
                compatible.iter()
                    .find(|p| p.name == "rocm-backend")
                    .or_else(|| compatible.iter().find(|p| p.name == "vulkan-backend"))
                    .copied()
            }
            GpuVendor::Nvidia => {
                // CUDA first, then Vulkan
                compatible.iter()
                    .find(|p| p.name == "cuda-backend")
                    .or_else(|| compatible.iter().find(|p| p.name == "vulkan-backend"))
                    .copied()
            }
            _ => {
                // Vulkan for everyone else
                compatible.iter()
                    .find(|p| p.name == "vulkan-backend")
                    .copied()
            }
        }
    }

    /// Get the base URL
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Add a custom plugin to the registry
    pub fn add_plugin(&mut self, plugin: PluginInfo) {
        self.plugins.push(plugin);
    }

    /// Update checksums from manifest
    pub fn update_checksums(&mut self, checksums: &[(String, String)]) {
        for (name, checksum) in checksums {
            if let Some(plugin) = self.plugins.iter_mut().find(|p| &p.name == name) {
                plugin.checksum = checksum.clone();
            }
        }
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::GpuApi;

    fn make_amd_gpu() -> GpuInfo {
        GpuInfo {
            id: 0,
            name: "AMD RX 7900".to_string(),
            vendor: GpuVendor::Amd,
            vendor_id: 0x1002,
            device_id: 0x1234,
            total_memory_mb: 24576,
            driver_version: "23.10".to_string(),
            api_support: vec![GpuApi::Vulkan, GpuApi::Rocm],
            vulkan_version: Some("1.3".to_string()),
            is_discrete: true,
            compute_capable: true,
        }
    }

    fn make_nvidia_gpu() -> GpuInfo {
        GpuInfo {
            id: 0,
            name: "RTX 4090".to_string(),
            vendor: GpuVendor::Nvidia,
            vendor_id: 0x10DE,
            device_id: 0x5678,
            total_memory_mb: 24576,
            driver_version: "537.42".to_string(),
            api_support: vec![GpuApi::Vulkan, GpuApi::Cuda],
            vulkan_version: Some("1.3".to_string()),
            is_discrete: true,
            compute_capable: true,
        }
    }

    #[test]
    fn test_registry_default() {
        let registry = PluginRegistry::new();
        assert!(!registry.plugins().is_empty());
    }

    #[test]
    fn test_find_by_name() {
        let registry = PluginRegistry::new();
        let vulkan = registry.find_by_name("vulkan-backend");
        assert!(vulkan.is_some());
        assert_eq!(vulkan.unwrap().name, "vulkan-backend");
    }

    #[test]
    fn test_find_for_vendor() {
        let registry = PluginRegistry::new();

        let amd_plugins = registry.find_for_vendor(GpuVendor::Amd);
        assert!(amd_plugins.iter().any(|p| p.name == "vulkan-backend"));
        assert!(amd_plugins.iter().any(|p| p.name == "rocm-backend"));

        let nvidia_plugins = registry.find_for_vendor(GpuVendor::Nvidia);
        assert!(nvidia_plugins.iter().any(|p| p.name == "vulkan-backend"));
        assert!(nvidia_plugins.iter().any(|p| p.name == "cuda-backend"));
    }

    #[test]
    fn test_find_best_for_gpu_amd() {
        let registry = PluginRegistry::new();
        let gpu = make_amd_gpu();

        let best = registry.find_best_for_gpu(&gpu);
        assert!(best.is_some());
        // Should prefer ROCm for AMD
        assert_eq!(best.unwrap().name, "rocm-backend");
    }

    #[test]
    fn test_find_best_for_gpu_nvidia() {
        let registry = PluginRegistry::new();
        let gpu = make_nvidia_gpu();

        let best = registry.find_best_for_gpu(&gpu);
        assert!(best.is_some());
        // Should prefer CUDA for NVIDIA
        assert_eq!(best.unwrap().name, "cuda-backend");
    }

    #[test]
    fn test_custom_base_url() {
        let registry = PluginRegistry::with_base_url("https://custom.example.com");
        assert_eq!(registry.base_url(), "https://custom.example.com");

        let vulkan = registry.find_by_name("vulkan-backend").unwrap();
        assert!(vulkan.download_url.contains("custom.example.com"));
    }
}
