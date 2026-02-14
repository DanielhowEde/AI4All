//! Core types for the persona system.
//!
//! Personas define the role, capabilities, and communication rules for each
//! worker instance in the enterprise governance hierarchy.

use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────
// Persona Type
// ─────────────────────────────────────────────────────────────────

/// The four persona roles in the governance hierarchy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PersonaType {
    /// Master Business Analyst — defines WHY and WHAT at programme level.
    MasterBa,
    /// Project Business Analyst — defines HOW, manages milestones.
    ProjectBa,
    /// Coder — implements deliverables for assigned milestones.
    Coder,
    /// Tester — verifies deliverables against acceptance criteria.
    Tester,
}

impl PersonaType {
    /// Slug used in file paths and CLI args.
    pub fn slug(&self) -> &'static str {
        match self {
            PersonaType::MasterBa => "master-ba",
            PersonaType::ProjectBa => "project-ba",
            PersonaType::Coder => "coder",
            PersonaType::Tester => "tester",
        }
    }

    /// Human-readable display name.
    pub fn display_name(&self) -> &'static str {
        match self {
            PersonaType::MasterBa => "Master BA",
            PersonaType::ProjectBa => "Project BA",
            PersonaType::Coder => "Coder",
            PersonaType::Tester => "Tester",
        }
    }

    /// All persona types in hierarchy order.
    pub fn all() -> &'static [PersonaType] {
        &[
            PersonaType::MasterBa,
            PersonaType::ProjectBa,
            PersonaType::Coder,
            PersonaType::Tester,
        ]
    }

    /// Governance level this persona operates at.
    pub fn governance_level(&self) -> GovernanceLevel {
        match self {
            PersonaType::MasterBa => GovernanceLevel::Programme,
            PersonaType::ProjectBa => GovernanceLevel::Project,
            PersonaType::Coder | PersonaType::Tester => GovernanceLevel::Delivery,
        }
    }
}

impl fmt::Display for PersonaType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

impl FromStr for PersonaType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "master-ba" | "masterba" | "master_ba" => Ok(PersonaType::MasterBa),
            "project-ba" | "projectba" | "project_ba" => Ok(PersonaType::ProjectBa),
            "coder" => Ok(PersonaType::Coder),
            "tester" => Ok(PersonaType::Tester),
            _ => Err(format!(
                "Unknown persona type '{}'. Valid: master-ba, project-ba, coder, tester",
                s
            )),
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Governance Level
// ─────────────────────────────────────────────────────────────────

/// The governance hierarchy level a persona operates at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GovernanceLevel {
    /// Programme level — strategic direction.
    Programme,
    /// Project level — detailed planning and milestone management.
    Project,
    /// Delivery level — implementation and verification.
    Delivery,
}

impl fmt::Display for GovernanceLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GovernanceLevel::Programme => write!(f, "Programme"),
            GovernanceLevel::Project => write!(f, "Project"),
            GovernanceLevel::Delivery => write!(f, "Delivery"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Persona Config (loaded from TOML)
// ─────────────────────────────────────────────────────────────────

/// Full persona configuration, deserialized from TOML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaConfig {
    /// Which persona role this config defines.
    pub persona_type: PersonaType,

    /// Semantic version of this config (e.g. "1.0.0").
    pub version: String,

    /// Short human-readable description.
    pub description: String,

    /// System prompt used when this persona interacts with an LLM.
    pub system_prompt: String,

    /// What this persona is allowed to do.
    pub capabilities: PersonaCapabilities,

    /// Who this persona can communicate with.
    pub communication: CommunicationRules,

    /// Workflow constraints.
    pub workflow: WorkflowRules,
}

/// Defines what actions a persona is authorised to perform.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaCapabilities {
    /// Task type slugs this persona can execute (e.g. "text-completion").
    #[serde(default)]
    pub allowed_task_types: Vec<String>,

    /// Can create new projects within a programme.
    #[serde(default)]
    pub can_create_projects: bool,

    /// Can define milestones within a project.
    #[serde(default)]
    pub can_create_milestones: bool,

    /// Can approve completed milestones.
    #[serde(default)]
    pub can_approve_milestones: bool,

    /// Can assign work to delivery personas.
    #[serde(default)]
    pub can_assign_work: bool,

    /// Can submit deliverables for milestones.
    #[serde(default)]
    pub can_submit_work: bool,

    /// Can run test suites against deliverables.
    #[serde(default)]
    pub can_verify_work: bool,
}

/// Defines allowed communication channels between personas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunicationRules {
    /// Persona types this persona can send messages to.
    #[serde(default)]
    pub can_message: Vec<PersonaType>,

    /// Persona types this persona can receive messages from.
    #[serde(default)]
    pub can_receive_from: Vec<PersonaType>,

    /// If this persona encounters an issue it cannot resolve, escalate to this type.
    #[serde(default)]
    pub escalation_target: Option<PersonaType>,
}

/// Workflow constraints specific to the persona's role.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRules {
    /// Maximum milestones this persona can manage concurrently.
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent_milestones: u32,

    /// Whether this persona can create programmes.
    #[serde(default)]
    pub can_create_programmes: bool,

    /// Whether milestone state transitions must be signed by this persona.
    #[serde(default)]
    pub requires_signature: bool,
}

fn default_max_concurrent() -> u32 {
    5
}

// ─────────────────────────────────────────────────────────────────
// Installed Persona Metadata
// ─────────────────────────────────────────────────────────────────

/// Metadata about a locally installed persona config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPersona {
    /// Which persona type.
    pub persona_type: PersonaType,

    /// Config version.
    pub version: String,

    /// Path to the config TOML on disk.
    pub config_path: PathBuf,

    /// Whether this is the currently active persona.
    pub is_active: bool,
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_persona_type_slug() {
        assert_eq!(PersonaType::MasterBa.slug(), "master-ba");
        assert_eq!(PersonaType::ProjectBa.slug(), "project-ba");
        assert_eq!(PersonaType::Coder.slug(), "coder");
        assert_eq!(PersonaType::Tester.slug(), "tester");
    }

    #[test]
    fn test_persona_type_from_str() {
        assert_eq!(
            "master-ba".parse::<PersonaType>().unwrap(),
            PersonaType::MasterBa
        );
        assert_eq!(
            "project-ba".parse::<PersonaType>().unwrap(),
            PersonaType::ProjectBa
        );
        assert_eq!("coder".parse::<PersonaType>().unwrap(), PersonaType::Coder);
        assert_eq!(
            "tester".parse::<PersonaType>().unwrap(),
            PersonaType::Tester
        );
        assert!("unknown".parse::<PersonaType>().is_err());
    }

    #[test]
    fn test_persona_type_all() {
        let all = PersonaType::all();
        assert_eq!(all.len(), 4);
    }

    #[test]
    fn test_governance_level() {
        assert_eq!(
            PersonaType::MasterBa.governance_level(),
            GovernanceLevel::Programme
        );
        assert_eq!(
            PersonaType::ProjectBa.governance_level(),
            GovernanceLevel::Project
        );
        assert_eq!(
            PersonaType::Coder.governance_level(),
            GovernanceLevel::Delivery
        );
        assert_eq!(
            PersonaType::Tester.governance_level(),
            GovernanceLevel::Delivery
        );
    }

    #[test]
    fn test_serde_roundtrip() {
        let json = serde_json::to_string(&PersonaType::MasterBa).unwrap();
        assert_eq!(json, "\"master-ba\"");
        let parsed: PersonaType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, PersonaType::MasterBa);
    }
}
