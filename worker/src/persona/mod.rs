//! Persona system — downloadable role configurations for the governance hierarchy.
//!
//! Each AI4All worker instance operates as one persona (Master BA, Project BA,
//! Coder, or Tester). The persona defines capabilities, communication rules,
//! and workflow permissions.

pub mod manager;
pub mod registry;
pub mod types;

pub use manager::PersonaManager;
pub use registry::PersonaRegistry;
pub use types::{
    CommunicationRules, GovernanceLevel, InstalledPersona, PersonaCapabilities, PersonaConfig,
    PersonaType, WorkflowRules,
};
