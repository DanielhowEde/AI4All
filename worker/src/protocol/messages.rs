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

    // ─── Peer Discovery (via Coordinator) ─────────────────────────
    /// Worker announces its P2P listen address
    PeerDiscover(PeerDiscoverMessage),

    /// Coordinator sends directory of available peers
    PeerDirectory(PeerDirectoryMessage),

    /// Coordinator assigns worker to a group
    GroupAssigned(GroupAssignedMessage),

    /// Coordinator updates group membership
    GroupUpdate(GroupUpdateMessage),
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
            Message::PeerDiscover(_) => "PEER_DISCOVER",
            Message::PeerDirectory(_) => "PEER_DIRECTORY",
            Message::GroupAssigned(_) => "GROUP_ASSIGNED",
            Message::GroupUpdate(_) => "GROUP_UPDATE",
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
                | Message::PeerDiscover(_)
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
// Peer Discovery Messages (via Coordinator)
// ─────────────────────────────────────────────────────────────────

/// Worker announces its P2P listen address to the coordinator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerDiscoverMessage {
    /// Worker ID
    pub worker_id: String,

    /// TCP address for direct peer connections (e.g. "192.168.1.10:9100")
    pub listen_addr: String,

    /// Worker capabilities
    pub capabilities: WorkerCapabilities,
}

/// Directory of peers from the coordinator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerDirectoryMessage {
    /// List of available peers
    pub peers: Vec<PeerDirectoryEntry>,
}

/// A single peer entry in the directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerDirectoryEntry {
    /// Worker ID
    pub worker_id: String,

    /// Human-readable name
    pub name: String,

    /// Direct TCP address for P2P connections
    pub listen_addr: String,

    /// Worker capabilities
    pub capabilities: WorkerCapabilities,

    /// Current status
    pub status: WorkerStatus,
}

/// Coordinator assigns a worker to a group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupAssignedMessage {
    /// Group ID
    pub group_id: String,

    /// Purpose of the group
    pub purpose: GroupPurposeMessage,

    /// Members of the group
    pub members: Vec<GroupMemberMessage>,
}

/// Group purpose description for wire format
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GroupPurposeMessage {
    ModelShard {
        model_id: String,
        total_shards: u32,
    },
    TaskPipeline {
        pipeline_id: String,
        stages: Vec<TaskType>,
    },
    General,
}

/// Group member info for wire format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMemberMessage {
    pub worker_id: String,
    pub role: String,
    #[serde(default)]
    pub shard_index: Option<u32>,
    #[serde(default)]
    pub pipeline_stage: Option<u32>,
}

/// Coordinator sends group membership update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupUpdateMessage {
    /// Group ID
    pub group_id: String,

    /// Updated member list
    pub members: Vec<GroupMemberMessage>,

    /// Whether the group is being disbanded
    #[serde(default)]
    pub disbanded: bool,
}

// ─────────────────────────────────────────────────────────────────
// Peer-to-Peer Messages (Direct TCP between workers)
// ─────────────────────────────────────────────────────────────────

