//! Peer-to-peer communication module
//!
//! Provides direct worker-to-worker communication for:
//! - Model sharding (splitting large models across machines)
//! - Task collaboration (pipeline processing between workers)
//! - Work coordination (health gossip, load awareness)
//!
//! Workers discover each other through the coordinator, then
//! establish direct TCP connections for low-latency data transfer.

pub mod groups;
pub mod mesh;
pub mod registry;

pub use groups::*;
pub use mesh::*;
pub use registry::*;
