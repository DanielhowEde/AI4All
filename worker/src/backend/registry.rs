//! Backend Registry
//!
//! Manages available backends and provides dynamic backend selection.

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use tokio::sync::RwLock as TokioRwLock;

use crate::error::{Error, Result};
use crate::types::TaskType;

use super::{BackendCapabilities, BackendConfig, CpuBackend, InferenceBackend, MockBackend, OpenAiBackend, OpenAiConfig};

// ─────────────────────────────────────────────────────────────────
// Backend Type
// ─────────────────────────────────────────────────────────────────

/// Supported backend types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BackendType {
    /// CPU-only backend (llama.cpp)
    Cpu,
    /// NVIDIA CUDA backend
    Cuda,
    /// AMD ROCm backend
    Rocm,
    /// Vulkan backend (cross-vendor GPU)
    Vulkan,
    /// OpenAI-compatible API backend
    OpenAi,
    /// Mock backend (for testing)
    Mock,
    /// Web crawler backend (handles WEB_CRAWL tasks)
    Crawler,
}

impl BackendType {
    /// Get all backend types
    pub fn all() -> &'static [BackendType] {
        &[
            BackendType::Cpu,
            BackendType::Cuda,
            BackendType::Rocm,
            BackendType::Vulkan,
            BackendType::OpenAi,
            BackendType::Mock,
            BackendType::Crawler,
        ]
    }

    /// Get the backend name
    pub fn name(&self) -> &'static str {
        match self {
            BackendType::Cpu => "cpu",
            BackendType::Cuda => "cuda",
            BackendType::Rocm => "rocm",
            BackendType::Vulkan => "vulkan",
            BackendType::OpenAi => "openai",
            BackendType::Mock => "mock",
            BackendType::Crawler => "crawler",
        }
    }

    /// Check if this backend type is available
    pub fn is_available(&self) -> bool {
        match self {
            BackendType::Cpu => true,
            BackendType::Cuda => cfg!(feature = "cuda"),
            BackendType::Rocm => cfg!(feature = "rocm"),
            BackendType::Vulkan => cfg!(feature = "vulkan"),
            BackendType::OpenAi => true,
            BackendType::Mock => true,
            BackendType::Crawler => true,
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "cpu" => Some(BackendType::Cpu),
            "cuda" => Some(BackendType::Cuda),
            "rocm" => Some(BackendType::Rocm),
            "vulkan" => Some(BackendType::Vulkan),
            "openai" => Some(BackendType::OpenAi),
            "mock" => Some(BackendType::Mock),
            "crawler" => Some(BackendType::Crawler),
            _ => None,
        }
    }
}

impl std::fmt::Display for BackendType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

// ─────────────────────────────────────────────────────────────────
// Backend Factory
// ─────────────────────────────────────────────────────────────────

/// Factory for creating backends
pub struct BackendFactory;

impl BackendFactory {
    /// Create a backend of the specified type
    pub fn create(
        backend_type: BackendType,
        config: BackendConfig,
    ) -> Result<Box<dyn InferenceBackend>> {
        match backend_type {
            BackendType::Cpu => {
                Ok(Box::new(CpuBackend::from_config(config)))
            }
            BackendType::Cuda => {
                #[cfg(feature = "cuda")]
                {
                    // TODO: Implement CUDA backend
                    Err(Error::NotSupported("CUDA backend not yet implemented".to_string()))
                }
                #[cfg(not(feature = "cuda"))]
                {
                    Err(Error::NotSupported(
                        "CUDA backend requires 'cuda' feature".to_string()
                    ))
                }
            }
            BackendType::Rocm => {
                #[cfg(feature = "rocm")]
                {
                    // TODO: Implement ROCm backend
                    Err(Error::NotSupported("ROCm backend not yet implemented".to_string()))
                }
                #[cfg(not(feature = "rocm"))]
                {
                    Err(Error::NotSupported(
                        "ROCm backend requires 'rocm' feature".to_string()
                    ))
                }
            }
            BackendType::Vulkan => {
                #[cfg(feature = "vulkan")]
                {
                    // TODO: Implement Vulkan backend
                    Err(Error::NotSupported("Vulkan backend not yet implemented".to_string()))
                }
                #[cfg(not(feature = "vulkan"))]
                {
                    Err(Error::NotSupported(
                        "Vulkan backend requires 'vulkan' feature".to_string()
                    ))
                }
            }
            BackendType::OpenAi => {
                let openai_config = config.openai.clone().unwrap_or_default();
                Ok(Box::new(OpenAiBackend::new(openai_config)))
            }
            BackendType::Mock => {
                Ok(Box::new(MockBackend::new()))
            }
            BackendType::Crawler => {
                Err(Error::NotSupported(
                    "Use BackendRegistry::register_boxed to register the CrawlerBackend".to_string()
                ))
            }
        }
    }

