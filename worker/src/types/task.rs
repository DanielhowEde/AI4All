//! Task type definitions
//!
//! Defines all AI task types and their input/output structures.
//! These types mirror the TypeScript definitions in the coordinator.

use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────
// Task Type Enum
// ─────────────────────────────────────────────────────────────────

/// Types of AI tasks that can be executed
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskType {
    /// Text generation / completion
    TextCompletion,
    /// Generate embeddings for text
    Embeddings,
    /// Classify text into categories
    Classification,
    /// Question answering with context
    QuestionAnswering,
    /// Summarize text
    Summarization,
    /// Training batch (LoRA fine-tuning)
    TrainingBatch,
    /// Validation task (canary verification)
    Validation,
    /// Web crawl: fetch and extract text from URLs
    WebCrawl,
}

impl TaskType {
    /// Get all task types
    pub fn all() -> &'static [TaskType] {
        &[
            TaskType::TextCompletion,
            TaskType::Embeddings,
            TaskType::Classification,
            TaskType::QuestionAnswering,
            TaskType::Summarization,
            TaskType::TrainingBatch,
            TaskType::Validation,
            TaskType::WebCrawl,
        ]
    }

    /// Check if this task type requires training capability
    pub fn requires_training(&self) -> bool {
        matches!(self, TaskType::TrainingBatch)
    }

    /// Get estimated VRAM requirement in MB for a standard model
    pub fn estimated_vram_mb(&self) -> u64 {
        match self {
            TaskType::TextCompletion => 4096,
            TaskType::Embeddings => 1024,
            TaskType::Classification => 2048,
            TaskType::QuestionAnswering => 4096,
            TaskType::Summarization => 4096,
            TaskType::TrainingBatch => 8192,
            TaskType::Validation => 4096,
            TaskType::WebCrawl => 0,
        }
    }
}

impl std::fmt::Display for TaskType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskType::TextCompletion => write!(f, "text_completion"),
            TaskType::Embeddings => write!(f, "embeddings"),
            TaskType::Classification => write!(f, "classification"),
            TaskType::QuestionAnswering => write!(f, "question_answering"),
            TaskType::Summarization => write!(f, "summarization"),
            TaskType::TrainingBatch => write!(f, "training_batch"),
            TaskType::Validation => write!(f, "validation"),
            TaskType::WebCrawl => write!(f, "web_crawl"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────────

/// Token usage statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    /// Number of tokens in the prompt
    pub prompt_tokens: u32,
    /// Number of tokens generated
    pub completion_tokens: u32,
    /// Total tokens (prompt + completion)
    pub total_tokens: u32,
}

impl TokenUsage {
    pub fn new(prompt: u32, completion: u32) -> Self {
        Self {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion,
        }
    }
}

/// Reason why generation stopped
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    /// Reached max tokens limit
    Length,
    /// Hit a stop sequence or EOS token
    Stop,
    /// Content was filtered
    ContentFilter,
    /// Generation was cancelled
    Cancelled,
    /// An error occurred
    Error,
}

impl Default for FinishReason {
    fn default() -> Self {
        FinishReason::Stop
    }
}

/// Generation parameters shared across task types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationParams {
    /// Maximum tokens to generate
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,

    /// Temperature for sampling (0.0 = deterministic, 1.0+ = more random)
    #[serde(default = "default_temperature")]
    pub temperature: f32,

    /// Top-p nucleus sampling
    #[serde(default = "default_top_p")]
    pub top_p: f32,

    /// Top-k sampling (0 = disabled)
    #[serde(default)]
    pub top_k: u32,

    /// Repetition penalty (1.0 = none)
    #[serde(default = "default_repetition_penalty")]
    pub repetition_penalty: f32,

    /// Sequences that will stop generation
    #[serde(default)]
    pub stop_sequences: Vec<String>,

    /// Random seed for reproducibility (None = random)
    #[serde(default)]
    pub seed: Option<u64>,
}

fn default_max_tokens() -> u32 { 256 }
fn default_temperature() -> f32 { 0.7 }
fn default_top_p() -> f32 { 0.9 }
fn default_repetition_penalty() -> f32 { 1.1 }

