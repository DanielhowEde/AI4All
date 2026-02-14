//! Protocol message definitions
//!
//! All message types for worker-coordinator communication.
//! Messages are serialized as JSON with a type discriminator.

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::types::{TaskInput, TaskOutput, TaskType};
use super::ProtocolVersion;

// ─────────────────────────────────────────────────────────────────
// Message Envelope
// ─────────────────────────────────────────────────────────────────

/// Wrapper for all protocol messages with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEnvelope {
    /// Unique message ID
    pub id: Uuid,

    /// Message timestamp
    pub timestamp: DateTime<Utc>,

    /// Protocol version
    pub version: ProtocolVersion,

    /// The actual message payload
    #[serde(flatten)]
    pub payload: Message,
}

impl MessageEnvelope {
    /// Create a new message envelope
    pub fn new(payload: Message) -> Self {
        Self {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            version: ProtocolVersion::default(),
            payload,
        }
    }

    /// Create envelope with specific version
    pub fn with_version(payload: Message, version: ProtocolVersion) -> Self {
        Self {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            version,
            payload,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Message Types (Discriminated Union)
// ─────────────────────────────────────────────────────────────────

/// All protocol messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Message {
    // ─── Worker → Coordinator ───────────────────────────────────
    /// Worker registration request
    Register(RegisterRequest),

    /// Worker heartbeat
    Heartbeat(HeartbeatRequest),

    /// Task result submission
    TaskResult(TaskResultMessage),

    /// Worker status update
    StatusUpdate(StatusUpdateMessage),

    /// Worker graceful shutdown notification
    Shutdown(ShutdownMessage),

    // ─── Coordinator → Worker ───────────────────────────────────
    /// Registration acknowledgment
    RegisterAck(RegisterAckResponse),

    /// Heartbeat acknowledgment
    HeartbeatAck(HeartbeatAckResponse),

    /// Task assignment
    TaskAssignment(TaskAssignmentMessage),

    /// Task cancellation request
    TaskCancel(TaskCancelMessage),

    /// Configuration update from coordinator
    ConfigUpdate(ConfigUpdateMessage),

    /// Error response
    Error(ErrorMessage),

    // ─── Persona / Governance ────────────────────────────────────
    /// Persona registration announcement (worker → coordinator)
    PersonaRegister(PersonaRegisterMessage),
}

impl Message {
    /// Get the message type name
    pub fn type_name(&self) -> &'static str {
        match self {
            Message::Register(_) => "REGISTER",
            Message::RegisterAck(_) => "REGISTER_ACK",
            Message::Heartbeat(_) => "HEARTBEAT",
            Message::HeartbeatAck(_) => "HEARTBEAT_ACK",
            Message::TaskAssignment(_) => "TASK_ASSIGNMENT",
            Message::TaskResult(_) => "TASK_RESULT",
            Message::TaskCancel(_) => "TASK_CANCEL",
            Message::StatusUpdate(_) => "STATUS_UPDATE",
            Message::ConfigUpdate(_) => "CONFIG_UPDATE",
            Message::Shutdown(_) => "SHUTDOWN",
            Message::Error(_) => "ERROR",
            Message::PersonaRegister(_) => "PERSONA_REGISTER",
        }
    }

    /// Check if this is a request message (worker → coordinator)
    pub fn is_request(&self) -> bool {
        matches!(
            self,
            Message::Register(_)
                | Message::Heartbeat(_)
                | Message::TaskResult(_)
                | Message::StatusUpdate(_)
                | Message::Shutdown(_)
                | Message::PersonaRegister(_)
        )
    }

    /// Check if this is a response message (coordinator → worker)
    pub fn is_response(&self) -> bool {
        !self.is_request()
    }
}

// ─────────────────────────────────────────────────────────────────
// Registration Messages
// ─────────────────────────────────────────────────────────────────

/// Worker capabilities for registration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerCapabilities {
    /// Supported task types
    pub supported_tasks: Vec<TaskType>,

    /// Maximum concurrent tasks
    pub max_concurrent_tasks: u32,

    /// Available memory (MB)
    pub available_memory_mb: u64,

    /// Whether GPU is available
    pub gpu_available: bool,

    /// GPU device name (if available)
    #[serde(default)]
    pub gpu_device: Option<String>,

    /// GPU memory (MB, if available)
    #[serde(default)]
    pub gpu_memory_mb: Option<u64>,

