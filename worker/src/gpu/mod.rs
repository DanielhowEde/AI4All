//! GPU detection and management module
//!
//! Provides:
//! - GPU hardware detection (vendor, VRAM, capabilities)
//! - Vulkan-based device enumeration
//! - GPU vendor identification and prioritization

mod detect;

pub use detect::*;

use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────
// GPU Vendor Identification
// ─────────────────────────────────────────────────────────────────

/// Known GPU vendors identified by PCI vendor ID
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GpuVendor {
    /// AMD (vendor ID: 0x1002)
    Amd,
    /// NVIDIA (vendor ID: 0x10DE)
    Nvidia,
    /// Intel (vendor ID: 0x8086)
    Intel,
    /// Apple (vendor ID: 0x106B)
    Apple,
    /// Unknown vendor with raw ID
    Unknown(u32),
}

impl GpuVendor {
    /// PCI Vendor ID for AMD
    pub const AMD_VENDOR_ID: u32 = 0x1002;
    /// PCI Vendor ID for NVIDIA
    pub const NVIDIA_VENDOR_ID: u32 = 0x10DE;
    /// PCI Vendor ID for Intel
    pub const INTEL_VENDOR_ID: u32 = 0x8086;
    /// PCI Vendor ID for Apple
    pub const APPLE_VENDOR_ID: u32 = 0x106B;

    /// Create GpuVendor from PCI vendor ID
    pub fn from_vendor_id(id: u32) -> Self {
        match id {
            Self::AMD_VENDOR_ID => GpuVendor::Amd,
            Self::NVIDIA_VENDOR_ID => GpuVendor::Nvidia,
            Self::INTEL_VENDOR_ID => GpuVendor::Intel,
            Self::APPLE_VENDOR_ID => GpuVendor::Apple,
            other => GpuVendor::Unknown(other),
        }
    }

    /// Get the vendor ID
    pub fn vendor_id(&self) -> u32 {
        match self {
            GpuVendor::Amd => Self::AMD_VENDOR_ID,
            GpuVendor::Nvidia => Self::NVIDIA_VENDOR_ID,
            GpuVendor::Intel => Self::INTEL_VENDOR_ID,
            GpuVendor::Apple => Self::APPLE_VENDOR_ID,
            GpuVendor::Unknown(id) => *id,
        }
    }

    /// Get the human-readable vendor name
    pub fn name(&self) -> &'static str {
        match self {
            GpuVendor::Amd => "AMD",
            GpuVendor::Nvidia => "NVIDIA",
            GpuVendor::Intel => "Intel",
            GpuVendor::Apple => "Apple",
            GpuVendor::Unknown(_) => "Unknown",
        }
    }

    /// Get priority score for vendor selection (higher = preferred)
    /// AMD is prioritized for AI4All as per project requirements
    pub fn priority(&self) -> u32 {
        match self {
            GpuVendor::Amd => 100,     // Highest priority (project preference)
            GpuVendor::Nvidia => 90,   // Second (excellent CUDA support)
            GpuVendor::Apple => 80,    // Third (Metal support)
            GpuVendor::Intel => 50,    // Fourth (integrated often)
            GpuVendor::Unknown(_) => 10,
        }
    }

    /// Check if this vendor is known/supported
    pub fn is_known(&self) -> bool {
        !matches!(self, GpuVendor::Unknown(_))
    }
}

impl std::fmt::Display for GpuVendor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

// ─────────────────────────────────────────────────────────────────
// GPU API Support
// ─────────────────────────────────────────────────────────────────

/// Graphics/Compute APIs supported by a GPU
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GpuApi {
    /// Vulkan (cross-platform)
    Vulkan,
    /// CUDA (NVIDIA only)
    Cuda,
    /// ROCm (AMD only)
    Rocm,
    /// Metal (Apple only)
    Metal,
    /// DirectX 12 (Windows)
    DirectX12,
    /// OpenCL (cross-platform)
    OpenCl,
}