impl Default for GenerationParams {
    fn default() -> Self {
        Self {
            max_tokens: default_max_tokens(),
            temperature: default_temperature(),
            top_p: default_top_p(),
            top_k: 0,
            repetition_penalty: default_repetition_penalty(),
            stop_sequences: Vec::new(),
            seed: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Text Completion
// ─────────────────────────────────────────────────────────────────

/// Input for text completion task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextCompletionInput {
    /// The prompt to complete
    pub prompt: String,

    /// Optional system prompt (for chat models)
    #[serde(default)]
    pub system_prompt: Option<String>,

    /// Generation parameters
    #[serde(flatten)]
    pub params: GenerationParams,
}

/// Output from text completion task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextCompletionOutput {
    /// The generated text
    pub text: String,

    /// Why generation stopped
    pub finish_reason: FinishReason,

    /// Token usage statistics
    pub usage: TokenUsage,

    /// Generation time in milliseconds
    #[serde(default)]
    pub generation_time_ms: u64,
}

// ─────────────────────────────────────────────────────────────────
// Embeddings
// ─────────────────────────────────────────────────────────────────

/// Input for embeddings task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingsInput {
    /// Text(s) to embed
    pub texts: Vec<String>,

    /// Whether to normalize embeddings
    #[serde(default = "default_normalize")]
    pub normalize: bool,
}

fn default_normalize() -> bool { true }

/// Output from embeddings task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingsOutput {
    /// The embedding vectors (one per input text)
    pub embeddings: Vec<Vec<f32>>,

    /// Dimension of each embedding
    pub dimensions: usize,

    /// Token usage
    pub usage: TokenUsage,
}

// ─────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────

/// Input for classification task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationInput {
    /// Text to classify
    pub text: String,

    /// Possible labels/categories
    pub labels: Vec<String>,

    /// Whether to allow multiple labels
    #[serde(default)]
    pub multi_label: bool,
}

/// A single classification prediction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationPrediction {
    /// The predicted label
    pub label: String,

    /// Confidence score (0.0 to 1.0)
    pub score: f32,
}

/// Output from classification task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationOutput {
    /// Predictions sorted by confidence (highest first)
    pub predictions: Vec<ClassificationPrediction>,

    /// Token usage
    pub usage: TokenUsage,
}

// ─────────────────────────────────────────────────────────────────
// Question Answering
// ─────────────────────────────────────────────────────────────────

/// Input for question answering task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionAnsweringInput {
    /// The question to answer
    pub question: String,

    /// Context/documents to answer from
    pub context: String,

    /// Generation parameters
    #[serde(flatten)]
    pub params: GenerationParams,
}

/// Output from question answering task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionAnsweringOutput {
    /// The answer
    pub answer: String,

    /// Confidence score (if available)
    #[serde(default)]
    pub confidence: Option<f32>,

    /// Relevant spans from context (start, end character indices)
    #[serde(default)]
    pub evidence_spans: Vec<(usize, usize)>,

    /// Token usage
    pub usage: TokenUsage,
}

// ─────────────────────────────────────────────────────────────────
// Summarization
// ─────────────────────────────────────────────────────────────────

/// Input for summarization task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizationInput {
    /// Text to summarize
    pub text: String,

    /// Target summary length (approximate tokens)
    #[serde(default = "default_summary_length")]
    pub target_length: u32,

    /// Style of summary
    #[serde(default)]
    pub style: SummarizationStyle,

    /// Generation parameters
    #[serde(flatten)]
    pub params: GenerationParams,
}

fn default_summary_length() -> u32 { 100 }

/// Style of summarization
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummarizationStyle {
    /// Brief bullet points
    Bullets,
    /// Standard paragraph summary
    #[default]
    Paragraph,
    /// Very concise (1-2 sentences)
    Tldr,
}

/// Output from summarization task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizationOutput {
    /// The summary
    pub summary: String,

    /// Compression ratio (output tokens / input tokens)
    pub compression_ratio: f32,

    /// Token usage
    pub usage: TokenUsage,
}

// ─────────────────────────────────────────────────────────────────
// Training Batch
// ─────────────────────────────────────────────────────────────────

/// Input for training batch task (LoRA fine-tuning)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingBatchInput {
    /// Training examples
    pub examples: Vec<TrainingExample>,

    /// LoRA rank
    #[serde(default = "default_lora_rank")]
    pub lora_rank: u32,

    /// Learning rate
    #[serde(default = "default_learning_rate")]
    pub learning_rate: f32,

    /// Number of epochs
    #[serde(default = "default_epochs")]
    pub epochs: u32,
}

fn default_lora_rank() -> u32 { 8 }
fn default_learning_rate() -> f32 { 1e-4 }
fn default_epochs() -> u32 { 1 }

/// A single training example
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingExample {
    /// Input text
    pub input: String,
    /// Expected output
    pub output: String,
}

