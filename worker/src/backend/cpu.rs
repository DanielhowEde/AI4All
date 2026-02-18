//! CPU Backend for inference
//!
//! Provides CPU-based inference using llama.cpp bindings.
//! When the `llama` feature is enabled, uses the llama-cpp-2 crate.
//! When disabled, provides a stub implementation.

use async_trait::async_trait;
use parking_lot::RwLock;
use std::path::Path;
use std::time::Instant;

use crate::error::{Error, Result};
use crate::types::{
    EmbeddingsInput, EmbeddingsOutput,
    FinishReason, GgufMetadata, LoadedModelInfo, ModelFormat, ModelSpec,
    QuantizationType, TaskType, TextCompletionInput, TextCompletionOutput,
    TokenUsage,
};

use super::{
    BackendCapabilities, BackendConfig, BackendHealth, InferenceBackend,
    ResourceUsage, StreamCallback, StreamToken,
};

// ─────────────────────────────────────────────────────────────────
// CPU Backend Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration specific to the CPU backend
#[derive(Debug, Clone)]
pub struct CpuBackendConfig {
    /// Number of threads for inference (0 = auto)
    pub num_threads: u32,

    /// Context window size
    pub context_size: u32,

    /// Batch size for prompt processing
    pub batch_size: u32,

    /// Use memory mapping for model loading
    pub use_mmap: bool,

    /// Lock model in memory (prevents swapping)
    pub use_mlock: bool,

    /// Random seed for sampling
    pub seed: Option<u64>,
}

impl Default for CpuBackendConfig {
    fn default() -> Self {
        Self {
            num_threads: 0, // Auto-detect
            context_size: 4096,
            batch_size: 512,
            use_mmap: true,
            use_mlock: false,
            seed: None,
        }
    }
}

