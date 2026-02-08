//! Model type definitions
//!
//! Defines model specifications, capabilities, and metadata.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ─────────────────────────────────────────────────────────────────
// Model Format
// ─────────────────────────────────────────────────────────────────

/// Supported model file formats
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelFormat {
    /// GGUF format (llama.cpp native)
    Gguf,
    /// GGML format (legacy)
    Ggml,
    /// SafeTensors format
    SafeTensors,
    /// PyTorch format
    Pytorch,
}

impl ModelFormat {
    /// Get the file extension for this format
    pub fn extension(&self) -> &'static str {
        match self {
            ModelFormat::Gguf => "gguf",
            ModelFormat::Ggml => "ggml",
            ModelFormat::SafeTensors => "safetensors",
            ModelFormat::Pytorch => "pt",
        }
    }

    /// Detect format from file path
    pub fn from_path(path: &std::path::Path) -> Option<Self> {
        path.extension()
            .and_then(|ext| ext.to_str())
            .and_then(|ext| match ext.to_lowercase().as_str() {
                "gguf" => Some(ModelFormat::Gguf),
                "ggml" | "bin" => Some(ModelFormat::Ggml),
                "safetensors" => Some(ModelFormat::SafeTensors),
                "pt" | "pth" => Some(ModelFormat::Pytorch),
                _ => None,
            })
    }
}

// ─────────────────────────────────────────────────────────────────
// Quantization
// ─────────────────────────────────────────────────────────────────

/// Quantization type for GGUF models
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum QuantizationType {
    /// Full precision (F32)
    F32,
    /// Half precision (F16)
    F16,
    /// 8-bit quantization
    Q8_0,
    /// 6-bit quantization
    Q6_K,
    /// 5-bit quantization (K-quants)
    Q5_K_M,
    Q5_K_S,
    /// 4-bit quantization (K-quants)
    Q4_K_M,
    Q4_K_S,
    /// 4-bit quantization (legacy)
    Q4_0,
    Q4_1,
    /// 3-bit quantization
    Q3_K_M,
    Q3_K_S,
    Q3_K_L,
    /// 2-bit quantization
    Q2_K,
    /// Integer quantization
    IQ4_NL,
    IQ4_XS,
    IQ3_XXS,
    IQ2_XXS,
    /// Unknown quantization
    Unknown,
}

impl QuantizationType {
    /// Get approximate bits per weight
    pub fn bits_per_weight(&self) -> f32 {
        match self {
            QuantizationType::F32 => 32.0,
            QuantizationType::F16 => 16.0,
            QuantizationType::Q8_0 => 8.0,
            QuantizationType::Q6_K => 6.5,
            QuantizationType::Q5_K_M | QuantizationType::Q5_K_S => 5.5,
            QuantizationType::Q4_K_M | QuantizationType::Q4_K_S => 4.5,
            QuantizationType::Q4_0 | QuantizationType::Q4_1 => 4.0,
            QuantizationType::Q3_K_M | QuantizationType::Q3_K_S | QuantizationType::Q3_K_L => 3.5,
            QuantizationType::Q2_K => 2.5,
            QuantizationType::IQ4_NL | QuantizationType::IQ4_XS => 4.0,
            QuantizationType::IQ3_XXS => 3.0,
            QuantizationType::IQ2_XXS => 2.0,
            QuantizationType::Unknown => 4.0, // Assume 4-bit
        }
    }

    /// Parse from string (from GGUF metadata)
    pub fn from_str(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "F32" => QuantizationType::F32,
            "F16" => QuantizationType::F16,
            "Q8_0" => QuantizationType::Q8_0,
            "Q6_K" => QuantizationType::Q6_K,
            "Q5_K_M" => QuantizationType::Q5_K_M,
            "Q5_K_S" => QuantizationType::Q5_K_S,
            "Q4_K_M" => QuantizationType::Q4_K_M,
            "Q4_K_S" => QuantizationType::Q4_K_S,
            "Q4_0" => QuantizationType::Q4_0,
            "Q4_1" => QuantizationType::Q4_1,
            "Q3_K_M" => QuantizationType::Q3_K_M,
            "Q3_K_S" => QuantizationType::Q3_K_S,
            "Q3_K_L" => QuantizationType::Q3_K_L,
            "Q2_K" => QuantizationType::Q2_K,
            "IQ4_NL" => QuantizationType::IQ4_NL,
            "IQ4_XS" => QuantizationType::IQ4_XS,
            "IQ3_XXS" => QuantizationType::IQ3_XXS,
            "IQ2_XXS" => QuantizationType::IQ2_XXS,
            _ => QuantizationType::Unknown,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Model Specification
// ─────────────────────────────────────────────────────────────────

/// Specification for a model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpec {
    /// Unique model identifier
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Model family (e.g., "llama", "mistral", "phi")
    #[serde(default)]
    pub family: Option<String>,

    /// Model file path
    pub path: PathBuf,

    /// Model format
    pub format: ModelFormat,

    /// Quantization type (if applicable)
    #[serde(default)]
    pub quantization: Option<QuantizationType>,

    /// Number of parameters (billions)
    #[serde(default)]
    pub parameters_b: Option<f32>,

    /// Context length
    #[serde(default = "default_context_length")]
    pub context_length: u32,

    /// Vocabulary size
    #[serde(default)]
    pub vocab_size: Option<u32>,

    /// Embedding dimensions
    #[serde(default)]
    pub embedding_dim: Option<u32>,

    /// Number of layers
    #[serde(default)]
    pub num_layers: Option<u32>,

    /// Number of attention heads
    #[serde(default)]
    pub num_heads: Option<u32>,

    /// File size in bytes
    #[serde(default)]
    pub file_size: u64,

    /// SHA256 hash of the model file
    #[serde(default)]
    pub sha256: Option<String>,
}

fn default_context_length() -> u32 { 4096 }

impl ModelSpec {
    /// Estimate VRAM required to load this model (in MB)
    pub fn estimated_vram_mb(&self) -> u64 {
        if let (Some(params), Some(quant)) = (self.parameters_b, &self.quantization) {
            // Rough estimate: params * bits_per_weight / 8 * 1.2 (overhead)
            let bytes = (params * 1e9 * quant.bits_per_weight() / 8.0 * 1.2) as u64;
            bytes / (1024 * 1024)
        } else {
            // Fall back to file size as estimate
            self.file_size / (1024 * 1024)
        }
    }