/// Output from training batch task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingBatchOutput {
    /// Final training loss
    pub final_loss: f32,

    /// Loss history per epoch
    pub loss_history: Vec<f32>,

    /// LoRA weights (base64 encoded safetensors)
    #[serde(default)]
    pub lora_weights: Option<String>,

    /// Number of examples processed
    pub examples_processed: u32,
}

// ─────────────────────────────────────────────────────────────────
// Validation (Canary)
// ─────────────────────────────────────────────────────────────────

/// Input for validation/canary task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationInput {
    /// The task to validate (contains expected answer)
    pub task: ValidationTask,

    /// Expected hash of the answer
    pub expected_hash: String,
}

/// The actual validation task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ValidationTask {
    /// Text completion validation
    TextCompletion(TextCompletionInput),
    /// Embeddings validation
    Embeddings(EmbeddingsInput),
}

/// Output from validation task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationOutput {
    /// Whether the validation passed
    pub valid: bool,

    /// Hash of the produced answer
    pub answer_hash: String,

    /// The actual result (for debugging)
    #[serde(default)]
    pub result: Option<serde_json::Value>,
}

// ─────────────────────────────────────────────────────────────────
// Web Crawl
// ─────────────────────────────────────────────────────────────────

/// Input for web crawl task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebCrawlInput {
    /// Seed URL to start crawling from
    pub url: String,

    /// BFS depth: 0 = seed page only, 1 = seed + all linked pages, etc.
    #[serde(default = "default_max_depth")]
    pub max_depth: u32,

    /// Maximum total pages to fetch (safety cap)
    #[serde(default = "default_max_pages")]
    pub max_pages: u32,

    /// Whether to generate vector embeddings for each page
    #[serde(default)]
    pub generate_embeddings: bool,

    /// Restrict link-following to these domains (empty = no restriction)
    #[serde(default)]
    pub allowed_domains: Vec<String>,
}

fn default_max_depth() -> u32 { 1 }
fn default_max_pages() -> u32 { 50 }

/// A single crawled page result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawledPage {
    /// The URL that was fetched
    pub url: String,
    /// Page title (from <title> element)
    pub title: Option<String>,
    /// Extracted clean text content
    pub text: String,
    /// Vector embedding (if generate_embeddings was true)
    pub embedding: Option<Vec<f32>>,
    /// Outbound links found on the page
    pub links: Vec<String>,
    /// ISO-8601 timestamp when the page was fetched
    pub fetched_at: String,
    /// Hex SHA-256 of the extracted text (for dedup)
    pub content_hash: String,
}

/// Output from web crawl task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebCrawlOutput {
    /// All successfully crawled pages
    pub pages: Vec<CrawledPage>,
    /// Total pages fetched (including any that were empty/skipped)
    pub total_fetched: u32,
    /// Sum of all page text lengths in characters
    pub total_text_chars: u64,
    /// Non-fatal errors (e.g., individual pages that failed to fetch)
    pub errors: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────
// Unified Task Input/Output
// ─────────────────────────────────────────────────────────────────

/// Unified task input enum
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "task_type")]
pub enum TaskInput {
    #[serde(rename = "TEXT_COMPLETION")]
    TextCompletion(TextCompletionInput),
    #[serde(rename = "EMBEDDINGS")]
    Embeddings(EmbeddingsInput),
    #[serde(rename = "CLASSIFICATION")]
    Classification(ClassificationInput),
    #[serde(rename = "QUESTION_ANSWERING")]
    QuestionAnswering(QuestionAnsweringInput),
    #[serde(rename = "SUMMARIZATION")]
    Summarization(SummarizationInput),
    #[serde(rename = "TRAINING_BATCH")]
    TrainingBatch(TrainingBatchInput),
    #[serde(rename = "VALIDATION")]
    Validation(ValidationInput),
    #[serde(rename = "WEB_CRAWL")]
    WebCrawl(WebCrawlInput),
}

impl TaskInput {
    /// Get the task type
    pub fn task_type(&self) -> TaskType {
        match self {
            TaskInput::TextCompletion(_) => TaskType::TextCompletion,
            TaskInput::Embeddings(_) => TaskType::Embeddings,
            TaskInput::Classification(_) => TaskType::Classification,
            TaskInput::QuestionAnswering(_) => TaskType::QuestionAnswering,
            TaskInput::Summarization(_) => TaskType::Summarization,
            TaskInput::TrainingBatch(_) => TaskType::TrainingBatch,
            TaskInput::Validation(_) => TaskType::Validation,
            TaskInput::WebCrawl(_) => TaskType::WebCrawl,
        }
    }
}

