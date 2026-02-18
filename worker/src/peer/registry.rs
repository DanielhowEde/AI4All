//! Peer registry — tracks known peers and their capabilities
//!
//! Populated via coordinator discovery (PeerDirectory messages) and
//! updated by direct peer connections (status updates, latency).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use parking_lot::RwLock;

use crate::protocol::{WorkerCapabilities, WorkerStatus};
use crate::types::TaskType;

// ─────────────────────────────────────────────────────────────────
// Peer Info
// ─────────────────────────────────────────────────────────────────

/// Information about a known peer worker
#[derive(Debug, Clone)]
pub struct PeerInfo {
    /// Unique worker ID assigned by coordinator
    pub worker_id: String,

    /// Human-readable name
    pub name: String,

    /// TCP address for direct P2P connections
    pub listen_addr: SocketAddr,

    /// Worker capabilities (task types, GPU, memory)
    pub capabilities: WorkerCapabilities,

    /// Current operational status
    pub status: WorkerStatus,

    /// Last time we heard from this peer
    pub last_seen: Instant,

    /// Measured round-trip latency (ms)
    pub latency_ms: Option<u32>,

    /// Work groups this peer belongs to
    pub groups: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────
// Peer Registry
// ─────────────────────────────────────────────────────────────────

/// Thread-safe registry of known peers
pub struct PeerRegistry {
    peers: RwLock<HashMap<String, PeerInfo>>,
}

impl PeerRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        Self {
            peers: RwLock::new(HashMap::new()),
        }
    }

    /// Register or update a peer
    pub fn register(&self, info: PeerInfo) {
        self.peers.write().insert(info.worker_id.clone(), info);
    }

    /// Remove a peer by worker ID
    pub fn remove(&self, worker_id: &str) -> Option<PeerInfo> {
        self.peers.write().remove(worker_id)
    }

    /// Get a clone of a peer's info
    pub fn get(&self, worker_id: &str) -> Option<PeerInfo> {
        self.peers.read().get(worker_id).cloned()
    }

    /// Find peers that support a given task type
    pub fn peers_with_capability(&self, task_type: TaskType) -> Vec<PeerInfo> {
        self.peers
            .read()
            .values()
            .filter(|p| p.capabilities.supported_tasks.contains(&task_type))
            .cloned()
            .collect()
    }

    /// Find peers belonging to a specific work group
    pub fn peers_in_group(&self, group_id: &str) -> Vec<PeerInfo> {
        self.peers
            .read()
            .values()
            .filter(|p| p.groups.iter().any(|g| g == group_id))
            .cloned()
            .collect()
    }

    /// Get all known peers
    pub fn all_peers(&self) -> Vec<PeerInfo> {
        self.peers.read().values().cloned().collect()
    }

    /// Get count of known peers
    pub fn peer_count(&self) -> usize {
        self.peers.read().len()
    }

    /// Update a peer's status
    pub fn update_status(&self, worker_id: &str, status: WorkerStatus) {
        if let Some(peer) = self.peers.write().get_mut(worker_id) {
            peer.status = status;
            peer.last_seen = Instant::now();
        }
    }

    /// Update a peer's measured latency
    pub fn update_latency(&self, worker_id: &str, latency_ms: u32) {
        if let Some(peer) = self.peers.write().get_mut(worker_id) {
            peer.latency_ms = Some(latency_ms);
            peer.last_seen = Instant::now();
        }
    }

    /// Touch a peer's last_seen timestamp
    pub fn touch(&self, worker_id: &str) {
        if let Some(peer) = self.peers.write().get_mut(worker_id) {
            peer.last_seen = Instant::now();
        }
    }

    /// Add a peer to a work group
    pub fn add_to_group(&self, worker_id: &str, group_id: &str) {
        if let Some(peer) = self.peers.write().get_mut(worker_id) {
            if !peer.groups.contains(&group_id.to_string()) {
                peer.groups.push(group_id.to_string());
            }
        }
    }

    /// Remove a peer from a work group
    pub fn remove_from_group(&self, worker_id: &str, group_id: &str) {
        if let Some(peer) = self.peers.write().get_mut(worker_id) {
            peer.groups.retain(|g| g != group_id);
        }
    }

    /// Remove peers that haven't been seen within the timeout
    /// Returns the worker IDs of removed peers
    pub fn prune_stale(&self, timeout: Duration) -> Vec<String> {
        let mut peers = self.peers.write();
        let stale: Vec<String> = peers
            .iter()
            .filter(|(_, p)| p.last_seen.elapsed() > timeout)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &stale {
            peers.remove(id);
        }

        stale
    }

    /// Find the peer with the lowest latency that supports a task type
    pub fn best_peer_for_task(&self, task_type: TaskType) -> Option<PeerInfo> {
        self.peers
            .read()
            .values()
            .filter(|p| {
                p.status == WorkerStatus::Ready
                    && p.capabilities.supported_tasks.contains(&task_type)
            })
            .min_by_key(|p| p.latency_ms.unwrap_or(u32::MAX))
            .cloned()
    }
}

