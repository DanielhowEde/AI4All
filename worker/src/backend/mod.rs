//! Backend module for AI inference
//!
//! This module provides the core abstraction for inference backends
//! and implementations for different hardware targets.

mod traits;
mod registry;
mod cpu;
mod mock;

#[cfg(feature = "gpu")]
mod vulkan;

pub use traits::*;
pub use registry::*;
pub use cpu::CpuBackend;
pub use mock::MockBackend;

#[cfg(feature = "gpu")]
pub use vulkan::{VulkanBackend, VulkanBackendConfig, create_vulkan_backend, create_vulkan_backend_for_device};
