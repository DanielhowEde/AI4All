//! WebSocket client for coordinator communication
//!
//! Provides a robust WebSocket client with:
//! - Automatic reconnection with exponential backoff
//! - Heartbeat management
//! - Message queuing during disconnection

use std::sync::Arc;
use std::time::{Duration, Instant};

use backoff::{backoff::Backoff, ExponentialBackoff};
use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error as WsError, Message as WsMessage},
};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::error::{Error, Result};
use crate::protocol::{
    HeartbeatAckResponse, HeartbeatRequest, Message, MessageEnvelope,
    RegisterAckResponse, RegisterRequest, ResourceUsageReport,
    TaskResultMessage, WorkerCapabilities, WorkerStatus,
};

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for the coordinator client
#[derive(Debug, Clone)]
pub struct CoordinatorClientConfig {
    /// WebSocket URL of the coordinator
    pub url: String,

    /// Connection timeout
    pub connect_timeout: Duration,

    /// Maximum reconnection attempts (0 = infinite)
    pub max_reconnect_attempts: u32,

    /// Initial reconnect delay
    pub initial_reconnect_delay: Duration,

    /// Maximum reconnect delay
    pub max_reconnect_delay: Duration,

    /// Heartbeat interval
    pub heartbeat_interval: Duration,

    /// Message queue size
    pub message_queue_size: usize,
}