    /// Get available backend types
    pub fn available_backends() -> Vec<BackendType> {
        BackendType::all()
            .iter()
            .filter(|t| t.is_available())
            .copied()
            .collect()
    }

    /// Detect the best available backend
    pub fn detect_best_backend() -> BackendType {
        // Priority: CUDA > ROCm > Vulkan > CPU
        if BackendType::Cuda.is_available() {
            // TODO: Actually check for CUDA device
            // BackendType::Cuda
            BackendType::Cpu // Fall back to CPU for now
        } else if BackendType::Rocm.is_available() {
            // TODO: Actually check for ROCm device
            // BackendType::Rocm
            BackendType::Cpu
        } else if BackendType::Vulkan.is_available() {
            // TODO: Actually check for Vulkan device
            // BackendType::Vulkan
            BackendType::Cpu
        } else {
            BackendType::Cpu
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Backend Registry
// ─────────────────────────────────────────────────────────────────

/// Registry for managing multiple backends
///
/// Uses `tokio::sync::RwLock` for inner backend storage to support async operations.
pub struct BackendRegistry {
    backends: RwLock<HashMap<BackendType, Arc<TokioRwLock<Box<dyn InferenceBackend>>>>>,
    default_backend: RwLock<Option<BackendType>>,
}

impl BackendRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        Self {
            backends: RwLock::new(HashMap::new()),
            default_backend: RwLock::new(None),
        }
    }

    /// Create a registry with the best available backend
    pub fn with_default() -> Result<Self> {
        let registry = Self::new();
        let backend_type = BackendFactory::detect_best_backend();
        registry.register(backend_type, BackendConfig::default())?;
        registry.set_default(backend_type);
        Ok(registry)
    }

    /// Register a backend
    pub fn register(&self, backend_type: BackendType, config: BackendConfig) -> Result<()> {
        let backend = BackendFactory::create(backend_type, config)?;
        let mut backends = self.backends.write();
        backends.insert(backend_type, Arc::new(TokioRwLock::new(backend)));

        tracing::info!(
            backend = %backend_type,
            "Backend registered"
        );

        // Set as default if no default exists
        if self.default_backend.read().is_none() {
            *self.default_backend.write() = Some(backend_type);
        }

        Ok(())
    }

    /// Register a pre-built backend instance (bypasses BackendFactory).
    ///
    /// Use this for backends that require constructor arguments not captured
    /// in `BackendConfig` (e.g., `CrawlerBackend`).
    pub fn register_boxed(&self, backend_type: BackendType, backend: Box<dyn InferenceBackend>) {
        let mut backends = self.backends.write();
        backends.insert(backend_type, Arc::new(TokioRwLock::new(backend)));

        tracing::info!(
            backend = %backend_type,
            "Backend registered (boxed)"
        );

        if self.default_backend.read().is_none() {
            *self.default_backend.write() = Some(backend_type);
        }
    }

    /// Unregister a backend
    pub fn unregister(&self, backend_type: BackendType) {
        let mut backends = self.backends.write();
        backends.remove(&backend_type);

        // Clear default if it was the unregistered backend
        let mut default = self.default_backend.write();
        if *default == Some(backend_type) {
            *default = backends.keys().next().copied();
        }
    }

    /// Get a backend by type
    pub fn get(&self, backend_type: BackendType) -> Option<Arc<TokioRwLock<Box<dyn InferenceBackend>>>> {
        self.backends.read().get(&backend_type).cloned()
    }

    /// Get the default backend
    pub fn default_backend(&self) -> Option<Arc<TokioRwLock<Box<dyn InferenceBackend>>>> {
        let default = self.default_backend.read();
        default.and_then(|t| self.get(t))
    }

    /// Set the default backend
    pub fn set_default(&self, backend_type: BackendType) {
        *self.default_backend.write() = Some(backend_type);
    }

    /// Get all registered backend types
    pub fn registered_backends(&self) -> Vec<BackendType> {
        self.backends.read().keys().copied().collect()
    }

    /// Get capabilities of all registered backends (sync version using blocking read)
    pub fn all_capabilities(&self) -> HashMap<BackendType, BackendCapabilities> {
        let backends = self.backends.read();
        backends
            .iter()
            .map(|(t, b)| (*t, b.blocking_read().capabilities()))
            .collect()
    }

    /// Find the best backend for a task
    pub fn best_backend_for_task(
        &self,
        task_type: TaskType,
    ) -> Option<(BackendType, Arc<TokioRwLock<Box<dyn InferenceBackend>>>)> {
        let backends = self.backends.read();

        // Priority order for backend selection
        let priority = [
            BackendType::Cuda,
            BackendType::Rocm,
            BackendType::Vulkan,
            BackendType::OpenAi,
            BackendType::Cpu,
            BackendType::Crawler,
            BackendType::Mock,
        ];

        for backend_type in priority {
            if let Some(backend) = backends.get(&backend_type) {
                let caps = backend.blocking_read().capabilities();
                if caps.supported_tasks.contains(&task_type) {
                    return Some((backend_type, backend.clone()));
                }
            }
        }

        None
    }

    /// Find a backend that supports a task (convenience method returning just the backend)
    pub fn find_backend_for_task(
        &self,
        task_type: TaskType,
    ) -> Option<Arc<TokioRwLock<Box<dyn InferenceBackend>>>> {
        self.best_backend_for_task(task_type).map(|(_, b)| b)
    }

    /// Iterate over all registered backends
    pub fn backends(&self) -> Vec<Arc<TokioRwLock<Box<dyn InferenceBackend>>>> {
        self.backends.read().values().cloned().collect()
    }

    /// Find all backends that support a task
    pub fn backends_for_task(
        &self,
        task_type: TaskType,
    ) -> Vec<(BackendType, Arc<TokioRwLock<Box<dyn InferenceBackend>>>)> {
        let backends = self.backends.read();

        backends
            .iter()
            .filter(|(_, b)| {
                let caps = b.blocking_read().capabilities();
                caps.supported_tasks.contains(&task_type)
            })
            .map(|(t, b)| (*t, b.clone()))
            .collect()
    }
}

impl Default for BackendRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_type_names() {
        assert_eq!(BackendType::Cpu.name(), "cpu");
        assert_eq!(BackendType::Cuda.name(), "cuda");
        assert_eq!(BackendType::Mock.name(), "mock");
    }

