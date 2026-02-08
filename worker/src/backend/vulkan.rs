//! Vulkan GPU backend loader
//!
//! This module provides a Vulkan-based GPU backend that loads its
//! implementation from a dynamically loaded plugin.

#![cfg(feature = "gpu")]

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::RwLock;
use tracing::{debug, info, warn};

use crate::error::{Error, Result};
use crate::gpu::{GpuInfo, GpuVendor};
use crate::plugins::{LoadedPlugin, PluginManager, PluginState};
use crate::types::{
    ClassificationInput, ClassificationOutput,
    EmbeddingsInput, EmbeddingsOutput,
    LoadedModelInfo, ModelSpec, TaskType,
    QuestionAnsweringInput, QuestionAnsweringOutput,
    SummarizationInput, SummarizationOutput,
    TextCompletionInput, TextCompletionOutput,
    TrainingBatchInput, TrainingBatchOutput,
    ValidationInput, ValidationOutput,
};

use super::{
    BackendCapabilities, BackendConfig, BackendHealth,
    InferenceBackend, ResourceUsage, StreamCallback,
};

// ─────────────────────────────────────────────────────────────────
// Vulkan Backend Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for the Vulkan backend
#[derive(Debug, Clone)]
pub struct VulkanBackendConfig {
    /// Base backend configuration
    pub base: BackendConfig,

    /// GPU device ID to use
    pub device_id: u32,

    /// Number of GPU layers to offload
    pub n_gpu_layers: Option<u32>,

    /// Context size for inference
    pub context_size: u32,

    /// Batch size
    pub batch_size: u32,
}

