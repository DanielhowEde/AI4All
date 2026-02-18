//! OpenAI-compatible API backend
//!
//! Implements InferenceBackend by making HTTP calls to any OpenAI-compatible
//! API endpoint (OpenAI, Ollama, vLLM, LM Studio, etc.).

use async_trait::async_trait;
use parking_lot::RwLock;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

use crate::error::{Error, Result};
use crate::types::{
    EmbeddingsInput, EmbeddingsOutput,
    FinishReason, GgufMetadata, LoadedModelInfo, ModelFormat, ModelSpec,
    QuestionAnsweringInput, QuestionAnsweringOutput,
    SummarizationInput, SummarizationOutput,
    TaskType, TextCompletionInput, TextCompletionOutput, TokenUsage,
};

use super::{
    BackendCapabilities, BackendHealth, InferenceBackend,
    ResourceUsage,
};

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for OpenAI-compatible API backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAiConfig {
    /// API base URL (e.g., "https://api.openai.com/v1", "http://localhost:11434/v1")
    pub base_url: String,

    /// API key (empty string for local servers like Ollama)
    pub api_key: String,

    /// Default model to use (e.g., "gpt-4o", "llama3")
    pub default_model: String,

    /// Request timeout in seconds
    pub timeout_secs: u64,

    /// Maximum retries on transient errors
    pub max_retries: u32,
}

impl Default for OpenAiConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434/v1".to_string(),
            api_key: String::new(),
            default_model: "llama3".to_string(),
            timeout_secs: 120,
            max_retries: 2,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// OpenAI API types (request/response)
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    usage: Option<ApiUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

#[derive(Debug, Serialize)]
struct EmbeddingsApiRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingsApiResponse {
    data: Vec<EmbeddingData>,
    usage: Option<ApiUsage>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

// ─────────────────────────────────────────────────────────────────
// OpenAI Backend
// ─────────────────────────────────────────────────────────────────

/// OpenAI-compatible API backend for inference
pub struct OpenAiBackend {
    config: OpenAiConfig,
    client: Client,
    model_id: RwLock<String>,
    total_requests: RwLock<u64>,
    total_tokens: RwLock<u64>,
}

impl OpenAiBackend {
    /// Create a new OpenAI backend with the given configuration
    pub fn new(config: OpenAiConfig) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .expect("Failed to create HTTP client");

        let model_id = config.default_model.clone();

        info!(
            base_url = %config.base_url,
            model = %model_id,
            "OpenAI-compatible backend created"
        );

        Self {
            config,
            client,
            model_id: RwLock::new(model_id),
            total_requests: RwLock::new(0),
            total_tokens: RwLock::new(0),
        }
    }

    /// Build the authorization header value (if API key is set)
    fn auth_header(&self) -> Option<String> {
        if self.config.api_key.is_empty() {
            None
        } else {
            Some(format!("Bearer {}", self.config.api_key))
        }
    }