/// Messages sent directly between workers over TCP mesh
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PeerMessage {
    // ─── Handshake ──────────────────────────────────────────────
    /// Initial hello when connecting to a peer
    Hello {
        worker_id: String,
        capabilities: WorkerCapabilities,
    },

    /// Acknowledgment of hello
    HelloAck {
        worker_id: String,
    },

    // ─── Health / Status ────────────────────────────────────────
    /// Ping for latency measurement
    Ping { seq: u64 },

    /// Pong response
    Pong { seq: u64 },

    /// Status update broadcast
    PeerStatus {
        status: WorkerStatus,
        active_tasks: u32,
        /// Available capacity as percentage (0.0 - 1.0)
        capacity_pct: f32,
    },

    // ─── Task Collaboration ─────────────────────────────────────
    /// Offer a task to a peer (work redistribution)
    TaskOffer {
        task_id: String,
        task_type: TaskType,
        priority: u32,
    },

    /// Accept a task offer
    TaskAccept {
        task_id: String,
    },

    /// Reject a task offer
    TaskReject {
        task_id: String,
        reason: String,
    },

    /// Send raw data for a task (intermediate results, tensors)
    TaskData {
        task_id: String,
        #[serde(with = "base64_bytes")]
        data: Vec<u8>,
    },

    /// Forward a task result to a peer
    TaskResultForward {
        task_id: String,
        output: TaskOutput,
    },

    // ─── Model Sharding ─────────────────────────────────────────
    /// Assign a model shard to this peer
    ShardAssign {
        group_id: String,
        model_id: String,
        shard_index: u32,
        total_shards: u32,
    },

    /// Signal that a shard is loaded and ready
    ShardReady {
        group_id: String,
        shard_index: u32,
    },

    /// Send tensor data to the next shard in the pipeline
    ShardInput {
        group_id: String,
        layer_start: u32,
        #[serde(with = "base64_bytes")]
        tensor_data: Vec<u8>,
    },

    /// Receive tensor output from a shard
    ShardOutput {
        group_id: String,
        layer_end: u32,
        #[serde(with = "base64_bytes")]
        tensor_data: Vec<u8>,
    },

    // ─── Pipeline Collaboration ─────────────────────────────────
    /// Send input to the next stage in a task pipeline
    PipelineInput {
        group_id: String,
        stage: u32,
        task_id: String,
        input: TaskInput,
    },

    /// Send output from a pipeline stage
    PipelineOutput {
        group_id: String,
        stage: u32,
        task_id: String,
        output: TaskOutput,
    },

    // ─── Group Coordination ─────────────────────────────────────
    /// Join a work group
    GroupJoin {
        group_id: String,
        role: String,
    },

    /// Leave a work group
    GroupLeave {
        group_id: String,
    },

    /// Synchronize group state
    GroupSync {
        group_id: String,
        state: serde_json::Value,
    },
}

impl PeerMessage {
    /// Get the message type name
    pub fn type_name(&self) -> &'static str {
        match self {
            PeerMessage::Hello { .. } => "HELLO",
            PeerMessage::HelloAck { .. } => "HELLO_ACK",
            PeerMessage::Ping { .. } => "PING",
            PeerMessage::Pong { .. } => "PONG",
            PeerMessage::PeerStatus { .. } => "PEER_STATUS",
            PeerMessage::TaskOffer { .. } => "TASK_OFFER",
            PeerMessage::TaskAccept { .. } => "TASK_ACCEPT",
            PeerMessage::TaskReject { .. } => "TASK_REJECT",
            PeerMessage::TaskData { .. } => "TASK_DATA",
            PeerMessage::TaskResultForward { .. } => "TASK_RESULT_FORWARD",
            PeerMessage::ShardAssign { .. } => "SHARD_ASSIGN",
            PeerMessage::ShardReady { .. } => "SHARD_READY",
            PeerMessage::ShardInput { .. } => "SHARD_INPUT",
            PeerMessage::ShardOutput { .. } => "SHARD_OUTPUT",
            PeerMessage::PipelineInput { .. } => "PIPELINE_INPUT",
            PeerMessage::PipelineOutput { .. } => "PIPELINE_OUTPUT",
            PeerMessage::GroupJoin { .. } => "GROUP_JOIN",
            PeerMessage::GroupLeave { .. } => "GROUP_LEAVE",
            PeerMessage::GroupSync { .. } => "GROUP_SYNC",
        }
    }
}

/// Helper module for base64 serialization of byte vectors
mod base64_bytes {
    use serde::{Deserialize, Deserializer, Serializer};
    use serde::de;

    pub fn serialize<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        use base64::Engine;
        let s = String::deserialize(deserializer)?;
        base64::engine::general_purpose::STANDARD
            .decode(&s)
            .map_err(de::Error::custom)
    }
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
