//! Persona manager — download, load, validate, and activate persona configs.
//!
//! Follows the same pattern as `plugins/manager.rs`.

use std::fs;
use std::path::{Path, PathBuf};

use tracing::{debug, info, warn};

use crate::error::{Error, Result};

use super::registry::PersonaRegistry;
use super::types::{InstalledPersona, PersonaConfig, PersonaType};

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const ACTIVE_FILE: &str = "active.txt";
const CONFIG_FILE: &str = "config.toml";

// ─────────────────────────────────────────────────────────────────
// Persona Manager
// ─────────────────────────────────────────────────────────────────

/// Manages persona configuration lifecycle.
pub struct PersonaManager {
    /// Root directory for persona configs: ~/.ai4all/worker/personas/
    persona_dir: PathBuf,

    /// Registry of bundled/available personas.
    registry: PersonaRegistry,

    /// Currently loaded (active) persona config.
    active_persona: Option<PersonaConfig>,
}

impl PersonaManager {
    /// Create a new persona manager.
    pub fn new(persona_dir: PathBuf) -> Self {
        Self {
            persona_dir,
            registry: PersonaRegistry::new(),
            active_persona: None,
        }
    }

    /// Create with default directory (~/.ai4all/worker/personas/).
    pub fn with_defaults() -> Self {
        let persona_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".ai4all")
            .join("worker")
            .join("personas");
        Self::new(persona_dir)
    }

    /// Get the persona directory.
    pub fn persona_dir(&self) -> &Path {
        &self.persona_dir
    }

    /// Ensure persona directory exists.
    fn ensure_dir(&self) -> Result<()> {
        if !self.persona_dir.exists() {
            fs::create_dir_all(&self.persona_dir).map_err(|e| Error::PersonaInvalid {
                name: String::new(),
                reason: format!("Failed to create persona directory: {}", e),
            })?;
            debug!(path = %self.persona_dir.display(), "Created persona directory");
        }
        Ok(())
    }

    /// Path to a specific persona's config directory.
    fn persona_path(&self, persona_type: PersonaType) -> PathBuf {
        self.persona_dir.join(persona_type.slug())
    }

    /// Path to the active persona marker file.
    fn active_file_path(&self) -> PathBuf {
        self.persona_dir.join(ACTIVE_FILE)
    }

    // ─────────────────────────────────────────────────────────────
    // List / Query
    // ─────────────────────────────────────────────────────────────

    /// List all locally installed personas.
    pub fn list_installed(&self) -> Result<Vec<InstalledPersona>> {
        let active = self.read_active_slug();
        let mut result = Vec::new();

        for pt in PersonaType::all() {
            let dir = self.persona_path(*pt);
            let config_path = dir.join(CONFIG_FILE);
            if config_path.exists() {
                let cfg = self.load_config_from_path(&config_path)?;
                result.push(InstalledPersona {
                    persona_type: *pt,
                    version: cfg.version,
                    config_path,
                    is_active: active.as_deref() == Some(pt.slug()),
                });
            }
        }

        Ok(result)
    }

    /// Get the currently active persona config, if any.
    pub fn active_persona(&self) -> Option<&PersonaConfig> {
        self.active_persona.as_ref()
    }

    // ─────────────────────────────────────────────────────────────
    // Download (copy bundled config to user directory)
    // ─────────────────────────────────────────────────────────────

    /// "Download" a persona config by writing the bundled default to the persona dir.
    pub fn download(&self, persona_type: PersonaType) -> Result<PathBuf> {
        self.ensure_dir()?;

        let bundled = self
            .registry
            .get_bundled_config(persona_type)
            .ok_or_else(|| Error::PersonaNotFound {
                name: persona_type.slug().to_string(),
            })?;

        let dest_dir = self.persona_path(persona_type);
        fs::create_dir_all(&dest_dir).map_err(|e| Error::PersonaInvalid {
            name: persona_type.slug().to_string(),
            reason: format!("Failed to create directory: {}", e),
        })?;

        let dest = dest_dir.join(CONFIG_FILE);
        fs::write(&dest, bundled).map_err(|e| Error::PersonaInvalid {
            name: persona_type.slug().to_string(),
            reason: format!("Failed to write config: {}", e),
        })?;

        info!(persona = %persona_type.slug(), path = %dest.display(), "Persona downloaded");
        Ok(dest)
    }

    // ─────────────────────────────────────────────────────────────
    // Load / Validate
    // ─────────────────────────────────────────────────────────────

    /// Load a persona config from the persona directory.
    pub fn load(&self, persona_type: PersonaType) -> Result<PersonaConfig> {
        let config_path = self.persona_path(persona_type).join(CONFIG_FILE);
        if !config_path.exists() {
            return Err(Error::PersonaNotFound {
                name: persona_type.slug().to_string(),
            });
        }
        self.load_config_from_path(&config_path)
    }

    /// Validate that a persona config is well-formed.
    pub fn validate(&self, persona_type: PersonaType) -> Result<PersonaConfig> {
        let cfg = self.load(persona_type)?;

        // Verify the persona_type field matches what we expected
        if cfg.persona_type != persona_type {
            return Err(Error::PersonaInvalid {
                name: persona_type.slug().to_string(),
                reason: format!(
                    "Config persona_type '{}' does not match expected '{}'",
                    cfg.persona_type.slug(),
                    persona_type.slug()
                ),
            });
        }

        if cfg.version.is_empty() {
            return Err(Error::PersonaInvalid {
                name: persona_type.slug().to_string(),
                reason: "Version must not be empty".to_string(),
            });
        }

        Ok(cfg)
    }

    /// Load config from a specific file path.
    fn load_config_from_path(&self, path: &Path) -> Result<PersonaConfig> {
        let content = fs::read_to_string(path).map_err(|e| Error::PersonaNotFound {
            name: path.display().to_string(),
        })?;
        let cfg: PersonaConfig = toml::from_str(&content).map_err(|e| Error::PersonaInvalid {
            name: path.display().to_string(),
            reason: format!("Failed to parse TOML: {}", e),
        })?;
        Ok(cfg)
    }

    // ─────────────────────────────────────────────────────────────
    // Activate
    // ─────────────────────────────────────────────────────────────

    /// Activate a persona. Downloads it first if not installed.
    pub fn activate(&mut self, persona_type: PersonaType) -> Result<&PersonaConfig> {
        // Ensure downloaded
        let dir = self.persona_path(persona_type);
        if !dir.join(CONFIG_FILE).exists() {
            info!(persona = %persona_type.slug(), "Not installed, downloading bundled config");
            self.download(persona_type)?;
        }

        let cfg = self.validate(persona_type)?;

        // Write active marker
        self.ensure_dir()?;
        fs::write(self.active_file_path(), persona_type.slug()).map_err(|e| {
            Error::PersonaInvalid {
                name: persona_type.slug().to_string(),
                reason: format!("Failed to write active marker: {}", e),
            }
        })?;

        info!(persona = %persona_type.slug(), version = %cfg.version, "Persona activated");
        self.active_persona = Some(cfg);
        Ok(self.active_persona.as_ref().unwrap())
    }

    /// Load the previously activated persona (from active.txt marker).
    pub fn load_active(&mut self) -> Result<Option<&PersonaConfig>> {
        let slug = match self.read_active_slug() {
            Some(s) => s,
            None => return Ok(None),
        };

        let persona_type: PersonaType =
            slug.parse().map_err(|e: String| Error::PersonaInvalid {
                name: slug.clone(),
                reason: e,
            })?;

        let cfg = self.load(persona_type)?;
        self.active_persona = Some(cfg);
        Ok(self.active_persona.as_ref())
    }

    /// Read the active persona slug from disk.
    fn read_active_slug(&self) -> Option<String> {
        let path = self.active_file_path();
        fs::read_to_string(&path).ok().map(|s| s.trim().to_string())
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_manager() -> (PersonaManager, TempDir) {
        let tmp = TempDir::new().unwrap();
        let mgr = PersonaManager::new(tmp.path().join("personas"));
        (mgr, tmp)
    }

    #[test]
    fn test_download_and_list() {
        let (mgr, _tmp) = test_manager();
        mgr.download(PersonaType::Coder).unwrap();

        let installed = mgr.list_installed().unwrap();
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].persona_type, PersonaType::Coder);
        assert!(!installed[0].is_active);
    }

    #[test]
    fn test_activate_and_load_active() {
        let (mut mgr, _tmp) = test_manager();
        mgr.activate(PersonaType::Tester).unwrap();

        let active = mgr.active_persona().unwrap();
        assert_eq!(active.persona_type, PersonaType::Tester);

        // Create new manager, load_active should find it
        let mut mgr2 = PersonaManager::new(mgr.persona_dir().to_path_buf());
        let loaded = mgr2.load_active().unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().persona_type, PersonaType::Tester);
    }

    #[test]
    fn test_load_not_found() {
        let (mgr, _tmp) = test_manager();
        let result = mgr.load(PersonaType::MasterBa);
        assert!(result.is_err());
    }

    #[test]
    fn test_download_all() {
        let (mgr, _tmp) = test_manager();
        for pt in PersonaType::all() {
            mgr.download(*pt).unwrap();
        }
        let installed = mgr.list_installed().unwrap();
        assert_eq!(installed.len(), 4);
    }

    #[test]
    fn test_validate_after_download() {
        let (mgr, _tmp) = test_manager();
        mgr.download(PersonaType::MasterBa).unwrap();
        let cfg = mgr.validate(PersonaType::MasterBa).unwrap();
        assert_eq!(cfg.persona_type, PersonaType::MasterBa);
        assert!(!cfg.version.is_empty());
    }
}
