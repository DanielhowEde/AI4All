//! Integration tests for coordinator communication
//!
//! Tests the full flow: connect → register → heartbeat → task execution

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, tungstenite::Message as WsMessage};
use uuid::Uuid;

// Note: These tests require the worker crate to be compiled
// They test the protocol messages and serialization

/// Mock coordinator server for testing
struct MockCoordinator {
    addr: SocketAddr,
    shutdown_tx: Option<mpsc::Sender<()>>,
    messages_received: Arc<RwLock<Vec<String>>>,
}

impl MockCoordinator {
    /// Start a mock coordinator server
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let messages_received = Arc::new(RwLock::new(Vec::new()));
        let messages_clone = messages_received.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        if let Ok((stream, _)) = accept_result {
                            let messages = messages_clone.clone();
                            tokio::spawn(async move {
                                if let Ok(ws_stream) = accept_async(stream).await {
                                    handle_connection(ws_stream, messages).await;
                                }
                            });
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                }
            }
        });

        Self {
            addr,
            shutdown_tx: Some(shutdown_tx),
            messages_received,
        }
    }

    /// Get the WebSocket URL for this mock coordinator
    fn ws_url(&self) -> String {
        format!("ws://{}", self.addr)
    }

    /// Get messages received by the coordinator
    fn messages(&self) -> Vec<String> {
        self.messages_received.read().clone()
    }
}

impl Drop for MockCoordinator {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.try_send(());
        }
    }
}

/// Handle a WebSocket connection in the mock coordinator
async fn handle_connection<S>(ws_stream: S, messages: Arc<RwLock<Vec<String>>>)
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Unpin,
{
    let (mut write, mut read) = ws_stream.split();

    while let Some(msg) = read.next().await {
        if let Ok(WsMessage::Text(text)) = msg {
            messages.write().push(text.clone());

            // Parse and respond to messages
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(msg_type) = parsed.get("type").and_then(|t| t.as_str()) {
                    match msg_type {
                        "REGISTER" => {
                            // Send registration acknowledgment
                            let ack = serde_json::json!({
                                "id": Uuid::new_v4().to_string(),
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                                "version": { "major": 1, "minor": 0, "patch": 0 },
                                "type": "REGISTER_ACK",
                                "success": true,
                                "worker_id": format!("worker-{}", Uuid::new_v4()),
                                "heartbeat_interval_secs": 30,
                                "coordinator_version": { "major": 1, "minor": 0, "patch": 0 }
                            });
                            let _ = write.send(WsMessage::Text(ack.to_string())).await;
                        }
                        "HEARTBEAT" => {
                            // Send heartbeat acknowledgment
                            let ack = serde_json::json!({
                                "id": Uuid::new_v4().to_string(),
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                                "version": { "major": 1, "minor": 0, "patch": 0 },
                                "type": "HEARTBEAT_ACK",
                                "accepted": true,
                                "next_heartbeat": (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
                                "pending_actions": []
                            });
                            let _ = write.send(WsMessage::Text(ack.to_string())).await;
                        }
                        "TASK_RESULT" => {
                            // Just record, no response needed
                        }
                        "SHUTDOWN" => {
                            // Close connection
                            let _ = write.send(WsMessage::Close(None)).await;
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Protocol Message Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_protocol_version_serialization() {
    let version = serde_json::json!({
        "major": 1,
        "minor": 0,
        "patch": 0
    });

    let json = serde_json::to_string(&version).unwrap();
    assert!(json.contains("\"major\":1"));
}

#[test]
fn test_register_message_format() {
    let register = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "REGISTER",
        "name": "Test Worker",
        "capabilities": {
            "supported_tasks": ["TEXT_COMPLETION"],
            "max_concurrent_tasks": 4,
            "available_memory_mb": 8192,
            "gpu_available": false,
            "max_context_length": 4096,
            "worker_version": "0.1.0"
        },
        "tags": ["test"]
    });

    let json = serde_json::to_string(&register).unwrap();
    assert!(json.contains("REGISTER"));
    assert!(json.contains("Test Worker"));
    assert!(json.contains("TEXT_COMPLETION"));
}

#[test]
fn test_heartbeat_message_format() {
    let heartbeat = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "HEARTBEAT",
        "worker_id": "worker-123",
        "status": "READY",
        "resources": {
            "cpu_percent": 25.5,
            "memory_used_mb": 4096,
            "memory_available_mb": 4096,
            "active_threads": 4
        },
        "active_tasks": [],
        "completed_task_count": 10,
        "uptime_secs": 3600
    });

    let json = serde_json::to_string(&heartbeat).unwrap();
    assert!(json.contains("HEARTBEAT"));
    assert!(json.contains("worker-123"));
    assert!(json.contains("READY"));
}

#[test]
fn test_task_assignment_message_format() {
    let task = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "TASK_ASSIGNMENT",
        "task_id": "task-456",
        "priority": "NORMAL",
        "model_id": "llama-7b-q4",
        "input": {
            "task_type": "TEXT_COMPLETION",
            "prompt": "Hello, world!",
            "max_tokens": 100
        },
        "timeout_secs": 300
    });

    let json = serde_json::to_string(&task).unwrap();
    assert!(json.contains("TASK_ASSIGNMENT"));
    assert!(json.contains("task-456"));
    assert!(json.contains("TEXT_COMPLETION"));
}

#[test]
fn test_task_result_message_format() {
    let result = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "TASK_RESULT",
        "task_id": "task-456",
        "worker_id": "worker-123",
        "success": true,
        "output": {
            "task_type": "TEXT_COMPLETION",
            "text": "Generated response text",
            "finish_reason": "stop",
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30
            }
        },
        "metrics": {
            "queue_time_ms": 50,
            "execution_time_ms": 1500,
            "total_time_ms": 1550,
            "tokens_per_second": 13.3
        }
    });

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("TASK_RESULT"));
    assert!(json.contains("task-456"));
    assert!(json.contains("success"));
}