    /// Maximum context length supported
    pub max_context_length: u32,

    /// Worker software version
    pub worker_version: String,
}

/// Worker registration request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterRequest {
    /// Worker ID (may be assigned by coordinator if empty)
    #[serde(default)]
    pub worker_id: Option<String>,

    /// Human-readable worker name
    pub name: String,

    /// Worker capabilities
    pub capabilities: WorkerCapabilities,

    /// Worker tags for task routing
    #[serde(default)]
    pub tags: Vec<String>,

    /// Authentication token (if required)
    #[serde(default)]
    pub auth_token: Option<String>,
}

/// Registration acknowledgment from coordinator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterAckResponse {
    /// Whether registration was successful
    pub success: bool,

    /// Assigned worker ID
    pub worker_id: String,

    /// Session token for subsequent requests
    #[serde(default)]
    pub session_token: Option<String>,

    /// Heartbeat interval (seconds)
    pub heartbeat_interval_secs: u32,

    /// Coordinator's protocol version
    pub coordinator_version: ProtocolVersion,

    /// Any error message
    #[serde(default)]
    pub error: Option<String>,
}

// ─────────────────────────────────────────────────────────────────
// Heartbeat Messages
// ─────────────────────────────────────────────────────────────────

/// Worker resource usage for heartbeat
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceUsageReport {
    /// CPU usage percentage (0-100)
    pub cpu_percent: f32,

    /// Memory used (MB)
    pub memory_used_mb: u64,

    /// Memory available (MB)
    pub memory_available_mb: u64,

    /// GPU usage percentage (0-100)
    #[serde(default)]
    pub gpu_percent: Option<f32>,

    /// GPU memory used (MB)
    #[serde(default)]
    pub gpu_memory_used_mb: Option<u64>,

    /// Number of active inference threads
    pub active_threads: u32,
}

/// Heartbeat request from worker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatRequest {
    /// Worker ID
    pub worker_id: String,

    /// Current worker status
    pub status: WorkerStatus,

    /// Current resource usage
    pub resources: ResourceUsageReport,

    /// Currently executing tasks
    pub active_tasks: Vec<String>,

    /// Tasks completed since last heartbeat
    #[serde(default)]
    pub completed_task_count: u32,

    /// Uptime in seconds
    pub uptime_secs: u64,
}

/// Worker status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkerStatus {
    /// Ready to accept tasks
    Ready,
    /// Currently processing tasks
    Busy,
    /// Temporarily paused (not accepting new tasks)
    Paused,
    /// Draining (finishing current tasks, then shutdown)
    Draining,
    /// Error state
    Error,
}

impl Default for WorkerStatus {
    fn default() -> Self {
        WorkerStatus::Ready
    }
}

/// Heartbeat acknowledgment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatAckResponse {
    /// Whether heartbeat was accepted
    pub accepted: bool,

    /// Next expected heartbeat (timestamp)
    pub next_heartbeat: DateTime<Utc>,

    /// Any pending actions for the worker
    #[serde(default)]
    pub pending_actions: Vec<PendingAction>,
}

/// Actions the coordinator wants the worker to take
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PendingAction {
    /// Cancel a specific task
    CancelTask { task_id: String },
    /// Pause accepting new tasks
    Pause,
    /// Resume accepting tasks
    Resume,
    /// Update configuration
    UpdateConfig { config: serde_json::Value },
    /// Graceful shutdown
    Shutdown { reason: String },
}

// ─────────────────────────────────────────────────────────────────
// Task Messages
// ─────────────────────────────────────────────────────────────────

/// Task priority levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

impl Default for TaskPriority {
    fn default() -> Self {
        TaskPriority::Normal
    }
}

/// Task assignment from coordinator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskAssignmentMessage {
    /// Unique task ID
    pub task_id: String,

    /// Block ID (for AI4All block assignments)
    #[serde(default)]
    pub block_id: Option<String>,

    /// Day ID for this task
    #[serde(default)]
    pub day_id: Option<String>,

    /// Task priority
    #[serde(default)]
    pub priority: TaskPriority,

    /// Task deadline (if any)
    #[serde(default)]
    pub deadline: Option<DateTime<Utc>>,

    /// Model to use (model ID or path)
    pub model_id: String,

    /// The actual task input
    pub input: TaskInput,

    /// Whether this is a canary/validation task
    #[serde(default)]
    pub is_canary: bool,

    /// Expected hash for canary tasks
    #[serde(default)]
    pub expected_hash: Option<String>,

    /// Maximum execution time (seconds)
    #[serde(default = "default_timeout")]
    pub timeout_secs: u32,
}

