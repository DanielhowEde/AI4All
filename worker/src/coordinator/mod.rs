//! Coordinator communication module
//!
//! Handles WebSocket connection to the coordinator, including:
//! - Connection establishment with auto-reconnect
//! - Message sending and receiving
//! - Heartbeat management
//! - Task lifecycle coordination

mod client;

pub use client::*;
