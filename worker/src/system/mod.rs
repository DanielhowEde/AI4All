//! System module for health monitoring and benchmarking
//!
//! Provides:
//! - Resource usage monitoring (CPU, memory, GPU)
//! - System capability detection
//! - Performance benchmarking
//! - First-run experience

mod health;
mod benchmark;

pub use health::*;
pub use benchmark::*;
