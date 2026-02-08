//! Plugin manager for downloading, loading, and managing GPU backend plugins

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tracing::{debug, error, info, warn};

use crate::error::{Error, Result};
use crate::gpu::{GpuInfo, GpuVendor};

use super::{LoadedPlugin, PluginInfo, PluginRegistry, PluginState, PLUGIN_API_VERSION};

// ─────────────────────────────────────────────────────────────────
// Plugin Manager Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for the plugin manager
#[derive(Debug, Clone)]
pub struct PluginManagerConfig {
    /// Directory for storing plugins
    pub plugin_dir: PathBuf,

    /// Whether to auto-download missing plugins
    pub auto_download: bool,

    /// Custom registry URL (None = use default)
    pub registry_url: Option<String>,

    /// Whether to verify checksums
    pub verify_checksums: bool,

    /// Connection timeout for downloads (seconds)
    pub download_timeout_secs: u64,
}

impl Default for PluginManagerConfig {
    fn default() -> Self {
        let plugin_dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ai4all")
            .join("plugins");

        Self {
            plugin_dir,
            auto_download: true,
            registry_url: None,
            verify_checksums: true,
            download_timeout_secs: 300,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Plugin Manager
// ─────────────────────────────────────────────────────────────────

/// Manages GPU backend plugins
pub struct PluginManager {
    /// Configuration
    config: PluginManagerConfig,

    /// Plugin registry
    registry: PluginRegistry,

    /// Currently loaded plugins
    loaded_plugins: HashMap<String, LoadedPlugin>,
}

impl PluginManager {
    /// Create a new plugin manager
    pub fn new(config: PluginManagerConfig) -> Self {
        let registry = match &config.registry_url {
            Some(url) => PluginRegistry::with_base_url(url),
            None => PluginRegistry::new(),
        };

        Self {
            config,
            registry,
            loaded_plugins: HashMap::new(),
        }
    }

    /// Create with default configuration
    pub fn with_defaults() -> Self {
        Self::new(PluginManagerConfig::default())
    }

    /// Get the plugin directory
    pub fn plugin_dir(&self) -> &Path {
        &self.config.plugin_dir
    }

    /// Ensure plugin directory exists
    pub fn ensure_plugin_dir(&self) -> Result<()> {
        if !self.config.plugin_dir.exists() {
            std::fs::create_dir_all(&self.config.plugin_dir)
                .map_err(|e| Error::PluginLoadFailed {
                    name: "".to_string(),
                    message: format!("Failed to create plugin directory: {}", e),
                    path: Some(self.config.plugin_dir.clone()),
                })?;
            info!(path = %self.config.plugin_dir.display(), "Created plugin directory");
        }
        Ok(())
    }

    /// Check if a plugin is available locally
    pub fn is_plugin_available(&self, name: &str) -> bool {
        let plugin_info = match self.registry.find_by_name(name) {
            Some(info) => info,
            None => return false,
        };

        let plugin_path = self.config.plugin_dir.join(plugin_info.full_file_name());
        plugin_path.exists()
    }

    /// Get the local path for a plugin
    pub fn plugin_path(&self, name: &str) -> Option<PathBuf> {
        self.registry.find_by_name(name).map(|info| {
            self.config.plugin_dir.join(info.full_file_name())
        })
    }

    /// Find the best plugin for a GPU
    pub fn find_plugin_for_gpu(&self, gpu: &GpuInfo) -> Option<&PluginInfo> {
        self.registry.find_best_for_gpu(gpu)
    }

    /// Check if we have a plugin for a GPU vendor
    pub fn has_plugin_for_vendor(&self, vendor: GpuVendor) -> bool {
        !self.registry.find_for_vendor(vendor).is_empty()
    }

    /// Download a plugin
    #[cfg(feature = "gpu")]
    pub async fn download_plugin(&self, plugin: &PluginInfo) -> Result<PathBuf> {
        use sha2::{Digest, Sha256};

        self.ensure_plugin_dir()?;

        let url = plugin.get_download_url();
        let dest_path = self.config.plugin_dir.join(plugin.full_file_name());

        info!(
            plugin = %plugin.name,
            url = %url,
            dest = %dest_path.display(),
            "Downloading plugin"
        );

        // Download with reqwest
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(self.config.download_timeout_secs))
            .build()
            .map_err(|e| Error::PluginDownloadFailed {
                name: plugin.name.clone(),
                message: format!("Failed to create HTTP client: {}", e),
                url: Some(url.clone()),
            })?;

        let response = client.get(&url).send().await
            .map_err(|e| Error::PluginDownloadFailed {
                name: plugin.name.clone(),
                message: format!("Download request failed: {}", e),
                url: Some(url.clone()),
            })?;

        if !response.status().is_success() {
            return Err(Error::PluginDownloadFailed {
                name: plugin.name.clone(),
                message: format!("HTTP error: {}", response.status()),
                url: Some(url.clone()),
            });
        }

        let bytes = response.bytes().await
            .map_err(|e| Error::PluginDownloadFailed {
                name: plugin.name.clone(),
                message: format!("Failed to read response body: {}", e),
                url: Some(url.clone()),
            })?;

        // Verify checksum if required
        if self.config.verify_checksums && !plugin.checksum.is_empty() {
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let hash = hex::encode(hasher.finalize());

            if hash != plugin.checksum {
                return Err(Error::PluginChecksumMismatch {
                    name: plugin.name.clone(),
                    expected: plugin.checksum.clone(),
                    actual: hash,
                });
            }
            debug!(plugin = %plugin.name, "Checksum verified");
        }

        // Write to file
        std::fs::write(&dest_path, &bytes)
            .map_err(|e| Error::PluginLoadFailed {
                name: plugin.name.clone(),
                message: format!("Failed to write plugin file: {}", e),
                path: Some(dest_path.clone()),
            })?;

        info!(
            plugin = %plugin.name,
            path = %dest_path.display(),
            size_bytes = bytes.len(),
            "Plugin downloaded successfully"
        );

        Ok(dest_path)
    }

    /// Download a plugin (stub when feature disabled)
    #[cfg(not(feature = "gpu"))]
    pub async fn download_plugin(&self, plugin: &PluginInfo) -> Result<PathBuf> {
        Err(Error::NotSupported(
            "Plugin downloads require --features gpu".to_string()
        ))
    }

    /// Load a plugin from disk
    #[cfg(feature = "gpu")]
    pub fn load_plugin(&mut self, name: &str) -> Result<&LoadedPlugin> {
        // Check if already loaded
        if self.loaded_plugins.contains_key(name) {
            return Ok(self.loaded_plugins.get(name).unwrap());
        }

        let plugin_info = self.registry.find_by_name(name)
            .ok_or_else(|| Error::PluginNotFound { name: name.to_string() })?
            .clone();

        let plugin_path = self.config.plugin_dir.join(plugin_info.full_file_name());

        if !plugin_path.exists() {
            return Err(Error::PluginNotFound { name: name.to_string() });
        }

        info!(
            plugin = %name,
            path = %plugin_path.display(),
            "Loading plugin"
        );

        // Load the dynamic library
        let library = unsafe {
            libloading::Library::new(&plugin_path)
                .map_err(|e| Error::PluginLoadFailed {
                    name: name.to_string(),
                    message: format!("Failed to load library: {}", e),
                    path: Some(plugin_path.clone()),
                })?
        };

        // Verify plugin API version
        if let Err(e) = self.verify_plugin_api(&library, &plugin_info) {
            warn!(plugin = %name, error = %e, "Plugin API verification failed");
            // Continue anyway for now, but log warning
        }

        let loaded = LoadedPlugin {
            info: plugin_info,
            path: plugin_path,
            library,
            state: PluginState::Ready,
        };

        self.loaded_plugins.insert(name.to_string(), loaded);

        info!(plugin = %name, "Plugin loaded successfully");
        Ok(self.loaded_plugins.get(name).unwrap())
    }

    /// Load a plugin from disk (stub when feature disabled)
    #[cfg(not(feature = "gpu"))]
    pub fn load_plugin(&mut self, name: &str) -> Result<&LoadedPlugin> {
        Err(Error::NotSupported(
            "Plugin loading requires --features gpu".to_string()
        ))
    }

    /// Verify plugin API compatibility
    #[cfg(feature = "gpu")]
    fn verify_plugin_api(&self, library: &libloading::Library, info: &PluginInfo) -> Result<()> {
        // Try to call plugin_api_version export
        let api_version: libloading::Symbol<unsafe extern "C" fn() -> u32> = unsafe {
            library.get(b"plugin_api_version")
                .map_err(|_| Error::PluginIncompatible {
                    name: info.name.clone(),
                    reason: "Missing plugin_api_version export".to_string(),
                })?
        };

        let version = unsafe { api_version() };

        if version != PLUGIN_API_VERSION {
            return Err(Error::PluginIncompatible {
                name: info.name.clone(),
                reason: format!(
                    "API version mismatch: expected {}, got {}",
                    PLUGIN_API_VERSION, version
                ),
            });
        }

        Ok(())
    }

    /// Ensure a plugin is available (download if needed)
    #[cfg(feature = "gpu")]
    pub async fn ensure_plugin(&mut self, name: &str) -> Result<&LoadedPlugin> {
        // Check if already loaded
        if self.loaded_plugins.contains_key(name) {
            return Ok(self.loaded_plugins.get(name).unwrap());
        }

        // Check if available locally
        if !self.is_plugin_available(name) {
            // Download if auto-download enabled
            if self.config.auto_download {
                let plugin_info = self.registry.find_by_name(name)
                    .ok_or_else(|| Error::PluginNotFound { name: name.to_string() })?
                    .clone();

                self.download_plugin(&plugin_info).await?;
            } else {
                return Err(Error::PluginNotFound { name: name.to_string() });
            }
        }

        // Load the plugin
        self.load_plugin(name)
    }

    /// Ensure a plugin is available (stub when feature disabled)
    #[cfg(not(feature = "gpu"))]
    pub async fn ensure_plugin(&mut self, name: &str) -> Result<&LoadedPlugin> {
        Err(Error::NotSupported(
            "Plugin system requires --features gpu".to_string()
        ))
    }

    /// Get a loaded plugin by name
    pub fn get_plugin(&self, name: &str) -> Option<&LoadedPlugin> {
        self.loaded_plugins.get(name)
    }

    /// Get all loaded plugins
    pub fn loaded_plugins(&self) -> impl Iterator<Item = &LoadedPlugin> {
        self.loaded_plugins.values()
    }

    /// Unload a plugin
    pub fn unload_plugin(&mut self, name: &str) -> bool {
        if let Some(mut plugin) = self.loaded_plugins.remove(name) {
            plugin.state = PluginState::Unloaded;
            info!(plugin = %name, "Plugin unloaded");
            true
        } else {
            false
        }
    }

    /// Unload all plugins
    pub fn unload_all(&mut self) {
        let names: Vec<String> = self.loaded_plugins.keys().cloned().collect();
        for name in names {
            self.unload_plugin(&name);
        }
    }

    /// Get the plugin registry
    pub fn registry(&self) -> &PluginRegistry {
        &self.registry
    }

    /// Get mutable plugin registry
    pub fn registry_mut(&mut self) -> &mut PluginRegistry {
        &mut self.registry
    }

    /// List available plugins (from registry)
    pub fn list_available(&self) -> Vec<PluginStatus> {
        self.registry.plugins().iter().map(|info| {
            let local_path = self.config.plugin_dir.join(info.full_file_name());
            let is_local = local_path.exists();
            let is_loaded = self.loaded_plugins.contains_key(&info.name);

            PluginStatus {
                name: info.name.clone(),
                version: info.version.clone(),
                is_local,
                is_loaded,
                path: if is_local { Some(local_path) } else { None },
            }
        }).collect()
    }
}

impl Drop for PluginManager {
    fn drop(&mut self) {
        self.unload_all();
    }
}

// ─────────────────────────────────────────────────────────────────
// Plugin Status
// ─────────────────────────────────────────────────────────────────

/// Status of a plugin
#[derive(Debug, Clone)]
pub struct PluginStatus {
    /// Plugin name
    pub name: String,

    /// Plugin version
    pub version: String,

    /// Whether plugin is downloaded locally
    pub is_local: bool,

    /// Whether plugin is currently loaded
    pub is_loaded: bool,

    /// Local file path (if downloaded)
    pub path: Option<PathBuf>,
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_manager_creation() {
        let manager = PluginManager::with_defaults();
        assert!(!manager.registry().plugins().is_empty());
    }

    #[test]
    fn test_plugin_path() {
        let config = PluginManagerConfig {
            plugin_dir: PathBuf::from("/test/plugins"),
            ..Default::default()
        };
        let manager = PluginManager::new(config);

        let path = manager.plugin_path("vulkan-backend");
        assert!(path.is_some());
        assert!(path.unwrap().starts_with("/test/plugins"));
    }

    #[test]
    fn test_list_available() {
        let manager = PluginManager::with_defaults();
        let available = manager.list_available();

        assert!(!available.is_empty());
        assert!(available.iter().any(|p| p.name == "vulkan-backend"));
    }

    #[test]
    fn test_config_default() {
        let config = PluginManagerConfig::default();
        assert!(config.auto_download);
        assert!(config.verify_checksums);
        assert!(config.plugin_dir.to_string_lossy().contains("ai4all"));
    }
}