    /// Check if this model supports the given context length
    pub fn supports_context(&self, context: u32) -> bool {
        context <= self.context_length
    }
}

// ─────────────────────────────────────────────────────────────────
// Model Metadata (from GGUF)
// ─────────────────────────────────────────────────────────────────

/// Metadata extracted from a GGUF model file
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GgufMetadata {
    /// General architecture
    #[serde(default)]
    pub architecture: Option<String>,

    /// Model name from metadata
    #[serde(default)]
    pub name: Option<String>,

    /// Author
    #[serde(default)]
    pub author: Option<String>,

    /// License
    #[serde(default)]
    pub license: Option<String>,

    /// Description
    #[serde(default)]
    pub description: Option<String>,

    /// Quantization type
    #[serde(default)]
    pub quantization: Option<String>,

    /// Context length
    #[serde(default)]
    pub context_length: Option<u32>,

    /// Embedding length
    #[serde(default)]
    pub embedding_length: Option<u32>,

    /// Number of attention heads
    #[serde(default)]
    pub head_count: Option<u32>,

    /// Number of layers
    #[serde(default)]
    pub block_count: Option<u32>,

    /// Vocabulary size
    #[serde(default)]
    pub vocab_size: Option<u32>,

    /// BOS token ID
    #[serde(default)]
    pub bos_token_id: Option<u32>,

    /// EOS token ID
    #[serde(default)]
    pub eos_token_id: Option<u32>,

    /// Chat template (jinja2)
    #[serde(default)]
    pub chat_template: Option<String>,
}

// ─────────────────────────────────────────────────────────────────
// Loaded Model Info
// ─────────────────────────────────────────────────────────────────

/// Information about a currently loaded model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedModelInfo {
    /// Model specification
    pub spec: ModelSpec,

    /// GGUF metadata (if available)
    #[serde(default)]
    pub metadata: GgufMetadata,

    /// Actual memory used (MB)
    pub memory_used_mb: u64,

    /// Time taken to load (ms)
    pub load_time_ms: u64,

    /// Whether model is ready for inference
    pub ready: bool,
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_format_extension() {
        assert_eq!(ModelFormat::Gguf.extension(), "gguf");
        assert_eq!(ModelFormat::SafeTensors.extension(), "safetensors");
    }

    #[test]
    fn test_model_format_from_path() {
        let path = std::path::Path::new("/models/llama-7b.gguf");
        assert_eq!(ModelFormat::from_path(path), Some(ModelFormat::Gguf));

        let path = std::path::Path::new("/models/model.safetensors");
        assert_eq!(ModelFormat::from_path(path), Some(ModelFormat::SafeTensors));
    }

    #[test]
    fn test_quantization_bits() {
        assert!((QuantizationType::Q4_K_M.bits_per_weight() - 4.5).abs() < 0.1);
        assert!((QuantizationType::Q8_0.bits_per_weight() - 8.0).abs() < 0.1);
    }

    #[test]
    fn test_quantization_from_str() {
        assert_eq!(QuantizationType::from_str("Q4_K_M"), QuantizationType::Q4_K_M);
        assert_eq!(QuantizationType::from_str("q8_0"), QuantizationType::Q8_0);
        assert_eq!(QuantizationType::from_str("unknown"), QuantizationType::Unknown);
    }

    #[test]
    fn test_model_spec_vram_estimate() {
        let spec = ModelSpec {
            id: "test".to_string(),
            name: "Test Model".to_string(),
            family: Some("llama".to_string()),
            path: PathBuf::from("/test.gguf"),
            format: ModelFormat::Gguf,
            quantization: Some(QuantizationType::Q4_K_M),
            parameters_b: Some(7.0),
            context_length: 4096,
            vocab_size: Some(32000),
            embedding_dim: Some(4096),
            num_layers: Some(32),
            num_heads: Some(32),
            file_size: 4_000_000_000,
            sha256: None,
        };

        let vram = spec.estimated_vram_mb();
        // 7B * 4.5 bits / 8 * 1.2 ≈ 4.7GB ≈ 4700MB
        assert!(vram > 4000 && vram < 6000, "Expected ~4700MB, got {}", vram);
    }
}