impl Default for PeerRegistry {
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
    use std::net::{IpAddr, Ipv4Addr};

    fn make_peer(id: &str, tasks: Vec<TaskType>) -> PeerInfo {
        PeerInfo {
            worker_id: id.to_string(),
            name: format!("Worker {}", id),
            listen_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 9100),
            capabilities: WorkerCapabilities {
                supported_tasks: tasks,
                max_concurrent_tasks: 4,
                available_memory_mb: 8192,
                gpu_available: false,
                gpu_device: None,
                gpu_memory_mb: None,
                max_context_length: 4096,
                worker_version: "0.1.0".to_string(),
            },
            status: WorkerStatus::Ready,
            last_seen: Instant::now(),
            latency_ms: None,
            groups: vec![],
        }
    }

    #[test]
    fn test_register_and_get() {
        let registry = PeerRegistry::new();
        let peer = make_peer("w1", vec![TaskType::TextCompletion]);

        registry.register(peer);
        assert_eq!(registry.peer_count(), 1);

        let got = registry.get("w1").unwrap();
        assert_eq!(got.worker_id, "w1");
    }

    #[test]
    fn test_remove() {
        let registry = PeerRegistry::new();
        registry.register(make_peer("w1", vec![]));
        assert_eq!(registry.peer_count(), 1);

        registry.remove("w1");
        assert_eq!(registry.peer_count(), 0);
        assert!(registry.get("w1").is_none());
    }

    #[test]
    fn test_peers_with_capability() {
        let registry = PeerRegistry::new();
        registry.register(make_peer("w1", vec![TaskType::TextCompletion, TaskType::Embeddings]));
        registry.register(make_peer("w2", vec![TaskType::Embeddings]));
        registry.register(make_peer("w3", vec![TaskType::Classification]));

        let text_peers = registry.peers_with_capability(TaskType::TextCompletion);
        assert_eq!(text_peers.len(), 1);

        let embed_peers = registry.peers_with_capability(TaskType::Embeddings);
        assert_eq!(embed_peers.len(), 2);
    }

    #[test]
    fn test_update_status() {
        let registry = PeerRegistry::new();
        registry.register(make_peer("w1", vec![]));

        registry.update_status("w1", WorkerStatus::Busy);
        let peer = registry.get("w1").unwrap();
        assert_eq!(peer.status, WorkerStatus::Busy);
    }

    #[test]
    fn test_groups() {
        let registry = PeerRegistry::new();
        registry.register(make_peer("w1", vec![]));
        registry.register(make_peer("w2", vec![]));

        registry.add_to_group("w1", "group-1");
        registry.add_to_group("w2", "group-1");
        registry.add_to_group("w2", "group-2");

        let g1_peers = registry.peers_in_group("group-1");
        assert_eq!(g1_peers.len(), 2);

        let g2_peers = registry.peers_in_group("group-2");
        assert_eq!(g2_peers.len(), 1);

        registry.remove_from_group("w1", "group-1");
        let g1_peers = registry.peers_in_group("group-1");
        assert_eq!(g1_peers.len(), 1);
    }

    #[test]
    fn test_prune_stale() {
        let registry = PeerRegistry::new();
        let mut stale_peer = make_peer("stale", vec![]);
        stale_peer.last_seen = Instant::now() - Duration::from_secs(120);
        registry.register(stale_peer);
        registry.register(make_peer("fresh", vec![]));

        let pruned = registry.prune_stale(Duration::from_secs(60));
        assert_eq!(pruned.len(), 1);
        assert_eq!(pruned[0], "stale");
        assert_eq!(registry.peer_count(), 1);
    }
}