    #[test]
    fn test_backend_type_from_str() {
        assert_eq!(BackendType::from_str("cpu"), Some(BackendType::Cpu));
        assert_eq!(BackendType::from_str("CPU"), Some(BackendType::Cpu));
        assert_eq!(BackendType::from_str("mock"), Some(BackendType::Mock));
        assert_eq!(BackendType::from_str("invalid"), None);
    }

    #[test]
    fn test_backend_availability() {
        // CPU and Mock should always be available
        assert!(BackendType::Cpu.is_available());
        assert!(BackendType::Mock.is_available());
    }

    #[test]
    fn test_factory_create_cpu() {
        let backend = BackendFactory::create(BackendType::Cpu, BackendConfig::default());
        assert!(backend.is_ok());
    }

    #[test]
    fn test_factory_create_mock() {
        let backend = BackendFactory::create(BackendType::Mock, BackendConfig::default());
        assert!(backend.is_ok());
    }

    #[test]
    fn test_registry_new() {
        let registry = BackendRegistry::new();
        assert!(registry.registered_backends().is_empty());
    }

    #[test]
    fn test_registry_register() {
        let registry = BackendRegistry::new();
        registry.register(BackendType::Mock, BackendConfig::default()).unwrap();

        assert_eq!(registry.registered_backends(), vec![BackendType::Mock]);
    }

    #[test]
    fn test_registry_default_backend() {
        let registry = BackendRegistry::new();
        registry.register(BackendType::Mock, BackendConfig::default()).unwrap();

        let default = registry.default_backend();
        assert!(default.is_some());
    }

    #[test]
    fn test_registry_best_backend_for_task() {
        let registry = BackendRegistry::new();
        registry.register(BackendType::Mock, BackendConfig::default()).unwrap();

        let result = registry.best_backend_for_task(TaskType::TextCompletion);
        assert!(result.is_some());

        let (backend_type, _) = result.unwrap();
        assert_eq!(backend_type, BackendType::Mock);
    }

    #[test]
    fn test_registry_unregister() {
        let registry = BackendRegistry::new();
        registry.register(BackendType::Mock, BackendConfig::default()).unwrap();

        assert!(!registry.registered_backends().is_empty());

        registry.unregister(BackendType::Mock);

        assert!(registry.registered_backends().is_empty());
    }
}
