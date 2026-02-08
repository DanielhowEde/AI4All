//! Mock backend for testing
//!
//! Provides a mock implementation of InferenceBackend for unit testing.

use async_trait::async_trait;
use parking_lot::RwLock;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::error::{Error, Result};
use crate::types::{
    ClassificationInput, ClassificationOutput, ClassificationPrediction,
    EmbeddingsInput, EmbeddingsOutput,
    FinishReason, GgufMetadata, LoadedModelInfo, ModelFormat, ModelSpec,
    QuestionAnsweringInput, QuestionAnsweringOutput,
    SummarizationInput, SummarizationOutput,
    TaskType, TextCompletionInput, TextCompletionOutput, TokenUsage,
    TrainingBatchInput, TrainingBatchOutput,
    ValidationInput, ValidationOutput,
};

use super::{
    BackendCapabilities, BackendConfig, BackendHealth, InferenceBackend,
    ResourceUsage, StreamCallback, StreamToken,
};

// ─────────────────────────────────────────────────────────────────
// Mock Backend Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for mock backend behavior
#[derive(Debug, Clone)]
pub struct MockConfig {
    /// Simulated latency per token (ms)
    pub token_latency_ms: u64,

    /// Whether to fail on certain operations
    pub fail_load_model: bool,
    pub fail_text_completion: bool,
    pub fail_embeddings: bool,

    /// Fixed response text (for deterministic testing)
    pub fixed_response: Option<String>,

    /// Embedding dimensions
    pub embedding_dims: usize,
}

