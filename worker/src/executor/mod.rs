//! Task executor module
//!
//! Handles the task execution lifecycle:
//! - Receiving tasks from the coordinator
//! - Dispatching to appropriate backends
//! - Tracking execution state
//! - Submitting results

mod runner;
mod state;

pub use runner::*;
pub use state::*;