impl From<BackendConfig> for CpuBackendConfig {
    fn from(config: BackendConfig) -> Self {
        Self {
            num_threads: config.num_threads.unwrap_or(0),
            context_size: config.context_size,
            batch_size: config.batch_size,
            use_mmap: config.use_mmap,
            use_mlock: config.use_mlock,
            seed: config.seed,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// CPU Backend State
// ─────────────────────────────────────────────────────────────────

/// Internal state for the CPU backend
struct CpuBackendState {
    /// Currently loaded model info
    loaded_model: Option<LoadedModelInfo>,

    /// llama.cpp context (when feature enabled)
    #[cfg(feature = "llama")]
    llama_context: Option<llama_cpp_2::LlamaContext>,

    /// Memory used by the model (MB)
    memory_used_mb: u64,
}

impl Default for CpuBackendState {
    fn default() -> Self {
        Self {
            loaded_model: None,
            #[cfg(feature = "llama")]
            llama_context: None,
            memory_used_mb: 0,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// CPU Backend Implementation
// ─────────────────────────────────────────────────────────────────

/// CPU-based inference backend
///
/// Uses llama.cpp for efficient CPU inference with GGUF models.
pub struct CpuBackend {
    config: CpuBackendConfig,
    state: RwLock<CpuBackendState>,
    actual_threads: u32,
}

impl CpuBackend {
    /// Create a new CPU backend with default configuration
    pub fn new() -> Self {
        Self::with_config(CpuBackendConfig::default())
    }

    /// Create a new CPU backend with custom configuration
    pub fn with_config(config: CpuBackendConfig) -> Self {
        let actual_threads = if config.num_threads == 0 {
            num_cpus::get() as u32
        } else {
            config.num_threads
        };

        tracing::info!(
            threads = actual_threads,
            context_size = config.context_size,
            "Initializing CPU backend"
        );

        Self {
            config,
            state: RwLock::new(CpuBackendState::default()),
            actual_threads,
        }
    }

    /// Create from generic BackendConfig
    pub fn from_config(config: BackendConfig) -> Self {
        Self::with_config(config.into())
    }

    /// Get the number of threads being used
    pub fn num_threads(&self) -> u32 {
        self.actual_threads
    }

    /// Parse GGUF metadata from file
    fn parse_gguf_metadata(&self, _path: &Path) -> GgufMetadata {
        // TODO: Implement actual GGUF parsing
        // For now, return defaults
        GgufMetadata {
            architecture: Some("llama".to_string()),
            context_length: Some(self.config.context_size),
            ..Default::default()
        }
    }

    /// Estimate model size in MB
    fn estimate_model_size(&self, path: &Path) -> u64 {
        path.metadata()
            .map(|m| m.len() / (1024 * 1024))
            .unwrap_or(0)
    }
}

impl Default for CpuBackend {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────
// InferenceBackend Implementation (without llama feature)
// ─────────────────────────────────────────────────────────────────

#[cfg(not(feature = "llama"))]
#[async_trait]
impl InferenceBackend for CpuBackend {
    fn name(&self) -> &'static str {
        "cpu"
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            name: "cpu",
            supported_tasks: vec![TaskType::TextCompletion],
            supports_training: false,
            supports_streaming: true,
            max_context_length: self.config.context_size,
            max_batch_size: self.config.batch_size,
            gpu_available: false,
            gpu_device: None,
        }
    }

    async fn health_check(&self) -> Result<BackendHealth> {
        let state = self.state.read();
        Ok(BackendHealth {
            operational: true,
            model_loaded: state.loaded_model.is_some(),
            memory_used_mb: state.memory_used_mb,
            gpu_memory_used_mb: None,
            error: Some("llama feature not enabled - stub implementation".to_string()),
        })
    }

    fn resource_usage(&self) -> ResourceUsage {
        let state = self.state.read();
        ResourceUsage {
            cpu_percent: 0.0,
            memory_mb: state.memory_used_mb,
            gpu_percent: None,
            gpu_memory_mb: None,
            active_threads: self.actual_threads,
        }
    }

    async fn load_model(&mut self, spec: &ModelSpec) -> Result<LoadedModelInfo> {
        tracing::warn!(
            model_id = %spec.id,
            "Loading model (stub - llama feature not enabled)"
        );

        let start = Instant::now();

        // Validate file exists
        if !spec.path.exists() {
            return Err(Error::ModelNotFound {
                model_id: spec.id.clone(),
            });
        }

        // Validate format
        if spec.format != ModelFormat::Gguf {
            return Err(Error::ModelIncompatible {
                model_id: spec.id.clone(),
                reason: format!("CPU backend only supports GGUF format, got {:?}", spec.format),
            });
        }

        let metadata = self.parse_gguf_metadata(&spec.path);
        let memory_used_mb = self.estimate_model_size(&spec.path);

        let info = LoadedModelInfo {
            spec: spec.clone(),
            metadata,
            memory_used_mb,
            load_time_ms: start.elapsed().as_millis() as u64,
            ready: false, // Stub can't actually run inference
        };

        let mut state = self.state.write();
        state.loaded_model = Some(info.clone());
        state.memory_used_mb = memory_used_mb;

        Ok(info)
    }

    async fn load_model_from_path(&mut self, path: &Path) -> Result<LoadedModelInfo> {
        if !path.exists() {
            return Err(Error::ModelNotFound {
                model_id: path.display().to_string(),
            });
        }

        let spec = ModelSpec {
            id: path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string(),
            name: path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown Model")
                .to_string(),
            family: None,
            path: path.to_path_buf(),
            format: ModelFormat::from_path(path).unwrap_or(ModelFormat::Gguf),
            quantization: None,
            parameters_b: None,
            context_length: self.config.context_size,
            vocab_size: None,
            embedding_dim: None,
            num_layers: None,
            num_heads: None,
            file_size: path.metadata().map(|m| m.len()).unwrap_or(0),
            sha256: None,
        };

        self.load_model(&spec).await
    }

    async fn unload_model(&mut self) -> Result<()> {
        let mut state = self.state.write();
        state.loaded_model = None;
        state.memory_used_mb = 0;
        tracing::info!("Model unloaded");
        Ok(())
    }

    fn loaded_model(&self) -> Option<&LoadedModelInfo> {
        // Can't return reference to RwLock interior
        None
    }

    fn is_model_loaded(&self) -> bool {
        self.state.read().loaded_model.is_some()
    }

    async fn text_completion(
        &self,
        input: TextCompletionInput,
    ) -> Result<TextCompletionOutput> {
        // Stub implementation - return error
        Err(Error::NotSupported(
            "CPU backend requires 'llama' feature to be enabled for inference. \
             Build with: cargo build --features llama".to_string()
        ))
    }

    async fn text_completion_stream(
        &self,
        input: TextCompletionInput,
        _callback: StreamCallback,
    ) -> Result<TextCompletionOutput> {
        // Stub - delegate to non-streaming
        self.text_completion(input).await
    }
}

// ─────────────────────────────────────────────────────────────────
// InferenceBackend Implementation (with llama feature)
// ─────────────────────────────────────────────────────────────────

#[cfg(feature = "llama")]
#[async_trait]
impl InferenceBackend for CpuBackend {
    fn name(&self) -> &'static str {
        "cpu"
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            name: "cpu",
            supported_tasks: vec![TaskType::TextCompletion],
            supports_training: false,
            supports_streaming: true,
            max_context_length: self.config.context_size,
            max_batch_size: self.config.batch_size,
            gpu_available: false,
            gpu_device: None,
        }
    }

    async fn health_check(&self) -> Result<BackendHealth> {
        let state = self.state.read();
        Ok(BackendHealth {
            operational: true,
            model_loaded: state.loaded_model.is_some(),
            memory_used_mb: state.memory_used_mb,
            gpu_memory_used_mb: None,
            error: None,
        })
    }

    fn resource_usage(&self) -> ResourceUsage {
        let state = self.state.read();
        ResourceUsage {
            cpu_percent: 0.0, // Would need sysinfo to get this
            memory_mb: state.memory_used_mb,
            gpu_percent: None,
            gpu_memory_mb: None,
            active_threads: self.actual_threads,
        }
    }

    async fn load_model(&mut self, spec: &ModelSpec) -> Result<LoadedModelInfo> {
        use llama_cpp_2::*;

        tracing::info!(
            model_id = %spec.id,
            path = %spec.path.display(),
            "Loading model with llama.cpp"
        );

        let start = Instant::now();

        // Validate file exists
        if !spec.path.exists() {
            return Err(Error::ModelNotFound {
                model_id: spec.id.clone(),
            });
        }

        // Build llama.cpp parameters
        let params = LlamaContextParams::default()
            .with_n_ctx(self.config.context_size as i32)
            .with_n_threads(self.actual_threads as i32)
            .with_seed(self.config.seed.unwrap_or(0) as u32);

        // Load the model
        let model = LlamaModel::load_from_file(&spec.path, params)
            .map_err(|e| Error::ModelLoadFailed {
                model_id: spec.id.clone(),
                message: e.to_string(),
            })?;

        // Create context
        let ctx = LlamaContext::new(&model, params)
            .map_err(|e| Error::ModelLoadFailed {
                model_id: spec.id.clone(),
                message: format!("Failed to create context: {}", e),
            })?;

        let metadata = self.parse_gguf_metadata(&spec.path);
        let memory_used_mb = self.estimate_model_size(&spec.path);

        let info = LoadedModelInfo {
            spec: spec.clone(),
            metadata,
            memory_used_mb,
            load_time_ms: start.elapsed().as_millis() as u64,
            ready: true,
        };

        let mut state = self.state.write();
        state.llama_context = Some(ctx);
        state.loaded_model = Some(info.clone());
        state.memory_used_mb = memory_used_mb;

        tracing::info!(
            model_id = %spec.id,
            load_time_ms = info.load_time_ms,
            memory_mb = memory_used_mb,
            "Model loaded successfully"
        );

        Ok(info)
    }

    async fn load_model_from_path(&mut self, path: &Path) -> Result<LoadedModelInfo> {
        if !path.exists() {
            return Err(Error::ModelNotFound {
                model_id: path.display().to_string(),
            });
        }

        let spec = ModelSpec {
            id: path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string(),
            name: path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown Model")
                .to_string(),
            family: None,
            path: path.to_path_buf(),
            format: ModelFormat::from_path(path).unwrap_or(ModelFormat::Gguf),
            quantization: None,
            parameters_b: None,
            context_length: self.config.context_size,
            vocab_size: None,
            embedding_dim: None,
            num_layers: None,
            num_heads: None,
            file_size: path.metadata().map(|m| m.len()).unwrap_or(0),
            sha256: None,
        };

        self.load_model(&spec).await
    }

    async fn unload_model(&mut self) -> Result<()> {
        let mut state = self.state.write();
        state.llama_context = None;
        state.loaded_model = None;
        state.memory_used_mb = 0;
        tracing::info!("Model unloaded");
        Ok(())
    }

    fn loaded_model(&self) -> Option<&LoadedModelInfo> {
        None // Can't return reference through RwLock
    }

    fn is_model_loaded(&self) -> bool {
        self.state.read().loaded_model.is_some()
    }

    async fn text_completion(
        &self,
        input: TextCompletionInput,
    ) -> Result<TextCompletionOutput> {
        use llama_cpp_2::*;

        let state = self.state.read();
        let ctx = state.llama_context.as_ref()
            .ok_or_else(|| Error::Model("No model loaded".to_string()))?;

        let start = Instant::now();

        // Tokenize prompt
        let prompt = if let Some(ref system) = input.system_prompt {
            format!("{}\n\n{}", system, input.prompt)
        } else {
            input.prompt.clone()
        };

        let tokens = ctx.tokenize(&prompt, true)
            .map_err(|e| Error::ExecutionFailed {
                task_id: None,
                message: format!("Tokenization failed: {}", e),
            })?;

        let prompt_tokens = tokens.len() as u32;

        // Set up sampling parameters
        let mut sampler = LlamaSampler::new()
            .with_temp(input.params.temperature)
            .with_top_p(input.params.top_p)
            .with_top_k(input.params.top_k as i32)
            .with_repeat_penalty(input.params.repetition_penalty);

        if let Some(seed) = input.params.seed {
            sampler = sampler.with_seed(seed as u32);
        }

        // Generate tokens
        let mut output_tokens = Vec::new();
        let mut generated_text = String::new();
        let mut finish_reason = FinishReason::Length;

        for _ in 0..input.params.max_tokens {
            // Sample next token
            let token = ctx.sample(&tokens, &output_tokens, &sampler)
                .map_err(|e| Error::ExecutionFailed {
                    task_id: None,
                    message: format!("Sampling failed: {}", e),
                })?;

            // Check for EOS
            if ctx.is_eos(token) {
                finish_reason = FinishReason::Stop;
                break;
            }

            // Decode token
            let text = ctx.token_to_str(token)
                .map_err(|e| Error::ExecutionFailed {
                    task_id: None,
                    message: format!("Token decoding failed: {}", e),
                })?;

            output_tokens.push(token);
            generated_text.push_str(&text);

            // Check stop sequences
            for stop in &input.params.stop_sequences {
                if generated_text.ends_with(stop) {
                    finish_reason = FinishReason::Stop;
                    break;
                }
            }

            if finish_reason == FinishReason::Stop {
                break;
            }
        }

        let completion_tokens = output_tokens.len() as u32;

        Ok(TextCompletionOutput {
            text: generated_text,
            finish_reason,
            usage: TokenUsage::new(prompt_tokens, completion_tokens),
            generation_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn text_completion_stream(
        &self,
        input: TextCompletionInput,
        callback: StreamCallback,
    ) -> Result<TextCompletionOutput> {
        // TODO: Implement proper streaming
        // For now, generate all and stream after
        let result = self.text_completion(input).await?;

        // Stream the result word by word (mock streaming)
        let words: Vec<&str> = result.text.split_whitespace().collect();
        for (i, word) in words.iter().enumerate() {
            let token = StreamToken {
                text: if i == 0 { word.to_string() } else { format!(" {}", word) },
                token_id: i as u32,
                probability: None,
                is_final: i == words.len() - 1,
            };

            if !callback(token) {
                break;
            }
        }

        Ok(result)
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cpu_backend_creation() {
        let backend = CpuBackend::new();
        assert_eq!(backend.name(), "cpu");
        assert!(backend.num_threads() > 0);
    }

    #[test]
    fn test_cpu_backend_capabilities() {
        let backend = CpuBackend::new();
        let caps = backend.capabilities();

        assert_eq!(caps.name, "cpu");
        assert!(caps.supported_tasks.contains(&TaskType::TextCompletion));
        assert!(!caps.supports_training);
        assert!(!caps.gpu_available);
    }

    #[test]
    fn test_cpu_config_from_backend_config() {
        let config = BackendConfig {
            num_threads: Some(4),
            context_size: 8192,
            batch_size: 256,
            gpu_layers: 0,
            use_mmap: false,
            use_mlock: true,
            seed: Some(42),
            openai: None,
        };

        let cpu_config: CpuBackendConfig = config.into();

        assert_eq!(cpu_config.num_threads, 4);
        assert_eq!(cpu_config.context_size, 8192);
        assert!(!cpu_config.use_mmap);
        assert!(cpu_config.use_mlock);
    }

    #[tokio::test]
    async fn test_health_check() {
        let backend = CpuBackend::new();
        let health = backend.health_check().await.unwrap();

        assert!(health.operational);
        assert!(!health.model_loaded);
    }

    #[test]
    fn test_resource_usage() {
        let backend = CpuBackend::new();
        let usage = backend.resource_usage();

        assert_eq!(usage.memory_mb, 0); // No model loaded
        assert!(usage.gpu_percent.is_none());
    }
}