    /// Make a chat completion request with retry logic
    async fn chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
        top_p: Option<f32>,
        stop: Option<Vec<String>>,
        seed: Option<u64>,
    ) -> Result<(String, FinishReason, TokenUsage)> {
        let model_id = self.model_id.read().clone();

        let request_body = ChatCompletionRequest {
            model: model_id.clone(),
            messages,
            max_tokens,
            temperature,
            top_p,
            stop,
            seed,
        };

        let url = format!("{}/chat/completions", self.config.base_url);
        let mut last_error: Option<Error> = None;

        for attempt in 0..=self.config.max_retries {
            if attempt > 0 {
                let backoff = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                debug!(attempt, ?backoff, "Retrying after error");
                tokio::time::sleep(backoff).await;
            }

            let mut req = self.client.post(&url).json(&request_body);
            if let Some(ref auth) = self.auth_header() {
                req = req.header("Authorization", auth);
            }

            match req.send().await {
                Ok(response) => {
                    let status = response.status();

                    if status.is_success() {
                        match response.json::<ChatCompletionResponse>().await {
                            Ok(parsed) => {
                                *self.total_requests.write() += 1;

                                let choice = parsed.choices.first().ok_or_else(|| {
                                    Error::ExecutionFailed {
                                        task_id: None,
                                        message: "No choices in API response".to_string(),
                                    }
                                })?;

                                let text = choice.message.content.clone().unwrap_or_default();
                                let finish_reason = match choice.finish_reason.as_deref() {
                                    Some("stop") => FinishReason::Stop,
                                    Some("length") => FinishReason::Length,
                                    Some("content_filter") => FinishReason::ContentFilter,
                                    _ => FinishReason::Stop,
                                };

                                let usage = if let Some(u) = parsed.usage {
                                    *self.total_tokens.write() += u.total_tokens as u64;
                                    TokenUsage::new(u.prompt_tokens, u.completion_tokens)
                                } else {
                                    TokenUsage::new(0, 0)
                                };

                                return Ok((text, finish_reason, usage));
                            }
                            Err(e) => {
                                last_error = Some(Error::ExecutionFailed {
                                    task_id: None,
                                    message: format!("Failed to parse API response: {}", e),
                                });
                            }
                        }
                    } else if status.as_u16() == 429 || status.is_server_error() {
                        // Retryable error
                        let body = response.text().await.unwrap_or_default();
                        warn!(status = %status, attempt, "Retryable API error: {}", body);
                        last_error = Some(Error::ExecutionFailed {
                            task_id: None,
                            message: format!("API error {}: {}", status, body),
                        });
                    } else {
                        // Non-retryable error
                        let body = response.text().await.unwrap_or_default();
                        return Err(Error::ExecutionFailed {
                            task_id: None,
                            message: format!("API error {}: {}", status, body),
                        });
                    }
                }
                Err(e) => {
                    if e.is_timeout() || e.is_connect() {
                        warn!(attempt, error = %e, "Retryable connection error");
                        last_error = Some(Error::ExecutionFailed {
                            task_id: None,
                            message: format!("Connection error: {}", e),
                        });
                    } else {
                        return Err(Error::ExecutionFailed {
                            task_id: None,
                            message: format!("Request error: {}", e),
                        });
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| Error::ExecutionFailed {
            task_id: None,
            message: "All retry attempts exhausted".to_string(),
        }))
    }
}

#[async_trait]
impl InferenceBackend for OpenAiBackend {
    fn name(&self) -> &'static str {
        "openai"
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            name: "openai",
            supported_tasks: vec![
                TaskType::TextCompletion,
                TaskType::Embeddings,
                TaskType::QuestionAnswering,
                TaskType::Summarization,
            ],
            supports_training: false,
            supports_streaming: false, // TODO: add SSE streaming later
            max_context_length: 128_000,
            max_batch_size: 1,
            gpu_available: false,
            gpu_device: None,
        }
    }

    async fn health_check(&self) -> Result<BackendHealth> {
        let url = format!("{}/models", self.config.base_url);
        let mut req = self.client.get(&url);
        if let Some(ref auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }

        match req.send().await {
            Ok(resp) if resp.status().is_success() => Ok(BackendHealth {
                operational: true,
                model_loaded: true,
                memory_used_mb: 0,
                gpu_memory_used_mb: None,
                error: None,
            }),
            Ok(resp) => Ok(BackendHealth {
                operational: false,
                model_loaded: false,
                memory_used_mb: 0,
                gpu_memory_used_mb: None,
                error: Some(format!("API returned status {}", resp.status())),
            }),
            Err(e) => Ok(BackendHealth {
                operational: false,
                model_loaded: false,
                memory_used_mb: 0,
                gpu_memory_used_mb: None,
                error: Some(format!("Connection failed: {}", e)),
            }),
        }
    }

    fn resource_usage(&self) -> ResourceUsage {
        ResourceUsage {
            cpu_percent: 1.0, // Minimal - just HTTP calls
            memory_mb: 10,
            gpu_percent: None,
            gpu_memory_mb: None,
            active_threads: 1,
        }
    }

    async fn load_model(&mut self, spec: &ModelSpec) -> Result<LoadedModelInfo> {
        // For API backends, "loading" just means switching the model string
        *self.model_id.write() = spec.id.clone();
        info!(model = %spec.id, "Switched to model (API backend)");

        Ok(LoadedModelInfo {
            spec: spec.clone(),
            metadata: GgufMetadata {
                name: Some(spec.name.clone()),
                ..Default::default()
            },
            memory_used_mb: 0,
            load_time_ms: 0,
            ready: true,
        })
    }

    async fn load_model_from_path(&mut self, path: &Path) -> Result<LoadedModelInfo> {
        let model_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let spec = ModelSpec {
            id: model_id.clone(),
            name: model_id,
            family: None,
            path: path.to_path_buf(),
            format: ModelFormat::Gguf,
            quantization: None,
            parameters_b: None,
            context_length: 128_000,
            vocab_size: None,
            embedding_dim: None,
            num_layers: None,
            num_heads: None,
            file_size: 0,
            sha256: None,
        };

        self.load_model(&spec).await
    }

    async fn unload_model(&mut self) -> Result<()> {
        *self.model_id.write() = self.config.default_model.clone();
        Ok(())
    }

    fn loaded_model(&self) -> Option<&LoadedModelInfo> {
        None // API backends don't hold a model in memory
    }

    fn is_model_loaded(&self) -> bool {
        true // API is always "ready" — model lives on the server
    }

    async fn text_completion(
        &self,
        input: TextCompletionInput,
    ) -> Result<TextCompletionOutput> {
        let start = Instant::now();

        let mut messages = Vec::new();
        if let Some(ref system) = input.system_prompt {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: system.clone(),
            });
        }
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: input.prompt,
        });

        let stop = if input.params.stop_sequences.is_empty() {
            None
        } else {
            Some(input.params.stop_sequences.clone())
        };

        let (text, finish_reason, usage) = self
            .chat_completion(
                messages,
                Some(input.params.max_tokens),
                Some(input.params.temperature),
                Some(input.params.top_p),
                stop,
                input.params.seed,
            )
            .await?;

        Ok(TextCompletionOutput {
            text,
            finish_reason,
            usage,
            generation_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn embeddings(&self, input: EmbeddingsInput) -> Result<EmbeddingsOutput> {
        let model_id = self.model_id.read().clone();
        let url = format!("{}/embeddings", self.config.base_url);

        let request_body = EmbeddingsApiRequest {
            model: model_id,
            input: input.texts.clone(),
        };

        let mut req = self.client.post(&url).json(&request_body);
        if let Some(ref auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }

        let response = req.send().await.map_err(|e| Error::ExecutionFailed {
            task_id: None,
            message: format!("Embeddings request failed: {}", e),
        })?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(Error::ExecutionFailed {
                task_id: None,
                message: format!("Embeddings API error: {}", body),
            });
        }

        let parsed: EmbeddingsApiResponse =
            response.json().await.map_err(|e| Error::ExecutionFailed {
                task_id: None,
                message: format!("Failed to parse embeddings response: {}", e),
            })?;

        let dimensions = parsed
            .data
            .first()
            .map(|d| d.embedding.len())
            .unwrap_or(0);

        let embeddings: Vec<Vec<f32>> = parsed.data.into_iter().map(|d| d.embedding).collect();

        let usage = parsed
            .usage
            .map(|u| TokenUsage::new(u.prompt_tokens, 0))
            .unwrap_or_else(|| TokenUsage::new(0, 0));

        *self.total_requests.write() += 1;

        Ok(EmbeddingsOutput {
            embeddings,
            dimensions,
            usage,
        })
    }

    async fn question_answering(
        &self,
        input: QuestionAnsweringInput,
    ) -> Result<QuestionAnsweringOutput> {
        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: "Answer the question based on the provided context. Be concise and accurate.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: format!(
                    "Context:\n{}\n\nQuestion: {}",
                    input.context, input.question
                ),
            },
        ];

        let (text, _finish_reason, usage) = self
            .chat_completion(
                messages,
                Some(input.params.max_tokens),
                Some(input.params.temperature),
                None,
                None,
                input.params.seed,
            )
            .await?;

        Ok(QuestionAnsweringOutput {
            answer: text,
            confidence: None,
            evidence_spans: vec![],
            usage,
        })
    }

    async fn summarize(&self, input: SummarizationInput) -> Result<SummarizationOutput> {
        let style_instruction = match input.style {
            crate::types::SummarizationStyle::Paragraph => "Provide a paragraph summary.",
            crate::types::SummarizationStyle::Bullets => {
                "Provide a bullet-point summary."
            }
            crate::types::SummarizationStyle::Tldr => {
                "Provide a very concise 1-2 sentence summary."
            }
        };

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: format!(
                    "Summarize the following text in approximately {} words. {}",
                    input.target_length, style_instruction
                ),
            },
            ChatMessage {
                role: "user".to_string(),
                content: input.text.clone(),
            },
        ];

        let (summary, _finish_reason, usage) = self
            .chat_completion(
                messages,
                Some(input.params.max_tokens),
                Some(input.params.temperature),
                None,
                None,
                input.params.seed,
            )
            .await?;

        let input_tokens = usage.prompt_tokens;
        let output_tokens = usage.completion_tokens;
        let compression_ratio = if input_tokens > 0 {
            output_tokens as f32 / input_tokens as f32
        } else {
            0.0
        };

        Ok(SummarizationOutput {
            summary,
            compression_ratio,
            usage,
        })
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = OpenAiConfig::default();
        assert_eq!(config.base_url, "http://localhost:11434/v1");
        assert!(config.api_key.is_empty());
        assert_eq!(config.default_model, "llama3");
        assert_eq!(config.timeout_secs, 120);
        assert_eq!(config.max_retries, 2);
    }

    #[test]
    fn test_backend_name() {
        let backend = OpenAiBackend::new(OpenAiConfig::default());
        assert_eq!(backend.name(), "openai");
    }

    #[test]
    fn test_capabilities() {
        let backend = OpenAiBackend::new(OpenAiConfig::default());
        let caps = backend.capabilities();

        assert_eq!(caps.name, "openai");
        assert!(caps.supported_tasks.contains(&TaskType::TextCompletion));
        assert!(caps.supported_tasks.contains(&TaskType::Embeddings));
        assert!(caps.supported_tasks.contains(&TaskType::QuestionAnswering));
        assert!(caps.supported_tasks.contains(&TaskType::Summarization));
        assert!(!caps.supports_training);
    }

    #[test]
    fn test_auth_header() {
        let config = OpenAiConfig {
            api_key: "sk-test-123".to_string(),
            ..Default::default()
        };
        let backend = OpenAiBackend::new(config);
        assert_eq!(backend.auth_header(), Some("Bearer sk-test-123".to_string()));

        let no_key = OpenAiBackend::new(OpenAiConfig::default());
        assert_eq!(no_key.auth_header(), None);
    }

    #[test]
    fn test_is_model_loaded() {
        let backend = OpenAiBackend::new(OpenAiConfig::default());
        assert!(backend.is_model_loaded()); // Always true for API backends
    }
}
