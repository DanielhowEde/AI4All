//! Backend trait definitions
//!
//! Defines the core InferenceBackend trait that all backends must implement.

use async_trait::async_trait;
use std::path::Path;
use std::sync::Arc;

use crate::error::{Error, Result};
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

// ─────────────────────────────────────────────────────────────────
// Backend Health & Status
// ─────────────────────────────────────────────────────────────────

/// Health status of a backend
#[derive(Debug, Clone)]
pub struct BackendHealth {
    /// Whether the backend is operational
    pub operational: bool,

    /// Whether a model is currently loaded
    pub model_loaded: bool,

    /// Memory used by the backend (MB)
    pub memory_used_mb: u64,

    /// GPU memory used (MB), if applicable
    pub gpu_memory_used_mb: Option<u64>,

    /// Any error message
    pub error: Option<String>,
}

impl Default for BackendHealth {
    fn default() -> Self {
        Self {
            operational: true,
            model_loaded: false,
            memory_used_mb: 0,
            gpu_memory_used_mb: None,
            error: None,
        }
    }
}

/// Resource usage of a backend
#[derive(Debug, Clone, Default)]
pub struct ResourceUsage {
    /// CPU usage percentage (0-100)
    pub cpu_percent: f32,

    /// System memory used (MB)
    pub memory_mb: u64,

    /// GPU usage percentage (0-100), if applicable
    pub gpu_percent: Option<f32>,

    /// GPU memory used (MB), if applicable
    pub gpu_memory_mb: Option<u64>,

    /// Number of active inference threads
    pub active_threads: u32,
}

/// Capabilities of a backend
#[derive(Debug, Clone)]
pub struct BackendCapabilities {
    /// Name of the backend
    pub name: &'static str,

    /// Supported task types
    pub supported_tasks: Vec<TaskType>,

    /// Whether training is supported
    pub supports_training: bool,

    /// Whether streaming output is supported
    pub supports_streaming: bool,

    /// Maximum context length supported
    pub max_context_length: u32,

    /// Maximum batch size
    pub max_batch_size: u32,

    /// Whether GPU acceleration is available
    pub gpu_available: bool,

    /// GPU device name (if available)
    pub gpu_device: Option<String>,
}