fn default_timeout() -> u32 { 300 } // 5 minutes

/// Task result submission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResultMessage {
    /// Task ID this result is for
    pub task_id: String,

    /// Worker ID
    pub worker_id: String,

    /// Whether task completed successfully
    pub success: bool,

    /// Task output (if successful)
    #[serde(default)]
    pub output: Option<TaskOutput>,

    /// Error message (if failed)
    #[serde(default)]
    pub error: Option<TaskError>,

    /// Execution metrics
    pub metrics: TaskMetrics,
}

/// Task error details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskError {
    /// Error code
    pub code: String,

    /// Human-readable message
    pub message: String,

    /// Whether the task is retryable
    pub retryable: bool,

    /// Additional details
    #[serde(default)]
    pub details: Option<serde_json::Value>,
}

/// Task execution metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskMetrics {
    /// Time spent queued (ms)
    pub queue_time_ms: u64,

    /// Time spent executing (ms)
    pub execution_time_ms: u64,

    /// Total time from assignment to completion (ms)
    pub total_time_ms: u64,

    /// Tokens processed (for inference tasks)
    #[serde(default)]
    pub tokens_processed: Option<u32>,

    /// Tokens per second (throughput)
    #[serde(default)]
    pub tokens_per_second: Option<f32>,

    /// Peak memory usage (MB)
    #[serde(default)]
    pub peak_memory_mb: Option<u64>,

    /// Peak GPU memory usage (MB)
    #[serde(default)]
    pub peak_gpu_memory_mb: Option<u64>,
}

/// Task cancellation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCancelMessage {
    /// Task ID to cancel
    pub task_id: String,

    /// Reason for cancellation
    pub reason: String,

    /// Whether to force immediate cancellation
    #[serde(default)]
    pub force: bool,
}

// ─────────────────────────────────────────────────────────────────
// Status & Control Messages
// ─────────────────────────────────────────────────────────────────

/// Worker status update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusUpdateMessage {
    /// Worker ID
    pub worker_id: String,

    /// New status
    pub status: WorkerStatus,

    /// Reason for status change
    #[serde(default)]
    pub reason: Option<String>,
}

/// Configuration update from coordinator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigUpdateMessage {
    /// Configuration key-value pairs
    pub config: serde_json::Value,

    /// Whether to persist the configuration
    #[serde(default)]
    pub persist: bool,
}

/// Worker shutdown notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownMessage {
    /// Worker ID
    pub worker_id: String,

    /// Reason for shutdown
    pub reason: String,

    /// Whether this is a graceful shutdown
    pub graceful: bool,

    /// Tasks that were in progress (will need reassignment)
    #[serde(default)]
    pub abandoned_tasks: Vec<String>,
}

/// Error message from coordinator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMessage {
    /// Error code
    pub code: String,

    /// Human-readable message
    pub message: String,

    /// Related message ID (if this is in response to a specific message)
    #[serde(default)]
    pub related_message_id: Option<Uuid>,

    /// Whether the error is fatal (connection should be closed)
    #[serde(default)]
    pub fatal: bool,
}

// ─────────────────────────────────────────────────────────────────
// Persona / Governance Messages
// ─────────────────────────────────────────────────────────────────

/// Persona registration message sent when a worker identifies its governance role
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaRegisterMessage {
    /// Worker ID
    pub worker_id: String,

    /// Persona type slug (master-ba, project-ba, coder, tester)
    pub persona_type: String,

    /// Persona config version
    pub persona_version: String,

    /// Governance level
    pub governance_level: String,

    /// Capabilities summary
    pub capabilities: PersonaCapabilitiesSummary,
}

/// Summary of persona capabilities for coordinator awareness
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaCapabilitiesSummary {
    pub can_create_projects: bool,
    pub can_create_milestones: bool,
    pub can_approve_milestones: bool,
    pub can_assign_work: bool,
    pub can_submit_work: bool,
    pub can_verify_work: bool,
}

// ─────────────────────────────────────────────────────────────────
// Message Helpers
// ─────────────────────────────────────────────────────────────────

