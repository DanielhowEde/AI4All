//! Protocol module for coordinator communication
//!
//! Defines the message types and serialization for the worker-coordinator protocol.
//! The protocol uses JSON over WebSocket with versioning support.

mod messages;
mod version;

pub use messages::*;
pub use version::*;
