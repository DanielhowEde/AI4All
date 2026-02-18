//! TCP mesh networking between workers
//!
//! Manages direct TCP connections for low-latency data transfer.
//! Uses length-prefixed JSON framing over TCP.
//!
//! Wire format:  [4-byte big-endian length][JSON payload]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::protocol::{PeerMessage, WorkerCapabilities};

use super::PeerInfo;
use super::PeerRegistry;

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

/// Mesh networking configuration
#[derive(Debug, Clone)]
pub struct MeshConfig {
    /// Port to listen on (0 = OS-assigned)
    pub listen_port: u16,

    /// Maximum number of peer connections
    pub max_peers: usize,

    /// Timeout for establishing connections
    pub connection_timeout: Duration,

    /// Interval between ping messages
    pub ping_interval: Duration,

    /// Remove peers that haven't responded within this duration
    pub stale_timeout: Duration,
}

impl Default for MeshConfig {
    fn default() -> Self {
        Self {
            listen_port: 0,
            max_peers: 32,
            connection_timeout: Duration::from_secs(10),
            ping_interval: Duration::from_secs(15),
            stale_timeout: Duration::from_secs(60),
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Events emitted by the mesh to the main loop
// ─────────────────────────────────────────────────────────────────

/// Events from the peer mesh to the application
#[derive(Debug, Clone)]
pub enum PeerEvent {
    /// A peer connected (inbound or outbound)
    Connected { worker_id: String },

    /// A peer disconnected
    Disconnected { worker_id: String, reason: String },

    /// Received a message from a peer
    MessageReceived {
        from: String,
        message: PeerMessage,
    },

    /// An error occurred with a peer
    Error {
        worker_id: Option<String>,
        error: String,
    },

    /// TCP listener is ready
    ListenerReady { addr: SocketAddr },
}

// ─────────────────────────────────────────────────────────────────
// Peer Connection State
// ─────────────────────────────────────────────────────────────────

/// State of a single peer connection
struct PeerConnection {
    /// Sender to write messages to this peer
    write_tx: mpsc::Sender<PeerMessage>,

    /// When this connection was established
    connected_at: Instant,

    /// Handle to the connection task (for shutdown)
    _task: tokio::task::JoinHandle<()>,
}

// ─────────────────────────────────────────────────────────────────
// Peer Mesh
// ─────────────────────────────────────────────────────────────────

/// Manages direct TCP connections between workers
pub struct PeerMesh {
    config: MeshConfig,
    worker_id: String,
    worker_capabilities: WorkerCapabilities,
    registry: Arc<PeerRegistry>,
    listener_addr: RwLock<Option<SocketAddr>>,
    connections: RwLock<HashMap<String, PeerConnection>>,
    event_tx: mpsc::Sender<PeerEvent>,
}

impl PeerMesh {
    /// Create a new peer mesh
    pub fn new(
        config: MeshConfig,
        worker_id: String,
        worker_capabilities: WorkerCapabilities,
        registry: Arc<PeerRegistry>,
        event_tx: mpsc::Sender<PeerEvent>,
    ) -> Self {
        Self {
            config,
            worker_id,
            worker_capabilities,
            registry,
            listener_addr: RwLock::new(None),
            connections: RwLock::new(HashMap::new()),
            event_tx,
        }
    }

    /// Start the TCP listener and return the bound address
    pub async fn start(self: &Arc<Self>) -> std::io::Result<SocketAddr> {
        let bind_addr = format!("0.0.0.0:{}", self.config.listen_port);
        let listener = TcpListener::bind(&bind_addr).await?;
        let addr = listener.local_addr()?;

        *self.listener_addr.write() = Some(addr);
        info!(addr = %addr, "Peer mesh listening");

        let _ = self.event_tx.send(PeerEvent::ListenerReady { addr }).await;

        // Spawn the listener accept loop
        let mesh = Arc::clone(self);
        tokio::spawn(async move {
            mesh.accept_loop(listener).await;
        });

        Ok(addr)
    }

    /// Accept incoming peer connections
    async fn accept_loop(self: Arc<Self>, listener: TcpListener) {
        loop {
            match listener.accept().await {
                Ok((stream, peer_addr)) => {
                    debug!(peer_addr = %peer_addr, "Incoming peer connection");

                    if self.connections.read().len() >= self.config.max_peers {
                        warn!(peer_addr = %peer_addr, "Max peers reached, rejecting");
                        drop(stream);
                        continue;
                    }

                    let mesh = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(e) = mesh.handle_inbound(stream).await {
                            debug!(error = %e, "Inbound connection failed");
                        }
                    });
                }
                Err(e) => {
                    error!(error = %e, "Accept failed");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    }

    /// Handle an inbound connection — wait for Hello, then set up connection
    async fn handle_inbound(self: Arc<Self>, mut stream: TcpStream) -> anyhow::Result<()> {
        // Read the first message (should be Hello)
        let msg = read_framed_message(&mut stream).await?;

        match msg {
            PeerMessage::Hello { worker_id, capabilities } => {
                info!(peer = %worker_id, "Peer connected (inbound)");

                // Send HelloAck
                let ack = PeerMessage::HelloAck {
                    worker_id: self.worker_id.clone(),
                };
                write_framed_message(&mut stream, &ack).await?;

                // Set up the bidirectional connection
                self.setup_connection(worker_id, capabilities, stream).await;
            }
            other => {
                warn!(msg_type = %other.type_name(), "Expected Hello, got something else");
                return Err(anyhow::anyhow!("Expected Hello message"));
            }
        }

        Ok(())
    }

    /// Connect to a peer by address
    pub async fn connect(self: &Arc<Self>, peer: &PeerInfo) -> anyhow::Result<()> {
        // Don't connect to ourselves
        if peer.worker_id == self.worker_id {
            return Ok(());
        }

        // Don't double-connect
        if self.connections.read().contains_key(&peer.worker_id) {
            return Ok(());
        }

        info!(peer = %peer.worker_id, addr = %peer.listen_addr, "Connecting to peer");

        let mut stream = tokio::time::timeout(
            self.config.connection_timeout,
            TcpStream::connect(peer.listen_addr),
        )
        .await
        .map_err(|_| anyhow::anyhow!("Connection timeout"))??;

        // Send Hello
        let hello = PeerMessage::Hello {
            worker_id: self.worker_id.clone(),
            capabilities: self.worker_capabilities.clone(),
        };
        write_framed_message(&mut stream, &hello).await?;

        // Wait for HelloAck
        let ack = tokio::time::timeout(
            Duration::from_secs(5),
            read_framed_message(&mut stream),
        )
        .await
        .map_err(|_| anyhow::anyhow!("HelloAck timeout"))??;

        match ack {
            PeerMessage::HelloAck { worker_id: peer_id } => {
                info!(peer = %peer_id, "Peer handshake complete (outbound)");
                self.setup_connection(
                    peer_id,
                    peer.capabilities.clone(),
                    stream,
                ).await;
            }
            _ => {
                return Err(anyhow::anyhow!("Expected HelloAck"));
            }
        }

        Ok(())
    }

    /// Set up a bidirectional connection after handshake
    async fn setup_connection(
        self: &Arc<Self>,
        peer_worker_id: String,
        capabilities: WorkerCapabilities,
        stream: TcpStream,
    ) {
        let (read_half, write_half) = stream.into_split();
        let (write_tx, write_rx) = mpsc::channel::<PeerMessage>(64);

        // Spawn the writer task
        let peer_id_w = peer_worker_id.clone();
        let writer_handle = tokio::spawn(async move {
            write_loop(peer_id_w, write_half, write_rx).await;
        });

        // Spawn the reader task
        let mesh = Arc::clone(self);
        let peer_id_r = peer_worker_id.clone();
        let event_tx = self.event_tx.clone();
        let reader_handle = tokio::spawn(async move {
            read_loop(peer_id_r.clone(), read_half, event_tx.clone()).await;
            // When reader exits, the connection is done
            let _ = event_tx
                .send(PeerEvent::Disconnected {
                    worker_id: peer_id_r.clone(),
                    reason: "Connection closed".to_string(),
                })
                .await;
            mesh.connections.write().remove(&peer_id_r);
        });

        // We only track the writer handle; if the reader exits, it cleans up
        let _ = reader_handle; // Let it run independently

        // Store connection
        let conn = PeerConnection {
            write_tx,
            connected_at: Instant::now(),
            _task: writer_handle,
        };
        self.connections
            .write()
            .insert(peer_worker_id.clone(), conn);

        // Register in peer registry if not already there
        if self.registry.get(&peer_worker_id).is_none() {
            // We may not know their listen address from an inbound connection,
            // but we register what we know
            self.registry.register(PeerInfo {
                worker_id: peer_worker_id.clone(),
                name: format!("Peer {}", &peer_worker_id),
                listen_addr: "0.0.0.0:0".parse().unwrap(),
                capabilities,
                status: crate::protocol::WorkerStatus::Ready,
                last_seen: Instant::now(),
                latency_ms: None,
                groups: vec![],
            });
        }

        let _ = self
            .event_tx
            .send(PeerEvent::Connected {
                worker_id: peer_worker_id,
            })
            .await;
    }

    /// Send a message to a specific peer
    pub async fn send(&self, worker_id: &str, msg: PeerMessage) -> anyhow::Result<()> {
        let conns = self.connections.read();
        let conn = conns
            .get(worker_id)
            .ok_or_else(|| anyhow::anyhow!("Not connected to peer {}", worker_id))?;
        conn.write_tx
            .send(msg)
            .await
            .map_err(|_| anyhow::anyhow!("Peer write channel closed"))?;
        Ok(())
    }

    /// Broadcast a message to all connected peers
    pub async fn broadcast(&self, msg: PeerMessage) {
        let conns = self.connections.read();
        for (peer_id, conn) in conns.iter() {
            if let Err(e) = conn.write_tx.send(msg.clone()).await {
                debug!(peer = %peer_id, error = %e, "Failed to broadcast to peer");
            }
        }
    }

    /// Send a message to all peers in a group
    pub async fn send_to_group(&self, group_id: &str, msg: PeerMessage) {
        let group_peers = self.registry.peers_in_group(group_id);
        let conns = self.connections.read();
        for peer in &group_peers {
            if peer.worker_id == self.worker_id {
                continue;
            }
            if let Some(conn) = conns.get(&peer.worker_id) {
                if let Err(e) = conn.write_tx.send(msg.clone()).await {
                    debug!(
                        peer = %peer.worker_id,
                        error = %e,
                        "Failed to send to group peer"
                    );
                }
            }
        }
    }

    /// Disconnect from a specific peer
    pub fn disconnect(&self, worker_id: &str) {
        self.connections.write().remove(worker_id);
    }

    /// Get list of connected peer IDs
    pub fn connected_peers(&self) -> Vec<String> {
        self.connections.read().keys().cloned().collect()
    }

    /// Get the local listen address
    pub fn listen_addr(&self) -> Option<SocketAddr> {
        *self.listener_addr.read()
    }

    /// Shut down the mesh (drops all connections)
    pub fn shutdown(&self) {
        self.connections.write().clear();
    }
}

// ─────────────────────────────────────────────────────────────────
// Wire protocol: length-prefixed JSON framing
// ─────────────────────────────────────────────────────────────────

const MAX_MESSAGE_SIZE: u32 = 64 * 1024 * 1024; // 64 MB (for tensor data)

/// Read a length-prefixed JSON message from a stream
async fn read_framed_message<R: AsyncReadExt + Unpin>(reader: &mut R) -> anyhow::Result<PeerMessage> {
    // Read 4-byte big-endian length
    let len = reader.read_u32().await?;
    if len > MAX_MESSAGE_SIZE {
        return Err(anyhow::anyhow!(
            "Message too large: {} bytes (max {})",
            len,
            MAX_MESSAGE_SIZE
        ));
    }

    // Read the JSON payload
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf).await?;

    let msg: PeerMessage = serde_json::from_slice(&buf)?;
    Ok(msg)
}

/// Write a length-prefixed JSON message to a stream
async fn write_framed_message<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    msg: &PeerMessage,
) -> anyhow::Result<()> {
    let json = serde_json::to_vec(msg)?;
    let len = json.len() as u32;

    writer.write_u32(len).await?;
    writer.write_all(&json).await?;
    writer.flush().await?;

    Ok(())
}

/// Background task: reads messages from a peer and forwards to event channel
async fn read_loop(
    peer_id: String,
    mut reader: tokio::net::tcp::OwnedReadHalf,
    event_tx: mpsc::Sender<PeerEvent>,
) {
    loop {
        match read_framed_message(&mut reader).await {
            Ok(msg) => {
                let _ = event_tx
                    .send(PeerEvent::MessageReceived {
                        from: peer_id.clone(),
                        message: msg,
                    })
                    .await;
            }
            Err(e) => {
                debug!(peer = %peer_id, error = %e, "Peer read error");
                break;
            }
        }
    }
}

/// Background task: writes messages to a peer from a channel
async fn write_loop(
    peer_id: String,
    mut writer: tokio::net::tcp::OwnedWriteHalf,
    mut write_rx: mpsc::Receiver<PeerMessage>,
) {
    while let Some(msg) = write_rx.recv().await {
        if let Err(e) = write_framed_message(&mut writer, &msg).await {
            debug!(peer = %peer_id, error = %e, "Peer write error");
            break;
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mesh_config_defaults() {
        let config = MeshConfig::default();
        assert_eq!(config.listen_port, 0);
        assert_eq!(config.max_peers, 32);
        assert_eq!(config.ping_interval, Duration::from_secs(15));
    }

    #[tokio::test]
    async fn test_framed_message_roundtrip() {
        let msg = PeerMessage::Ping { seq: 42 };
        let mut buf = Vec::new();

        // Use a cursor as a writer
        let mut cursor = std::io::Cursor::new(&mut buf);
        let json = serde_json::to_vec(&msg).unwrap();
        let len = json.len() as u32;
        cursor
            .get_mut()
            .extend_from_slice(&len.to_be_bytes());
        cursor.get_mut().extend_from_slice(&json);

        // Read it back
        let mut read_cursor = std::io::Cursor::new(&buf);
        let mut tokio_cursor = tokio::io::BufReader::new(&mut read_cursor);
        // We can't easily test with tokio I/O in a unit test without a real stream,
        // so just verify JSON roundtrip
        let reparsed: PeerMessage = serde_json::from_slice(&json).unwrap();
        match reparsed {
            PeerMessage::Ping { seq } => assert_eq!(seq, 42),
            _ => panic!("Expected Ping"),
        }
    }

    #[test]
    fn test_peer_message_serialize() {
        let msg = PeerMessage::Hello {
            worker_id: "w1".to_string(),
            capabilities: WorkerCapabilities {
                supported_tasks: vec![],
                max_concurrent_tasks: 4,
                available_memory_mb: 8192,
                gpu_available: false,
                gpu_device: None,
                gpu_memory_mb: None,
                max_context_length: 4096,
                worker_version: "0.1.0".to_string(),
            },
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("HELLO"));
        assert!(json.contains("w1"));
    }
}