impl MessageEnvelope {
    /// Serialize to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Serialize to pretty JSON string
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Deserialize from JSON string
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Deserialize from JSON bytes
    pub fn from_json_bytes(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(bytes)
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{GenerationParams, TextCompletionInput};

    #[test]
    fn test_register_message_serialize() {
        let msg = Message::Register(RegisterRequest {
            worker_id: Some("worker-1".to_string()),
            name: "Test Worker".to_string(),
            capabilities: WorkerCapabilities {
                supported_tasks: vec![TaskType::TextCompletion],
                max_concurrent_tasks: 4,
                available_memory_mb: 8192,
                gpu_available: false,
                gpu_device: None,
                gpu_memory_mb: None,
                max_context_length: 4096,
                worker_version: "0.1.0".to_string(),
            },
            tags: vec!["test".to_string()],
            auth_token: None,
        });

        let envelope = MessageEnvelope::new(msg);
        let json = envelope.to_json().unwrap();

        assert!(json.contains("REGISTER"));
        assert!(json.contains("worker-1"));
        assert!(json.contains("Test Worker"));
    }

    #[test]
    fn test_heartbeat_message() {
        let msg = Message::Heartbeat(HeartbeatRequest {
            worker_id: "worker-1".to_string(),
            status: WorkerStatus::Ready,
            resources: ResourceUsageReport {
                cpu_percent: 25.5,
                memory_used_mb: 4096,
                memory_available_mb: 4096,
                gpu_percent: None,
                gpu_memory_used_mb: None,
                active_threads: 4,
            },
            active_tasks: vec![],
            completed_task_count: 0,
            uptime_secs: 3600,
        });

        let envelope = MessageEnvelope::new(msg);
        let json = envelope.to_json().unwrap();
        let parsed = MessageEnvelope::from_json(&json).unwrap();

        match parsed.payload {
            Message::Heartbeat(hb) => {
                assert_eq!(hb.worker_id, "worker-1");
                assert_eq!(hb.status, WorkerStatus::Ready);
            }
            _ => panic!("Expected Heartbeat message"),
        }
    }

    #[test]
    fn test_task_assignment_message() {
        let input = TaskInput::TextCompletion(TextCompletionInput {
            prompt: "Hello, world!".to_string(),
            system_prompt: None,
            params: GenerationParams::default(),
        });

        let msg = Message::TaskAssignment(TaskAssignmentMessage {
            task_id: "task-123".to_string(),
            block_id: Some("block-456".to_string()),
            day_id: Some("2026-01-30".to_string()),
            priority: TaskPriority::High,
            deadline: None,
            model_id: "llama-7b".to_string(),
            input,
            is_canary: false,
            expected_hash: None,
            timeout_secs: 300,
        });

        let envelope = MessageEnvelope::new(msg);
        let json = envelope.to_json().unwrap();

        assert!(json.contains("TASK_ASSIGNMENT"));
        assert!(json.contains("task-123"));
        assert!(json.contains("llama-7b"));
    }

    #[test]
    fn test_worker_status_values() {
        assert_eq!(
            serde_json::to_string(&WorkerStatus::Ready).unwrap(),
            "\"READY\""
        );
        assert_eq!(
            serde_json::to_string(&WorkerStatus::Busy).unwrap(),
            "\"BUSY\""
        );
    }

    #[test]
    fn test_message_type_name() {
        let msg = Message::Register(RegisterRequest {
            worker_id: None,
            name: "Test".to_string(),
            capabilities: WorkerCapabilities {
                supported_tasks: vec![],
                max_concurrent_tasks: 1,
                available_memory_mb: 1024,
                gpu_available: false,
                gpu_device: None,
                gpu_memory_mb: None,
                max_context_length: 4096,
                worker_version: "0.1.0".to_string(),
            },
            tags: vec![],
            auth_token: None,
        });

        assert_eq!(msg.type_name(), "REGISTER");
        assert!(msg.is_request());
        assert!(!msg.is_response());
    }

    #[test]
    fn test_error_message() {
        let msg = Message::Error(ErrorMessage {
            code: "AUTH_FAILED".to_string(),
            message: "Invalid token".to_string(),
            related_message_id: Some(Uuid::new_v4()),
            fatal: true,
        });

        let envelope = MessageEnvelope::new(msg);
        let json = envelope.to_json().unwrap();

        assert!(json.contains("ERROR"));
        assert!(json.contains("AUTH_FAILED"));
    }
}