impl GpuApi {
    /// Get the human-readable API name
    pub fn name(&self) -> &'static str {
        match self {
            GpuApi::Vulkan => "Vulkan",
            GpuApi::Cuda => "CUDA",
            GpuApi::Rocm => "ROCm",
            GpuApi::Metal => "Metal",
            GpuApi::DirectX12 => "DirectX 12",
            GpuApi::OpenCl => "OpenCL",
        }
    }

    /// Check if this API is typically available for a vendor
    pub fn is_available_for_vendor(&self, vendor: GpuVendor) -> bool {
        match self {
            GpuApi::Vulkan => matches!(vendor, GpuVendor::Amd | GpuVendor::Nvidia | GpuVendor::Intel),
            GpuApi::Cuda => matches!(vendor, GpuVendor::Nvidia),
            GpuApi::Rocm => matches!(vendor, GpuVendor::Amd),
            GpuApi::Metal => matches!(vendor, GpuVendor::Apple | GpuVendor::Amd | GpuVendor::Intel),
            GpuApi::DirectX12 => matches!(vendor, GpuVendor::Amd | GpuVendor::Nvidia | GpuVendor::Intel),
            GpuApi::OpenCl => true, // Generally available
        }
    }
}

impl std::fmt::Display for GpuApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

// ─────────────────────────────────────────────────────────────────
// GPU Information
// ─────────────────────────────────────────────────────────────────

/// Detailed information about a detected GPU
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    /// Device index
    pub id: u32,

    /// Device name
    pub name: String,

    /// GPU vendor
    pub vendor: GpuVendor,

    /// PCI vendor ID
    pub vendor_id: u32,

    /// PCI device ID
    pub device_id: u32,

    /// Total video memory in MB
    pub total_memory_mb: u64,

    /// Driver version string
    pub driver_version: String,

    /// Supported APIs
    pub api_support: Vec<GpuApi>,

    /// Vulkan API version (if supported)
    pub vulkan_version: Option<String>,

    /// Whether this is a discrete GPU (vs integrated)
    pub is_discrete: bool,

    /// Whether compute shaders are supported
    pub compute_capable: bool,
}

impl GpuInfo {
    /// Check if this GPU supports a specific API
    pub fn supports_api(&self, api: GpuApi) -> bool {
        self.api_support.contains(&api)
    }

    /// Get estimated tokens per second for inference
    /// Based on typical performance for the GPU class
    pub fn estimated_tokens_per_sec(&self, quantization: &str) -> u32 {
        // Very rough estimates based on GPU VRAM and vendor
        let base = match self.total_memory_mb {
            0..=4095 => 30,
            4096..=8191 => 60,
            8192..=16383 => 120,
            16384..=24575 => 180,
            _ => 250,
        };

        // Adjust for quantization (Q4 vs Q8 etc)
        let quant_factor = match quantization {
            q if q.contains("Q4") => 1.2,
            q if q.contains("Q5") => 1.0,
            q if q.contains("Q8") => 0.8,
            q if q.contains("F16") => 0.5,
            _ => 1.0,
        };

        // Adjust for vendor (historical performance data)
        let vendor_factor = match self.vendor {
            GpuVendor::Nvidia => 1.1,
            GpuVendor::Amd => 1.0,
            GpuVendor::Apple => 0.9,
            GpuVendor::Intel => 0.6,
            GpuVendor::Unknown(_) => 0.5,
        };

        (base as f64 * quant_factor * vendor_factor) as u32
    }