impl Default for VulkanBackendConfig {
    fn default() -> Self {
        Self {
            base: BackendConfig::default(),
            device_id: 0,
            n_gpu_layers: None, // Auto-calculate based on model and VRAM
            context_size: 4096,
            batch_size: 512,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Vulkan Backend State
// ─────────────────────────────────────────────────────────────────

/// Internal state for the Vulkan backend
struct VulkanBackendState {
    /// Currently loaded model info
    loaded_model: Option<LoadedModelInfo>,

    /// GPU memory used (MB)
    gpu_memory_used_mb: u64,

    /// Whether backend is operational
    operational: bool,

    /// Last error message
    last_error: Option<String>,
}

impl Default for VulkanBackendState {
    fn default() -> Self {
        Self {
            loaded_model: None,
            gpu_memory_used_mb: 0,
            operational: true,
            last_error: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Vulkan Backend
// ─────────────────────────────────────────────────────────────────

/// Vulkan-based GPU inference backend
///
/// This backend uses a dynamically loaded plugin to perform
/// Vulkan-accelerated inference. The plugin handles the actual
/// GPU operations while this struct manages the interface.
pub struct VulkanBackend {
    /// Configuration
    config: VulkanBackendConfig,

    /// GPU information
    gpu_info: GpuInfo,

    /// Internal state
    state: RwLock<VulkanBackendState>,

    /// Plugin name being used
    plugin_name: String,
}

impl VulkanBackend {
    /// Create a new Vulkan backend for a specific GPU
    ///
    /// Note: The plugin must be loaded separately via PluginManager.
    /// This just creates the wrapper that will use the plugin.
    pub fn new(config: VulkanBackendConfig, gpu_info: GpuInfo) -> Self {
        let plugin_name = match gpu_info.vendor {
            GpuVendor::Amd => "vulkan-backend", // Will use ROCm in future
            GpuVendor::Nvidia => "vulkan-backend", // Will use CUDA in future
            _ => "vulkan-backend",
        };

        info!(
            gpu = %gpu_info.name,
            vendor = %gpu_info.vendor,
            vram_mb = gpu_info.total_memory_mb,
            "Creating Vulkan backend"
        );

        Self {
            config,
            gpu_info,
            state: RwLock::new(VulkanBackendState::default()),
            plugin_name: plugin_name.to_string(),
        }
    }

    /// Get the GPU info
    pub fn gpu_info(&self) -> &GpuInfo {
        &self.gpu_info
    }

    /// Get the plugin name this backend requires
    pub fn plugin_name(&self) -> &str {
        &self.plugin_name
    }

    /// Calculate recommended GPU layers based on model size and VRAM
    pub fn calculate_gpu_layers(&self, model_size_mb: u64) -> u32 {
        // Reserve some VRAM for context and operations
        let available_mb = self.gpu_info.total_memory_mb.saturating_sub(1024);

        if model_size_mb == 0 {
            return 0;
        }

        // Rough estimate: each layer is model_size / 40 (typical 40-layer model)
        let layer_size_mb = model_size_mb / 40;
        if layer_size_mb == 0 {
            return 40; // Full offload for tiny models
        }

        let max_layers = (available_mb / layer_size_mb) as u32;
        max_layers.min(40) // Cap at 40 layers
    }

    /// Get estimated tokens per second for this GPU
    pub fn estimated_tokens_per_sec(&self, quantization: &str) -> u32 {
        self.gpu_info.estimated_tokens_per_sec(quantization)
    }

    /// Check if plugin operations are available
    fn check_plugin_available(&self) -> Result<()> {
        // In a full implementation, we'd check if the plugin is loaded
        // and call into its functions. For now, return not supported.
        Err(Error::NotSupported(
            "Vulkan plugin not yet implemented. GPU inference coming in next sprint.".to_string()
        ))
    }
}

#[async_trait]
impl InferenceBackend for VulkanBackend {
    fn name(&self) -> &'static str {
        "vulkan"
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            name: "vulkan",
            supported_tasks: vec![
                TaskType::TextCompletion,
                // More tasks will be added as plugin matures
            ],
            supports_training: false, // Not yet
            supports_streaming: true,
            max_context_length: self.config.context_size,
            max_batch_size: self.config.batch_size,
            gpu_available: true,
            gpu_device: Some(self.gpu_info.name.clone()),
        }
    }

    async fn health_check(&self) -> Result<BackendHealth> {
        let state = self.state.read();

        Ok(BackendHealth {
            operational: state.operational,
            model_loaded: state.loaded_model.is_some(),
            memory_used_mb: 0, // CPU memory not tracked for GPU backend
            gpu_memory_used_mb: Some(state.gpu_memory_used_mb),
            error: state.last_error.clone(),
        })
    }

    fn resource_usage(&self) -> ResourceUsage {
        let state = self.state.read();

        ResourceUsage {
            cpu_percent: 0.0, // GPU backend uses minimal CPU
            memory_mb: 0,
            gpu_percent: Some(0.0), // Would need monitoring to track
            gpu_memory_mb: Some(state.gpu_memory_used_mb),
            active_threads: 1,
        }
    }

    async fn load_model(&mut self, spec: &ModelSpec) -> Result<LoadedModelInfo> {
        self.check_plugin_available()?;

        // This would delegate to the plugin
        unimplemented!("Model loading via plugin")
    }

    async fn load_model_from_path(&mut self, path: &Path) -> Result<LoadedModelInfo> {
        self.check_plugin_available()?;

        // This would delegate to the plugin
        unimplemented!("Model loading via plugin")
    }

    async fn unload_model(&mut self) -> Result<()> {
        let mut state = self.state.write();
        state.loaded_model = None;
        state.gpu_memory_used_mb = 0;

        info!(backend = "vulkan", "Model unloaded");
        Ok(())
    }

    fn loaded_model(&self) -> Option<&LoadedModelInfo> {
        // Can't return reference to RwLock-guarded data
        // Would need to restructure to return Option<LoadedModelInfo>
        None
    }

    async fn text_completion(
        &self,
        input: TextCompletionInput,
    ) -> Result<TextCompletionOutput> {
        self.check_plugin_available()?;

        // This would delegate to the plugin
        unimplemented!("Text completion via plugin")
    }

    async fn text_completion_stream(
        &self,
        input: TextCompletionInput,
        callback: StreamCallback,
    ) -> Result<TextCompletionOutput> {
        self.check_plugin_available()?;

        // This would delegate to the plugin
        unimplemented!("Streaming text completion via plugin")
    }

    async fn embeddings(&self, input: EmbeddingsInput) -> Result<EmbeddingsOutput> {
        self.check_plugin_available()?;

        // Not yet supported
        Err(Error::NotSupported(
            "Embeddings not yet supported on Vulkan backend".to_string()
        ))
    }

    async fn train(&self, input: TrainingBatchInput) -> Result<TrainingBatchOutput> {
        // Training not supported on Vulkan backend (yet)
        Err(Error::NotSupported(
            "Training not supported on Vulkan backend".to_string()
        ))
    }
}

// ─────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────

/// Create a Vulkan backend for the best available GPU
pub fn create_vulkan_backend(
    config: Option<VulkanBackendConfig>,
) -> Result<VulkanBackend> {
    use crate::gpu::{detect_gpus, select_best_gpu};

    // Detect GPUs
    let gpus = detect_gpus()?;

    if gpus.is_empty() {
        return Err(Error::GpuNotFound {
            message: "No GPUs detected via Vulkan".to_string(),
        });
    }

    // Select best GPU
    let gpu = select_best_gpu(&gpus)
        .ok_or_else(|| Error::GpuNotFound {
            message: "No compute-capable GPU found".to_string(),
        })?;

    let mut cfg = config.unwrap_or_default();
    cfg.device_id = gpu.id;

    Ok(VulkanBackend::new(cfg, gpu.clone()))
}

/// Create a Vulkan backend for a specific GPU by device ID
pub fn create_vulkan_backend_for_device(
    device_id: u32,
    config: Option<VulkanBackendConfig>,
) -> Result<VulkanBackend> {
    use crate::gpu::detect_gpus;

    // Detect GPUs
    let gpus = detect_gpus()?;

    let gpu = gpus.into_iter()
        .find(|g| g.id == device_id)
        .ok_or_else(|| Error::GpuNotFound {
            message: format!("GPU with device ID {} not found", device_id),
        })?;

    let mut cfg = config.unwrap_or_default();
    cfg.device_id = device_id;

    Ok(VulkanBackend::new(cfg, gpu))
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::GpuApi;

    fn make_test_gpu() -> GpuInfo {
        GpuInfo {
            id: 0,
            name: "Test GPU".to_string(),
            vendor: GpuVendor::Amd,
            vendor_id: 0x1002,
            device_id: 0x1234,
            total_memory_mb: 16384,
            driver_version: "1.0".to_string(),
            api_support: vec![GpuApi::Vulkan],
            vulkan_version: Some("1.3".to_string()),
            is_discrete: true,
            compute_capable: true,
        }
    }

    #[test]
    fn test_vulkan_backend_creation() {
        let gpu = make_test_gpu();
        let config = VulkanBackendConfig::default();
        let backend = VulkanBackend::new(config, gpu);

        assert_eq!(backend.name(), "vulkan");
        assert!(backend.capabilities().gpu_available);
    }

    #[test]
    fn test_calculate_gpu_layers() {
        let gpu = make_test_gpu();
        let config = VulkanBackendConfig::default();
        let backend = VulkanBackend::new(config, gpu);

        // 7B model at Q4_K_M is roughly 4GB
        let layers = backend.calculate_gpu_layers(4096);
        assert!(layers > 0);
        assert!(layers <= 40);
    }

    #[test]
    fn test_estimated_tokens_per_sec() {
        let gpu = make_test_gpu();
        let config = VulkanBackendConfig::default();
        let backend = VulkanBackend::new(config, gpu);

        let tps = backend.estimated_tokens_per_sec("Q4_K_M");
        assert!(tps > 0);
    }

    #[test]
    fn test_capabilities() {
        let gpu = make_test_gpu();
        let config = VulkanBackendConfig::default();
        let backend = VulkanBackend::new(config, gpu.clone());

        let caps = backend.capabilities();
        assert_eq!(caps.name, "vulkan");
        assert!(caps.gpu_available);
        assert_eq!(caps.gpu_device, Some(gpu.name));
        assert!(caps.supported_tasks.contains(&TaskType::TextCompletion));
    }
}