impl Default for MockConfig {
    fn default() -> Self {
        Self {
            token_latency_ms: 10,
            fail_load_model: false,
            fail_text_completion: false,
            fail_embeddings: false,
            fixed_response: None,
            embedding_dims: 384,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Mock Backend
// ─────────────────────────────────────────────────────────────────

/// Mock implementation of InferenceBackend for testing
pub struct MockBackend {
    config: MockConfig,
    backend_config: BackendConfig,
    loaded_model: RwLock<Option<LoadedModelInfo>>,
    call_counts: RwLock<CallCounts>,
}

/// Track method call counts for verification
#[derive(Debug, Default)]
struct CallCounts {
    text_completion: u32,
    embeddings: u32,
    classify: u32,
    summarize: u32,
    load_model: u32,
    unload_model: u32,
}

impl MockBackend {
    /// Create a new mock backend with default configuration
    pub fn new() -> Self {
        Self::with_config(MockConfig::default(), BackendConfig::default())
    }

    /// Create a new mock backend with custom configuration
    pub fn with_config(mock_config: MockConfig, backend_config: BackendConfig) -> Self {
        Self {
            config: mock_config,
            backend_config,
            loaded_model: RwLock::new(None),
            call_counts: RwLock::new(CallCounts::default()),
        }
    }

    /// Get the number of times a method was called
    pub fn call_count(&self, method: &str) -> u32 {
        let counts = self.call_counts.read();
        match method {
            "text_completion" => counts.text_completion,
            "embeddings" => counts.embeddings,
            "classify" => counts.classify,
            "summarize" => counts.summarize,
            "load_model" => counts.load_model,
            "unload_model" => counts.unload_model,
            _ => 0,
        }
    }

    /// Reset all call counts
    pub fn reset_counts(&self) {
        *self.call_counts.write() = CallCounts::default();
    }

    /// Simulate token generation latency
    async fn simulate_latency(&self, tokens: u32) {
        if self.config.token_latency_ms > 0 {
            let delay = Duration::from_millis(self.config.token_latency_ms * tokens as u64);
            tokio::time::sleep(delay).await;
        }
    }

    /// Generate mock response text
    fn generate_response(&self, input: &TextCompletionInput) -> String {
        if let Some(ref fixed) = self.config.fixed_response {
            return fixed.clone();
        }

        // Generate a predictable response based on input
        let words: Vec<&str> = input.prompt.split_whitespace().collect();
        let response_words = vec![
            "The", "answer", "to", "your", "question", "is", "that",
            "we", "need", "to", "consider", "multiple", "factors",
            "including", "the", "context", "and", "available", "data",
        ];

        let max_words = (input.params.max_tokens / 4) as usize;
        response_words
            .iter()
            .cycle()
            .take(max_words.min(response_words.len()))
            .cloned()
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Generate mock embeddings
    fn generate_embeddings(&self, text: &str) -> Vec<f32> {
        // Generate deterministic embeddings based on text hash
        use sha2::{Sha256, Digest};

        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = hasher.finalize();

        let mut embeddings = Vec::with_capacity(self.config.embedding_dims);
        for i in 0..self.config.embedding_dims {
            let byte_idx = i % 32;
            let value = (hash[byte_idx] as f32 / 255.0) * 2.0 - 1.0;
            embeddings.push(value);
        }

        // Normalize
        let magnitude: f32 = embeddings.iter().map(|x| x * x).sum::<f32>().sqrt();
        if magnitude > 0.0 {
            for e in &mut embeddings {
                *e /= magnitude;
            }
        }

        embeddings
    }
}

impl Default for MockBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl InferenceBackend for MockBackend {
    fn name(&self) -> &'static str {
        "mock"
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            name: "mock",
            supported_tasks: vec![
                TaskType::TextCompletion,
                TaskType::Embeddings,
                TaskType::Classification,
                TaskType::QuestionAnswering,
                TaskType::Summarization,
            ],
            supports_training: false,
            supports_streaming: true,
            max_context_length: self.backend_config.context_size,
            max_batch_size: self.backend_config.batch_size,
            gpu_available: false,
            gpu_device: None,
        }
    }

    async fn health_check(&self) -> Result<BackendHealth> {
        Ok(BackendHealth {
            operational: true,
            model_loaded: self.loaded_model.read().is_some(),
            memory_used_mb: 100, // Mock value
            gpu_memory_used_mb: None,
            error: None,
        })
    }

    fn resource_usage(&self) -> ResourceUsage {
        ResourceUsage {
            cpu_percent: 10.0,
            memory_mb: 100,
            gpu_percent: None,
            gpu_memory_mb: None,
            active_threads: 1,
        }
    }

    async fn load_model(&mut self, spec: &ModelSpec) -> Result<LoadedModelInfo> {
        self.call_counts.write().load_model += 1;

        if self.config.fail_load_model {
            return Err(Error::ModelLoadFailed {
                model_id: spec.id.clone(),
                message: "Mock failure".to_string(),
            });
        }

        // Simulate loading time
        tokio::time::sleep(Duration::from_millis(100)).await;

        let info = LoadedModelInfo {
            spec: spec.clone(),
            metadata: GgufMetadata {
                architecture: Some("mock".to_string()),
                name: Some(spec.name.clone()),
                context_length: Some(self.backend_config.context_size),
                ..Default::default()
            },
            memory_used_mb: 100,
            load_time_ms: 100,
            ready: true,
        };

        *self.loaded_model.write() = Some(info.clone());
        Ok(info)
    }

    async fn load_model_from_path(&mut self, path: &Path) -> Result<LoadedModelInfo> {
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
            context_length: self.backend_config.context_size,
            vocab_size: None,
            embedding_dim: Some(self.config.embedding_dims as u32),
            num_layers: None,
            num_heads: None,
            file_size: 0,
            sha256: None,
        };

        self.load_model(&spec).await
    }

    async fn unload_model(&mut self) -> Result<()> {
        self.call_counts.write().unload_model += 1;
        *self.loaded_model.write() = None;
        Ok(())
    }

    fn loaded_model(&self) -> Option<&LoadedModelInfo> {
        // Note: This is a bit awkward due to RwLock
        // In practice, we'd use a different pattern
        None // Simplified for mock
    }

    fn is_model_loaded(&self) -> bool {
        self.loaded_model.read().is_some()
    }

    async fn text_completion(
        &self,
        input: TextCompletionInput,
    ) -> Result<TextCompletionOutput> {
        self.call_counts.write().text_completion += 1;

        if self.config.fail_text_completion {
            return Err(Error::ExecutionFailed {
                task_id: None,
                message: "Mock text completion failure".to_string(),
            });
        }

        let start = Instant::now();

        // Generate response
        let text = self.generate_response(&input);
        let completion_tokens = (text.split_whitespace().count() * 4 / 3) as u32;
        let prompt_tokens = (input.prompt.split_whitespace().count() * 4 / 3) as u32;

        // Simulate generation time
        self.simulate_latency(completion_tokens).await;

        Ok(TextCompletionOutput {
            text,
            finish_reason: FinishReason::Stop,
            usage: TokenUsage::new(prompt_tokens, completion_tokens),
            generation_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn text_completion_stream(
        &self,
        input: TextCompletionInput,
        callback: StreamCallback,
    ) -> Result<TextCompletionOutput> {
        self.call_counts.write().text_completion += 1;

        if self.config.fail_text_completion {
            return Err(Error::ExecutionFailed {
                task_id: None,
                message: "Mock text completion failure".to_string(),
            });
        }

        let start = Instant::now();
        let text = self.generate_response(&input);
        let words: Vec<&str> = text.split_whitespace().collect();

        let mut generated_text = String::new();
        let mut token_id = 0u32;

        for (i, word) in words.iter().enumerate() {
            let is_final = i == words.len() - 1;
            let token_text = if i == 0 {
                word.to_string()
            } else {
                format!(" {}", word)
            };

            generated_text.push_str(&token_text);

            let token = StreamToken {
                text: token_text,
                token_id,
                probability: Some(0.9),
                is_final,
            };

            // If callback returns false, stop generation
            if !callback(token) {
                break;
            }

            token_id += 1;

            // Simulate token latency
            if self.config.token_latency_ms > 0 {
                tokio::time::sleep(Duration::from_millis(self.config.token_latency_ms)).await;
            }
        }

        let completion_tokens = token_id;
        let prompt_tokens = (input.prompt.split_whitespace().count() * 4 / 3) as u32;

        Ok(TextCompletionOutput {
            text: generated_text,
            finish_reason: FinishReason::Stop,
            usage: TokenUsage::new(prompt_tokens, completion_tokens),
            generation_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn embeddings(&self, input: EmbeddingsInput) -> Result<EmbeddingsOutput> {
        self.call_counts.write().embeddings += 1;

        if self.config.fail_embeddings {
            return Err(Error::ExecutionFailed {
                task_id: None,
                message: "Mock embeddings failure".to_string(),
            });
        }

        let embeddings: Vec<Vec<f32>> = input
            .texts
            .iter()
            .map(|text| self.generate_embeddings(text))
            .collect();

        let total_tokens = input.texts.iter()
            .map(|t| t.split_whitespace().count())
            .sum::<usize>() as u32;

        Ok(EmbeddingsOutput {
            embeddings,
            dimensions: self.config.embedding_dims,
            usage: TokenUsage::new(total_tokens, 0),
        })
    }

    async fn classify(&self, input: ClassificationInput) -> Result<ClassificationOutput> {
        self.call_counts.write().classify += 1;

        // Generate mock predictions
        let predictions: Vec<ClassificationPrediction> = input
            .labels
            .iter()
            .enumerate()
            .map(|(i, label)| ClassificationPrediction {
                label: label.clone(),
                score: 1.0 / (i as f32 + 1.0) / input.labels.len() as f32,
            })
            .collect();

        let tokens = (input.text.split_whitespace().count() * 4 / 3) as u32;

        Ok(ClassificationOutput {
            predictions,
            usage: TokenUsage::new(tokens, 0),
        })
    }

    async fn question_answering(
        &self,
        input: QuestionAnsweringInput,
    ) -> Result<QuestionAnsweringOutput> {
        let prompt_tokens = ((input.question.len() + input.context.len()) / 4) as u32;

        Ok(QuestionAnsweringOutput {
            answer: format!("Mock answer to: {}", input.question),
            confidence: Some(0.85),
            evidence_spans: vec![],
            usage: TokenUsage::new(prompt_tokens, 20),
        })
    }

    async fn summarize(&self, input: SummarizationInput) -> Result<SummarizationOutput> {
        self.call_counts.write().summarize += 1;

        let summary = format!(
            "This is a mock summary of the input text which was {} characters long.",
            input.text.len()
        );

        let prompt_tokens = (input.text.len() / 4) as u32;
        let completion_tokens = (summary.len() / 4) as u32;

        Ok(SummarizationOutput {
            summary,
            compression_ratio: completion_tokens as f32 / prompt_tokens as f32,
            usage: TokenUsage::new(prompt_tokens, completion_tokens),
        })
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::GenerationParams;

    #[tokio::test]
    async fn test_mock_text_completion() {
        let backend = MockBackend::new();

        let input = TextCompletionInput {
            prompt: "Hello, world!".to_string(),
            system_prompt: None,
            params: GenerationParams {
                max_tokens: 50,
                ..Default::default()
            },
        };

        let result = backend.text_completion(input).await.unwrap();

        assert!(!result.text.is_empty());
        assert_eq!(result.finish_reason, FinishReason::Stop);
        assert!(result.usage.total_tokens > 0);
    }

    #[tokio::test]
    async fn test_mock_embeddings() {
        let backend = MockBackend::new();

        let input = EmbeddingsInput {
            texts: vec!["Hello".to_string(), "World".to_string()],
            normalize: true,
        };

        let result = backend.embeddings(input).await.unwrap();

        assert_eq!(result.embeddings.len(), 2);
        assert_eq!(result.dimensions, 384);

        // Check normalization
        let magnitude: f32 = result.embeddings[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((magnitude - 1.0).abs() < 0.01);
    }

    #[tokio::test]
    async fn test_mock_failure() {
        let config = MockConfig {
            fail_text_completion: true,
            ..Default::default()
        };
        let backend = MockBackend::with_config(config, BackendConfig::default());

        let input = TextCompletionInput {
            prompt: "Test".to_string(),
            system_prompt: None,
            params: GenerationParams::default(),
        };

        let result = backend.text_completion(input).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_call_counting() {
        let backend = MockBackend::new();

        let input = TextCompletionInput {
            prompt: "Test".to_string(),
            system_prompt: None,
            params: GenerationParams::default(),
        };

        let _ = backend.text_completion(input.clone()).await;
        let _ = backend.text_completion(input.clone()).await;
        let _ = backend.text_completion(input).await;

        assert_eq!(backend.call_count("text_completion"), 3);
    }

    #[tokio::test]
    async fn test_health_check() {
        let backend = MockBackend::new();
        let health = backend.health_check().await.unwrap();

        assert!(health.operational);
        assert!(!health.model_loaded);
    }

    #[test]
    fn test_capabilities() {
        let backend = MockBackend::new();
        let caps = backend.capabilities();

        assert_eq!(caps.name, "mock");
        assert!(caps.supported_tasks.contains(&TaskType::TextCompletion));
        assert!(caps.supported_tasks.contains(&TaskType::Embeddings));
        assert!(!caps.supports_training);
    }
}