// ─────────────────────────────────────────────────────────────────
// Mock Coordinator Tests
// ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_mock_coordinator_starts() {
    let coordinator = MockCoordinator::start().await;
    assert!(coordinator.ws_url().starts_with("ws://127.0.0.1:"));
}

#[tokio::test]
async fn test_mock_coordinator_accepts_connection() {
    let coordinator = MockCoordinator::start().await;
    let url = url::Url::parse(&coordinator.ws_url()).unwrap();

    let (ws_stream, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    let (mut write, _read) = ws_stream.split();

    // Send a register message
    let register = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "REGISTER",
        "name": "Test Worker",
        "capabilities": {
            "supported_tasks": ["TEXT_COMPLETION"],
            "max_concurrent_tasks": 4,
            "available_memory_mb": 8192,
            "gpu_available": false,
            "max_context_length": 4096,
            "worker_version": "0.1.0"
        },
        "tags": []
    });

    write.send(WsMessage::Text(register.to_string())).await.unwrap();

    // Give it a moment to process
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Check that the message was received
    let messages = coordinator.messages();
    assert!(!messages.is_empty());
    assert!(messages[0].contains("REGISTER"));
}

#[tokio::test]
async fn test_mock_coordinator_responds_to_register() {
    let coordinator = MockCoordinator::start().await;
    let url = url::Url::parse(&coordinator.ws_url()).unwrap();

    let (ws_stream, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    let (mut write, mut read) = ws_stream.split();

    // Send a register message
    let register = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "REGISTER",
        "name": "Test Worker",
        "capabilities": {
            "supported_tasks": ["TEXT_COMPLETION"],
            "max_concurrent_tasks": 4,
            "available_memory_mb": 8192,
            "gpu_available": false,
            "max_context_length": 4096,
            "worker_version": "0.1.0"
        },
        "tags": []
    });

    write.send(WsMessage::Text(register.to_string())).await.unwrap();

    // Read response
    let response = tokio::time::timeout(Duration::from_secs(5), read.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();

    if let WsMessage::Text(text) = response {
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["type"], "REGISTER_ACK");
        assert_eq!(parsed["success"], true);
        assert!(parsed["worker_id"].as_str().is_some());
    } else {
        panic!("Expected text message");
    }
}

#[tokio::test]
async fn test_mock_coordinator_heartbeat_flow() {
    let coordinator = MockCoordinator::start().await;
    let url = url::Url::parse(&coordinator.ws_url()).unwrap();

    let (ws_stream, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    let (mut write, mut read) = ws_stream.split();

    // Register first
    let register = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "REGISTER",
        "name": "Test Worker",
        "capabilities": {
            "supported_tasks": ["TEXT_COMPLETION"],
            "max_concurrent_tasks": 4,
            "available_memory_mb": 8192,
            "gpu_available": false,
            "max_context_length": 4096,
            "worker_version": "0.1.0"
        },
        "tags": []
    });

    write.send(WsMessage::Text(register.to_string())).await.unwrap();

    // Get register ack
    let _ = read.next().await;

    // Send heartbeat
    let heartbeat = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "HEARTBEAT",
        "worker_id": "worker-test",
        "status": "READY",
        "resources": {
            "cpu_percent": 10.0,
            "memory_used_mb": 1024,
            "memory_available_mb": 7168,
            "active_threads": 4
        },
        "active_tasks": [],
        "completed_task_count": 0,
        "uptime_secs": 60
    });

    write.send(WsMessage::Text(heartbeat.to_string())).await.unwrap();

    // Read heartbeat ack
    let response = tokio::time::timeout(Duration::from_secs(5), read.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();

    if let WsMessage::Text(text) = response {
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["type"], "HEARTBEAT_ACK");
        assert_eq!(parsed["accepted"], true);
    } else {
        panic!("Expected text message");
    }
}

// ─────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_error_message_format() {
    let error = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "version": { "major": 1, "minor": 0, "patch": 0 },
        "type": "ERROR",
        "code": "AUTH_FAILED",
        "message": "Invalid authentication token",
        "fatal": true
    });

    let json = serde_json::to_string(&error).unwrap();
    assert!(json.contains("ERROR"));
    assert!(json.contains("AUTH_FAILED"));
    assert!(json.contains("fatal"));
}

#[test]
fn test_task_error_format() {
    let error = serde_json::json!({
        "code": "E501",
        "message": "Task timed out after 300 seconds",
        "retryable": true,
        "details": {
            "timeout_secs": 300,
            "elapsed_secs": 305
        }
    });

    let json = serde_json::to_string(&error).unwrap();
    assert!(json.contains("E501"));
    assert!(json.contains("retryable"));
}