/// Unified task output enum
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "task_type")]
pub enum TaskOutput {
    #[serde(rename = "TEXT_COMPLETION")]
    TextCompletion(TextCompletionOutput),
    #[serde(rename = "EMBEDDINGS")]
    Embeddings(EmbeddingsOutput),
    #[serde(rename = "CLASSIFICATION")]
    Classification(ClassificationOutput),
    #[serde(rename = "QUESTION_ANSWERING")]
    QuestionAnswering(QuestionAnsweringOutput),
    #[serde(rename = "SUMMARIZATION")]
    Summarization(SummarizationOutput),
    #[serde(rename = "TRAINING_BATCH")]
    TrainingBatch(TrainingBatchOutput),
    #[serde(rename = "VALIDATION")]
    Validation(ValidationOutput),
    #[serde(rename = "WEB_CRAWL")]
    WebCrawl(WebCrawlOutput),
}

impl TaskOutput {
    /// Get the task type
    pub fn task_type(&self) -> TaskType {
        match self {
            TaskOutput::TextCompletion(_) => TaskType::TextCompletion,
            TaskOutput::Embeddings(_) => TaskType::Embeddings,
            TaskOutput::Classification(_) => TaskType::Classification,
            TaskOutput::QuestionAnswering(_) => TaskType::QuestionAnswering,
            TaskOutput::Summarization(_) => TaskType::Summarization,
            TaskOutput::TrainingBatch(_) => TaskType::TrainingBatch,
            TaskOutput::Validation(_) => TaskType::Validation,
            TaskOutput::WebCrawl(_) => TaskType::WebCrawl,
        }
    }

    /// Get token usage if available
    pub fn usage(&self) -> Option<&TokenUsage> {
        match self {
            TaskOutput::TextCompletion(o) => Some(&o.usage),
            TaskOutput::Embeddings(o) => Some(&o.usage),
            TaskOutput::Classification(o) => Some(&o.usage),
            TaskOutput::QuestionAnswering(o) => Some(&o.usage),
            TaskOutput::Summarization(o) => Some(&o.usage),
            TaskOutput::TrainingBatch(_) => None,
            TaskOutput::Validation(_) => None,
            TaskOutput::WebCrawl(_) => None,
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
    fn test_task_type_display() {
        assert_eq!(TaskType::TextCompletion.to_string(), "text_completion");
        assert_eq!(TaskType::Embeddings.to_string(), "embeddings");
    }

    #[test]
    fn test_task_type_requires_training() {
        assert!(!TaskType::TextCompletion.requires_training());
        assert!(!TaskType::Embeddings.requires_training());
        assert!(TaskType::TrainingBatch.requires_training());
    }

    #[test]
    fn test_token_usage() {
        let usage = TokenUsage::new(100, 50);
        assert_eq!(usage.prompt_tokens, 100);
        assert_eq!(usage.completion_tokens, 50);
        assert_eq!(usage.total_tokens, 150);
    }

    #[test]
    fn test_generation_params_default() {
        let params = GenerationParams::default();
        assert_eq!(params.max_tokens, 256);
        assert!((params.temperature - 0.7).abs() < 0.01);
    }

    #[test]
    fn test_text_completion_input_serialize() {
        let input = TextCompletionInput {
            prompt: "Hello".to_string(),
            system_prompt: None,
            params: GenerationParams::default(),
        };

        let json = serde_json::to_string(&input).unwrap();
        assert!(json.contains("Hello"));
        assert!(json.contains("max_tokens"));
    }

    #[test]
    fn test_task_input_deserialize() {
        let json = r#"{
            "task_type": "TEXT_COMPLETION",
            "prompt": "Hello, world!",
            "max_tokens": 100
        }"#;

        let input: TaskInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.task_type(), TaskType::TextCompletion);
    }

    #[test]
    fn test_classification_input() {
        let input = ClassificationInput {
            text: "This is great!".to_string(),
            labels: vec!["positive".to_string(), "negative".to_string()],
            multi_label: false,
        };

        let json = serde_json::to_string(&input).unwrap();
        let parsed: ClassificationInput = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.labels.len(), 2);
    }

    #[test]
    fn test_embeddings_default_normalize() {
        let json = r#"{"texts": ["hello"]}"#;
        let input: EmbeddingsInput = serde_json::from_str(json).unwrap();
        assert!(input.normalize);
    }
}