    /// Format a human-readable summary
    pub fn summary(&self) -> String {
        format!(
            "{} {} ({}MB) - {}",
            self.vendor,
            self.name,
            self.total_memory_mb,
            self.api_support
                .iter()
                .map(|a| a.name())
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

// ─────────────────────────────────────────────────────────────────
// GPU Selection
// ─────────────────────────────────────────────────────────────────

/// Select the best GPU from a list based on priority and capabilities
pub fn select_best_gpu(gpus: &[GpuInfo]) -> Option<&GpuInfo> {
    gpus.iter()
        .filter(|g| g.compute_capable)
        .max_by_key(|g| {
            // Priority: vendor priority + memory bonus + discrete bonus
            let vendor_score = g.vendor.priority();
            let memory_score = (g.total_memory_mb / 1024) as u32; // GB
            let discrete_bonus = if g.is_discrete { 20 } else { 0 };

            vendor_score + memory_score + discrete_bonus
        })
}

/// Select GPUs by vendor preference order
pub fn select_by_vendor_priority(gpus: &[GpuInfo], priorities: &[GpuVendor]) -> Option<&GpuInfo> {
    for vendor in priorities {
        if let Some(gpu) = gpus.iter()
            .filter(|g| g.compute_capable && g.vendor == *vendor)
            .max_by_key(|g| g.total_memory_mb)
        {
            return Some(gpu);
        }
    }
    // Fallback to best available
    select_best_gpu(gpus)
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vendor_from_id() {
        assert_eq!(GpuVendor::from_vendor_id(0x1002), GpuVendor::Amd);
        assert_eq!(GpuVendor::from_vendor_id(0x10DE), GpuVendor::Nvidia);
        assert_eq!(GpuVendor::from_vendor_id(0x8086), GpuVendor::Intel);
        assert_eq!(GpuVendor::from_vendor_id(0x106B), GpuVendor::Apple);
        assert_eq!(GpuVendor::from_vendor_id(0xFFFF), GpuVendor::Unknown(0xFFFF));
    }

    #[test]
    fn test_vendor_priority() {
        // AMD should have highest priority
        assert!(GpuVendor::Amd.priority() > GpuVendor::Nvidia.priority());
        assert!(GpuVendor::Nvidia.priority() > GpuVendor::Intel.priority());
        assert!(GpuVendor::Intel.priority() > GpuVendor::Unknown(0).priority());
    }

    #[test]
    fn test_api_availability() {
        assert!(GpuApi::Cuda.is_available_for_vendor(GpuVendor::Nvidia));
        assert!(!GpuApi::Cuda.is_available_for_vendor(GpuVendor::Amd));
        assert!(GpuApi::Rocm.is_available_for_vendor(GpuVendor::Amd));
        assert!(!GpuApi::Rocm.is_available_for_vendor(GpuVendor::Nvidia));
        assert!(GpuApi::Vulkan.is_available_for_vendor(GpuVendor::Amd));
        assert!(GpuApi::Vulkan.is_available_for_vendor(GpuVendor::Nvidia));
    }

    #[test]
    fn test_select_best_gpu() {
        let gpus = vec![
            GpuInfo {
                id: 0,
                name: "Intel UHD".to_string(),
                vendor: GpuVendor::Intel,
                vendor_id: 0x8086,
                device_id: 0x1234,
                total_memory_mb: 2048,
                driver_version: "1.0".to_string(),
                api_support: vec![GpuApi::Vulkan],
                vulkan_version: Some("1.2".to_string()),
                is_discrete: false,
                compute_capable: true,
            },
            GpuInfo {
                id: 1,
                name: "AMD RX 7900".to_string(),
                vendor: GpuVendor::Amd,
                vendor_id: 0x1002,
                device_id: 0x5678,
                total_memory_mb: 24576,
                driver_version: "23.10".to_string(),
                api_support: vec![GpuApi::Vulkan, GpuApi::Rocm],
                vulkan_version: Some("1.3".to_string()),
                is_discrete: true,
                compute_capable: true,
            },
        ];

        let best = select_best_gpu(&gpus).unwrap();
        assert_eq!(best.vendor, GpuVendor::Amd);
    }

    #[test]
    fn test_gpu_summary() {
        let gpu = GpuInfo {
            id: 0,
            name: "RX 7900 XTX".to_string(),
            vendor: GpuVendor::Amd,
            vendor_id: 0x1002,
            device_id: 0x1234,
            total_memory_mb: 24576,
            driver_version: "23.10".to_string(),
            api_support: vec![GpuApi::Vulkan, GpuApi::Rocm],
            vulkan_version: Some("1.3".to_string()),
            is_discrete: true,
            compute_capable: true,
        };

        let summary = gpu.summary();
        assert!(summary.contains("AMD"));
        assert!(summary.contains("RX 7900 XTX"));
        assert!(summary.contains("24576"));
    }
}