impl Default for CoordinatorClientConfig {
    fn default() -> Self {
        Self {
            url: "wss://coordinator.ai4all.network".to_string(),
            connect_timeout: Duration::from_secs(30),
            max_reconnect_attempts: 0, // Infinite
            initial_reconnect_delay: Duration::from_secs(1),
            max_reconnect_delay: Duration::from_secs(60),
            heartbeat_interval: Duration::from_secs(30),
            message_queue_size: 100,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Connection State
// ─────────────────────────────────────────────────────────────────

/// Connection state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    /// Not connected
    Disconnected,
    /// Attempting to connect
    Connecting,
    /// Connected but not registered
    Connected,
    /// Registered and ready
    Registered,
    /// Connection error, will retry
    Reconnecting,
    /// Shutting down
    ShuttingDown,
}

impl Default for ConnectionState {
    fn default() -> Self {
        ConnectionState::Disconnected
    }
}

// ─────────────────────────────────────────────────────────────────
// Client State
// ─────────────────────────────────────────────────────────────────

/// Internal client state
struct ClientState {
    /// Current connection state
    connection_state: ConnectionState,

    /// Assigned worker ID (after registration)
    worker_id: Option<String>,

    /// Session token (from coordinator)
    session_token: Option<String>,

    /// Last successful heartbeat time
    last_heartbeat: Option<Instant>,

    /// Current worker status
    worker_status: WorkerStatus,

    /// Reconnection attempt count
    reconnect_attempts: u32,

    /// Connection start time
    connected_at: Option<Instant>,
}

impl Default for ClientState {
    fn default() -> Self {
        Self {
            connection_state: ConnectionState::Disconnected,
            worker_id: None,
            session_token: None,
            last_heartbeat: None,
            worker_status: WorkerStatus::Ready,
            reconnect_attempts: 0,
            connected_at: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Command Channel
// ─────────────────────────────────────────────────────────────────

/// Commands that can be sent to the client
#[derive(Debug)]
pub enum ClientCommand {
    /// Send a message to the coordinator
    Send(MessageEnvelope),

    /// Update worker status
    UpdateStatus(WorkerStatus),

    /// Submit task result
    SubmitResult(TaskResultMessage),

    /// Initiate graceful shutdown
    Shutdown,

    /// Get current connection state
    GetState(oneshot::Sender<ConnectionState>),
}

// ─────────────────────────────────────────────────────────────────
// Event Channel
// ─────────────────────────────────────────────────────────────────

/// Events emitted by the client
#[derive(Debug, Clone)]
pub enum ClientEvent {
    /// Connected to coordinator
    Connected,

    /// Disconnected from coordinator
    Disconnected { reason: String },

    /// Successfully registered
    Registered { worker_id: String },

    /// Received task assignment
    TaskAssigned(crate::protocol::TaskAssignmentMessage),

    /// Received task cancellation
    TaskCancelled { task_id: String, reason: String },

    /// Received configuration update
    ConfigUpdate(serde_json::Value),

    /// Error occurred
    Error { message: String, fatal: bool },

    /// Heartbeat acknowledged
    HeartbeatAck,

    /// Reconnecting
    Reconnecting { attempt: u32 },
}

// ─────────────────────────────────────────────────────────────────
// Coordinator Client
// ─────────────────────────────────────────────────────────────────

/// WebSocket client for coordinator communication
pub struct CoordinatorClient {
    config: CoordinatorClientConfig,
    state: Arc<RwLock<ClientState>>,
    command_tx: mpsc::Sender<ClientCommand>,
    event_rx: Option<mpsc::Receiver<ClientEvent>>,
    worker_name: String,
    worker_capabilities: WorkerCapabilities,
}

impl CoordinatorClient {
    /// Create a new coordinator client
    pub fn new(
        config: CoordinatorClientConfig,
        worker_name: String,
        worker_capabilities: WorkerCapabilities,
    ) -> Self {
        let (command_tx, _command_rx) = mpsc::channel(config.message_queue_size);

        Self {
            config,
            state: Arc::new(RwLock::new(ClientState::default())),
            command_tx,
            event_rx: None,
            worker_name,
            worker_capabilities,
        }
    }

    /// Start the client and return event receiver
    pub async fn start(&mut self) -> Result<mpsc::Receiver<ClientEvent>> {
        let (event_tx, event_rx) = mpsc::channel(self.config.message_queue_size);
        let (command_tx, command_rx) = mpsc::channel(self.config.message_queue_size);

        self.command_tx = command_tx;

        // Spawn the connection task
        let config = self.config.clone();
        let state = self.state.clone();
        let worker_name = self.worker_name.clone();
        let capabilities = self.worker_capabilities.clone();

        tokio::spawn(async move {
            run_client_loop(config, state, command_rx, event_tx, worker_name, capabilities).await;
        });

        Ok(event_rx)
    }

    /// Send a command to the client
    pub async fn send_command(&self, command: ClientCommand) -> Result<()> {
        self.command_tx
            .send(command)
            .await
            .map_err(|_| Error::Connection("Client channel closed".to_string()))
    }

    /// Get current connection state
    pub fn connection_state(&self) -> ConnectionState {
        self.state.read().connection_state
    }

    /// Get assigned worker ID
    pub fn worker_id(&self) -> Option<String> {
        self.state.read().worker_id.clone()
    }

    /// Check if connected and registered
    pub fn is_ready(&self) -> bool {
        self.state.read().connection_state == ConnectionState::Registered
    }

    /// Submit a task result
    pub async fn submit_result(&self, result: TaskResultMessage) -> Result<()> {
        self.send_command(ClientCommand::SubmitResult(result)).await
    }

    /// Update worker status
    pub async fn update_status(&self, status: WorkerStatus) -> Result<()> {
        self.send_command(ClientCommand::UpdateStatus(status)).await
    }

    /// Request graceful shutdown
    pub async fn shutdown(&self) -> Result<()> {
        self.send_command(ClientCommand::Shutdown).await
    }
}

// ─────────────────────────────────────────────────────────────────
// Client Loop
// ─────────────────────────────────────────────────────────────────

/// Main client loop with reconnection logic
async fn run_client_loop(
    config: CoordinatorClientConfig,
    state: Arc<RwLock<ClientState>>,
    mut command_rx: mpsc::Receiver<ClientCommand>,
    event_tx: mpsc::Sender<ClientEvent>,
    worker_name: String,
    capabilities: WorkerCapabilities,
) {
    let url = match Url::parse(&config.url) {
        Ok(u) => u,
        Err(e) => {
            error!(url = %config.url, error = %e, "Invalid coordinator URL");
            let _ = event_tx.send(ClientEvent::Error {
                message: format!("Invalid URL: {}", e),
                fatal: true,
            }).await;
            return;
        }
    };

    // Create exponential backoff for reconnection
    let mut backoff = ExponentialBackoff {
        initial_interval: config.initial_reconnect_delay,
        max_interval: config.max_reconnect_delay,
        max_elapsed_time: None, // Retry forever
        ..Default::default()
    };

    loop {
        // Check if we should shutdown
        {
            let s = state.read();
            if s.connection_state == ConnectionState::ShuttingDown {
                info!("Client shutdown requested");
                break;
            }
        }

        // Update state to connecting
        {
            let mut s = state.write();
            s.connection_state = ConnectionState::Connecting;
        }

        info!(url = %url, "Connecting to coordinator");

        // Attempt connection
        match connect_async(url.clone()).await {
            Ok((ws_stream, _response)) => {
                info!("WebSocket connection established");

                // Reset backoff on successful connection
                backoff.reset();
                {
                    let mut s = state.write();
                    s.connection_state = ConnectionState::Connected;
                    s.connected_at = Some(Instant::now());
                    s.reconnect_attempts = 0;
                }

                let _ = event_tx.send(ClientEvent::Connected).await;

                // Split the WebSocket stream
                let (write, read) = ws_stream.split();

                // Run the connection handler
                let result = handle_connection(
                    &config,
                    &state,
                    &mut command_rx,
                    &event_tx,
                    write,
                    read,
                    &worker_name,
                    &capabilities,
                ).await;

                if let Err(e) = result {
                    warn!(error = %e, "Connection error");
                    let _ = event_tx.send(ClientEvent::Disconnected {
                        reason: e.to_string(),
                    }).await;
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to connect to coordinator");
                let _ = event_tx.send(ClientEvent::Error {
                    message: format!("Connection failed: {}", e),
                    fatal: false,
                }).await;
            }
        }

        // Update state to reconnecting
        {
            let mut s = state.write();
            s.connection_state = ConnectionState::Reconnecting;
            s.reconnect_attempts += 1;
            s.worker_id = None;
            s.session_token = None;
        }

        // Check max reconnect attempts
        let attempts = state.read().reconnect_attempts;
        if config.max_reconnect_attempts > 0 && attempts >= config.max_reconnect_attempts {
            error!(
                attempts = attempts,
                max = config.max_reconnect_attempts,
                "Max reconnection attempts reached"
            );
            let _ = event_tx.send(ClientEvent::Error {
                message: "Max reconnection attempts reached".to_string(),
                fatal: true,
            }).await;
            break;
        }

        // Calculate next retry delay
        let delay = backoff.next_backoff().unwrap_or(config.max_reconnect_delay);

        let _ = event_tx.send(ClientEvent::Reconnecting {
            attempt: attempts,
        }).await;

        info!(
            delay_secs = delay.as_secs(),
            attempt = attempts,
            "Waiting before reconnection"
        );

        // Wait before reconnecting (also check for shutdown commands)
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            Some(cmd) = command_rx.recv() => {
                if matches!(cmd, ClientCommand::Shutdown) {
                    let mut s = state.write();
                    s.connection_state = ConnectionState::ShuttingDown;
                    break;
                }
            }
        }
    }

    info!("Client loop terminated");
}

/// Handle an active WebSocket connection
async fn handle_connection<S, R>(
    config: &CoordinatorClientConfig,
    state: &Arc<RwLock<ClientState>>,
    command_rx: &mut mpsc::Receiver<ClientCommand>,
    event_tx: &mpsc::Sender<ClientEvent>,
    mut write: S,
    mut read: R,
    worker_name: &str,
    capabilities: &WorkerCapabilities,
) -> Result<()>
where
    S: SinkExt<WsMessage, Error = WsError> + Unpin,
    R: StreamExt<Item = std::result::Result<WsMessage, WsError>> + Unpin,
{
    // Send registration message
    let register_msg = Message::Register(RegisterRequest {
        worker_id: state.read().worker_id.clone(),
        name: worker_name.to_string(),
        capabilities: capabilities.clone(),
        tags: vec![],
        auth_token: None,
    });

    send_message(&mut write, register_msg).await?;
    debug!("Sent registration request");

    // Wait for registration acknowledgment
    let registered = wait_for_registration(&mut read, state, event_tx).await?;
    if !registered {
        return Err(Error::AuthenticationFailed {
            message: "Registration rejected".to_string(),
        });
    }

    // Start heartbeat timer
    let heartbeat_interval = config.heartbeat_interval;
    let mut heartbeat_timer = tokio::time::interval(heartbeat_interval);
    heartbeat_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    // Main message loop
    loop {
        tokio::select! {
            // Heartbeat tick
            _ = heartbeat_timer.tick() => {
                let worker_id = state.read().worker_id.clone()
                    .unwrap_or_else(|| "unknown".to_string());

                let heartbeat = Message::Heartbeat(HeartbeatRequest {
                    worker_id,
                    status: state.read().worker_status,
                    resources: ResourceUsageReport::default(), // TODO: Get actual usage
                    active_tasks: vec![], // TODO: Track active tasks
                    completed_task_count: 0, // TODO: Track completed count
                    uptime_secs: state.read().connected_at
                        .map(|t| t.elapsed().as_secs())
                        .unwrap_or(0),
                });

                if let Err(e) = send_message(&mut write, heartbeat).await {
                    warn!(error = %e, "Failed to send heartbeat");
                    return Err(e);
                }
                debug!("Sent heartbeat");
            }

            // Incoming message from coordinator
            msg = read.next() => {
                match msg {
                    Some(Ok(WsMessage::Text(text))) => {
                        match MessageEnvelope::from_json(&text) {
                            Ok(envelope) => {
                                handle_incoming_message(envelope, state, event_tx).await?;
                            }
                            Err(e) => {
                                warn!(error = %e, "Failed to parse message");
                            }
                        }
                    }
                    Some(Ok(WsMessage::Binary(data))) => {
                        match MessageEnvelope::from_json_bytes(&data) {
                            Ok(envelope) => {
                                handle_incoming_message(envelope, state, event_tx).await?;
                            }
                            Err(e) => {
                                warn!(error = %e, "Failed to parse binary message");
                            }
                        }
                    }
                    Some(Ok(WsMessage::Ping(data))) => {
                        write.send(WsMessage::Pong(data)).await?;
                    }
                    Some(Ok(WsMessage::Pong(_))) => {
                        // Ignore pong
                    }
                    Some(Ok(WsMessage::Close(frame))) => {
                        info!(frame = ?frame, "Received close frame");
                        return Ok(());
                    }
                    Some(Err(e)) => {
                        error!(error = %e, "WebSocket error");
                        return Err(Error::Connection(e.to_string()));
                    }
                    None => {
                        info!("WebSocket stream ended");
                        return Ok(());
                    }
                    _ => {}
                }
            }

            // Command from application
            cmd = command_rx.recv() => {
                match cmd {
                    Some(ClientCommand::Send(envelope)) => {
                        let json = envelope.to_json()
                            .map_err(|e| Error::Protocol(e.to_string()))?;
                        write.send(WsMessage::Text(json)).await?;
                    }
                    Some(ClientCommand::UpdateStatus(status)) => {
                        state.write().worker_status = status;
                    }
                    Some(ClientCommand::SubmitResult(result)) => {
                        let msg = Message::TaskResult(result);
                        send_message(&mut write, msg).await?;
                    }
                    Some(ClientCommand::Shutdown) => {
                        info!("Shutdown command received");
                        let worker_id = state.read().worker_id.clone()
                            .unwrap_or_else(|| "unknown".to_string());

                        let shutdown_msg = Message::Shutdown(crate::protocol::ShutdownMessage {
                            worker_id,
                            reason: "Graceful shutdown".to_string(),
                            graceful: true,
                            abandoned_tasks: vec![],
                        });
                        let _ = send_message(&mut write, shutdown_msg).await;

                        // Send close frame
                        let _ = write.send(WsMessage::Close(None)).await;
                        state.write().connection_state = ConnectionState::ShuttingDown;
                        return Ok(());
                    }
                    Some(ClientCommand::GetState(tx)) => {
                        let _ = tx.send(state.read().connection_state);
                    }
                    None => {
                        info!("Command channel closed");
                        return Ok(());
                    }
                }
            }
        }
    }
}

/// Send a protocol message
async fn send_message<S>(write: &mut S, msg: Message) -> Result<()>
where
    S: SinkExt<WsMessage, Error = WsError> + Unpin,
{
    let envelope = MessageEnvelope::new(msg);
    let json = envelope.to_json().map_err(|e| Error::Protocol(e.to_string()))?;
    write.send(WsMessage::Text(json)).await
        .map_err(|e| Error::Connection(e.to_string()))
}

/// Wait for registration acknowledgment
async fn wait_for_registration<R>(
    read: &mut R,
    state: &Arc<RwLock<ClientState>>,
    event_tx: &mpsc::Sender<ClientEvent>,
) -> Result<bool>
where
    R: StreamExt<Item = std::result::Result<WsMessage, WsError>> + Unpin,
{
    // Wait for registration response (with timeout)
    let timeout = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(WsMessage::Text(text)) => {
                    if let Ok(envelope) = MessageEnvelope::from_json(&text) {
                        if let Message::RegisterAck(ack) = envelope.payload {
                            return Ok(ack);
                        }
                        if let Message::Error(err) = envelope.payload {
                            return Err(Error::AuthenticationFailed {
                                message: err.message,
                            });
                        }
                    }
                }
                Ok(WsMessage::Close(_)) => {
                    return Err(Error::Connection("Connection closed during registration".to_string()));
                }
                Err(e) => {
                    return Err(Error::Connection(e.to_string()));
                }
                _ => {}
            }
        }
        Err(Error::Connection("Stream ended during registration".to_string()))
    });

    let ack = timeout.await
        .map_err(|_| Error::ConnectionTimeout {
            url: "coordinator".to_string(),
            timeout_secs: 30,
        })??;

    if ack.success {
        // Update state within a scope to ensure guard is dropped before await
        let worker_id_clone = {
            let mut s = state.write();
            s.worker_id = Some(ack.worker_id.clone());
            s.session_token = ack.session_token;
            s.connection_state = ConnectionState::Registered;
            ack.worker_id.clone()
        };

        info!(worker_id = %worker_id_clone, "Registration successful");
        let _ = event_tx.send(ClientEvent::Registered {
            worker_id: worker_id_clone,
        }).await;

        Ok(true)
    } else {
        let error_msg = ack.error.unwrap_or_else(|| "Unknown error".to_string());
        error!(error = %error_msg, "Registration failed");
        let _ = event_tx.send(ClientEvent::Error {
            message: error_msg,
            fatal: true,
        }).await;

        Ok(false)
    }
}

/// Handle incoming message from coordinator
async fn handle_incoming_message(
    envelope: MessageEnvelope,
    state: &Arc<RwLock<ClientState>>,
    event_tx: &mpsc::Sender<ClientEvent>,
) -> Result<()> {
    debug!(message_type = %envelope.payload.type_name(), "Received message");

    match envelope.payload {
        Message::HeartbeatAck(ack) => {
            state.write().last_heartbeat = Some(Instant::now());
            let _ = event_tx.send(ClientEvent::HeartbeatAck).await;
        }

        Message::TaskAssignment(task) => {
            info!(task_id = %task.task_id, "Received task assignment");
            let _ = event_tx.send(ClientEvent::TaskAssigned(task)).await;
        }

        Message::TaskCancel(cancel) => {
            info!(task_id = %cancel.task_id, reason = %cancel.reason, "Task cancelled");
            let _ = event_tx.send(ClientEvent::TaskCancelled {
                task_id: cancel.task_id,
                reason: cancel.reason,
            }).await;
        }

        Message::ConfigUpdate(update) => {
            info!("Received configuration update");
            let _ = event_tx.send(ClientEvent::ConfigUpdate(update.config)).await;
        }

        Message::Error(err) => {
            error!(code = %err.code, message = %err.message, fatal = err.fatal, "Received error");
            let _ = event_tx.send(ClientEvent::Error {
                message: err.message,
                fatal: err.fatal,
            }).await;
        }

        _ => {
            debug!(message_type = %envelope.payload.type_name(), "Unhandled message type");
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TaskType;

    #[test]
    fn test_config_default() {
        let config = CoordinatorClientConfig::default();
        assert_eq!(config.heartbeat_interval, Duration::from_secs(30));
        assert_eq!(config.max_reconnect_attempts, 0);
    }

    #[test]
    fn test_connection_state_default() {
        assert_eq!(ConnectionState::default(), ConnectionState::Disconnected);
    }

    #[test]
    fn test_client_state_default() {
        let state = ClientState::default();
        assert_eq!(state.connection_state, ConnectionState::Disconnected);
        assert!(state.worker_id.is_none());
        assert_eq!(state.worker_status, WorkerStatus::Ready);
    }

    #[test]
    fn test_worker_capabilities() {
        let caps = WorkerCapabilities {
            supported_tasks: vec![TaskType::TextCompletion, TaskType::Embeddings],
            max_concurrent_tasks: 4,
            available_memory_mb: 16384,
            gpu_available: true,
            gpu_device: Some("NVIDIA RTX 4090".to_string()),
            gpu_memory_mb: Some(24576),
            max_context_length: 8192,
            worker_version: "0.1.0".to_string(),
        };

        let json = serde_json::to_string(&caps).unwrap();
        assert!(json.contains("TEXT_COMPLETION"));
        assert!(json.contains("RTX 4090"));
    }
}
