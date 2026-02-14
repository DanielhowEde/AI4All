//! Bundled persona registry — provides default TOML configs for each persona type.

use super::types::PersonaType;

/// Registry of available persona configurations.
///
/// Currently serves bundled defaults. In future, could fetch from a remote
/// registry URL (similar to the plugin registry).
pub struct PersonaRegistry;

impl PersonaRegistry {
    pub fn new() -> Self {
        Self
    }

    /// Get the bundled TOML config string for a persona type.
    pub fn get_bundled_config(&self, persona_type: PersonaType) -> Option<&'static str> {
        match persona_type {
            PersonaType::MasterBa => Some(include_str!("../../config/personas/master-ba.toml")),
            PersonaType::ProjectBa => Some(include_str!("../../config/personas/project-ba.toml")),
            PersonaType::Coder => Some(include_str!("../../config/personas/coder.toml")),
            PersonaType::Tester => Some(include_str!("../../config/personas/tester.toml")),
        }
    }

    /// List all available persona types with their descriptions.
    pub fn list_available(&self) -> Vec<PersonaListing> {
        PersonaType::all()
            .iter()
            .map(|pt| PersonaListing {
                persona_type: *pt,
                description: match pt {
                    PersonaType::MasterBa => "Programme-level BA — defines WHY and WHAT",
                    PersonaType::ProjectBa => "Project-level BA — defines HOW, manages milestones",
                    PersonaType::Coder => "Delivery — implements milestone deliverables",
                    PersonaType::Tester => {
                        "Delivery — verifies deliverables against acceptance criteria"
                    }
                },
                bundled: true,
            })
            .collect()
    }
}

/// Summary of an available persona.
#[derive(Debug, Clone)]
pub struct PersonaListing {
    pub persona_type: PersonaType,
    pub description: &'static str,
    pub bundled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_bundled_configs_exist() {
        let registry = PersonaRegistry::new();
        for pt in PersonaType::all() {
            let cfg = registry.get_bundled_config(*pt);
            assert!(cfg.is_some(), "Missing bundled config for {:?}", pt);
            assert!(!cfg.unwrap().is_empty());
        }
    }

    #[test]
    fn test_list_available() {
        let registry = PersonaRegistry::new();
        let list = registry.list_available();
        assert_eq!(list.len(), 4);
        assert!(list.iter().all(|l| l.bundled));
    }
}