impl Default for BackendCapabilities {
    fn default() -> Self {
        Self {
            name: "unknown",
            supported_tasks: vec![TaskType::TextCompletion],
            supports_training: false,
            supports_streaming: false,
            max_context_length: 4096,
            max_batch_size: 1,
            gpu_available: false,
            gpu_device: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Streaming Support
// ─────────────────────────────────────────────────────────────────

/// A token generated during streaming
#[derive(Debug, Clone)]
pub struct StreamToken {
    /// The token text
    pub text: String,

    /// Token ID
    pub token_id: u32,

    /// Probability of this token
    pub probability: Option<f32>,

    /// Whether this is the final token
    pub is_final: bool,
}

/// Callback for streaming tokens
pub type StreamCallback = Box<dyn Fn(StreamToken) -> bool + Send + Sync>;

// ─────────────────────────────────────────────────────────────────
// InferenceBackend Trait
// ─────────────────────────────────────────────────────────────────

/// Core trait for inference backends
///
/// All inference backends (CPU, CUDA, ROCm, Vulkan) must implement this trait.
/// The trait is designed to be object-safe for dynamic dispatch.
#[async_trait]
pub trait InferenceBackend: Send + Sync {
    // ─────────────────────────────────────────────────────────────
    // Identity & Capabilities
    // ─────────────────────────────────────────────────────────────

    /// Get the backend name (e.g., "cpu", "cuda", "rocm")
    fn name(&self) -> &'static str;

    /// Get the backend capabilities
    fn capabilities(&self) -> BackendCapabilities;

    /// Check if this backend supports a given task type
    fn supports_task(&self, task_type: TaskType) -> bool {
        self.capabilities().supported_tasks.contains(&task_type)
    }

    /// Check if this backend supports training
    fn supports_training(&self) -> bool {
        self.capabilities().supports_training
    }

    // ─────────────────────────────────────────────────────────────
    // Health & Status
    // ─────────────────────────────────────────────────────────────

    /// Check the health of the backend
    async fn health_check(&self) -> Result<BackendHealth>;

    /// Get current resource usage
    fn resource_usage(&self) -> ResourceUsage;

    // ─────────────────────────────────────────────────────────────
    // Model Management
    // ─────────────────────────────────────────────────────────────

    /// Load a model from the given specification
    async fn load_model(&mut self, spec: &ModelSpec) -> Result<LoadedModelInfo>;

    /// Load a model from a file path
    async fn load_model_from_path(&mut self, path: &Path) -> Result<LoadedModelInfo>;

    /// Unload the currently loaded model
    async fn unload_model(&mut self) -> Result<()>;

    /// Get information about the currently loaded model
    fn loaded_model(&self) -> Option<&LoadedModelInfo>;

    /// Check if a model is loaded
    fn is_model_loaded(&self) -> bool {
        self.loaded_model().is_some()
    }

    // ─────────────────────────────────────────────────────────────
    // Inference Methods
    // ─────────────────────────────────────────────────────────────

    /// Execute text completion
    async fn text_completion(
        &self,
        input: TextCompletionInput,
    ) -> Result<TextCompletionOutput>;

    /// Execute text completion with streaming
    async fn text_completion_stream(
        &self,
        input: TextCompletionInput,
        callback: StreamCallback,
    ) -> Result<TextCompletionOutput> {
        // Default implementation: non-streaming fallback
        let _ = callback;
        self.text_completion(input).await
    }

    /// Generate embeddings
    async fn embeddings(
        &self,
        input: EmbeddingsInput,
    ) -> Result<EmbeddingsOutput> {
        Err(Error::NotSupported(format!(
            "Backend '{}' does not support embeddings",
            self.name()
        )))
    }

    /// Execute classification
    async fn classify(
        &self,
        input: ClassificationInput,
    ) -> Result<ClassificationOutput> {
        Err(Error::NotSupported(format!(
            "Backend '{}' does not support classification",
            self.name()
        )))
    }

    /// Execute question answering
    async fn question_answering(
        &self,
        input: QuestionAnsweringInput,
    ) -> Result<QuestionAnsweringOutput> {
        Err(Error::NotSupported(format!(
            "Backend '{}' does not support question answering",
            self.name()
        )))
    }

    /// Execute summarization
    async fn summarize(
        &self,
        input: SummarizationInput,
    ) -> Result<SummarizationOutput> {
        Err(Error::NotSupported(format!(
            "Backend '{}' does not support summarization",
            self.name()
        )))
    }

    /// Execute training batch (LoRA fine-tuning)
    async fn train(
        &self,
        input: TrainingBatchInput,
    ) -> Result<TrainingBatchOutput> {
        Err(Error::NotSupported(format!(
            "Backend '{}' does not support training",
            self.name()
        )))
    }

    /// Execute validation task
    async fn validate(
        &self,
        input: ValidationInput,
    ) -> Result<ValidationOutput> {
        Err(Error::NotSupported(format!(
            "Backend '{}' does not support validation",
            self.name()
        )))
    }
}

// ─────────────────────────────────────────────────────────────────
// Arc wrapper for trait objects
// ─────────────────────────────────────────────────────────────────

/// Type alias for a shared backend reference
pub type SharedBackend = Arc<dyn InferenceBackend>;

// ─────────────────────────────────────────────────────────────────
// Backend Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for creating a backend
#[derive(Debug, Clone)]
pub struct BackendConfig {
    /// Number of threads for CPU inference
    pub num_threads: Option<u32>,

    /// Context size (max tokens)
    pub context_size: u32,

    /// Batch size
    pub batch_size: u32,

    /// GPU layers to offload (0 = CPU only)
    pub gpu_layers: u32,

    /// Use memory mapping for model loading
    pub use_mmap: bool,

    /// Use memory locking (mlock)
    pub use_mlock: bool,

    /// Seed for random number generation
    pub seed: Option<u64>,

    /// OpenAI-compatible API configuration (used by OpenAi backend type)
    pub openai: Option<super::OpenAiConfig>,
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            num_threads: None, // Auto-detect
            context_size: 4096,
            batch_size: 512,
            gpu_layers: 0,
            use_mmap: true,
            use_mlock: false,
            seed: None,
            openai: None,
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
    fn test_backend_health_default() {
        let health = BackendHealth::default();
        assert!(health.operational);
        assert!(!health.model_loaded);
    }

    #[test]
    fn test_backend_capabilities_default() {
        let caps = BackendCapabilities::default();
        assert_eq!(caps.name, "unknown");
        assert!(!caps.supports_training);
        assert!(!caps.gpu_available);
    }

    #[test]
    fn test_backend_config_default() {
        let config = BackendConfig::default();
        assert!(config.num_threads.is_none());
        assert_eq!(config.context_size, 4096);
        assert!(config.use_mmap);
    }
}
