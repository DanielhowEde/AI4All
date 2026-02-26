//! Task execution runner
//!
//! Handles task dispatch to backends and result collection.

use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use tokio::sync::mpsc;
use tokio::sync::RwLock as TokioRwLock;
use tracing::{error, info};

use crate::backend::{BackendRegistry, InferenceBackend};
use crate::error::{Error, Result};
use crate::protocol::{
    TaskAssignmentMessage, TaskError, TaskResultMessage,
};
use crate::types::{TaskInput, TaskOutput, TaskType};

use super::TaskTracker;

// ─────────────────────────────────────────────────────────────────
// Executor Configuration
// ─────────────────────────────────────────────────────────────────

/// Configuration for the task executor
#[derive(Debug, Clone)]
pub struct ExecutorConfig {
    /// Maximum concurrent tasks
    pub max_concurrent_tasks: usize,

    /// Default task timeout (seconds)
    pub default_timeout_secs: u32,

    /// Whether to track detailed metrics
    pub detailed_metrics: bool,

    /// Queue size for pending tasks
    pub queue_size: usize,
}

impl Default for ExecutorConfig {
    fn default() -> Self {
        Self {
            max_concurrent_tasks: 4,
            default_timeout_secs: 300,
            detailed_metrics: true,
            queue_size: 100,
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Task Executor
// ─────────────────────────────────────────────────────────────────

/// Handles task execution and result submission
pub struct TaskExecutor {
    config: ExecutorConfig,
    tracker: Arc<TaskTracker>,
    registry: Arc<RwLock<BackendRegistry>>,
    result_tx: mpsc::Sender<TaskResultMessage>,
    worker_id: String,
}

impl TaskExecutor {
    /// Create a new task executor
    pub fn new(
        config: ExecutorConfig,
        registry: Arc<RwLock<BackendRegistry>>,
        worker_id: String,
    ) -> (Self, mpsc::Receiver<TaskResultMessage>) {
        let (result_tx, result_rx) = mpsc::channel(config.queue_size);
        let tracker = Arc::new(TaskTracker::new(config.max_concurrent_tasks));

        (
            Self {
                config,
                tracker,
                registry,
                result_tx,
                worker_id,
            },
            result_rx,
        )
    }

    /// Submit a task for execution
    pub async fn submit(&self, assignment: TaskAssignmentMessage) -> Result<()> {
        // Check if we can accept the task
        if !self.tracker.can_accept() {
            return Err(Error::ResourceLimit(
                "Maximum concurrent tasks reached".to_string()
            ));
        }

        // Check if we support this task type
        let task_type = assignment.input.task_type();
        if !self.can_handle_task_type(task_type) {
            return Err(Error::NotSupported(
                format!("Task type {:?} not supported by any loaded backend", task_type)
            ));
        }

        // Add to tracker
        let task_id = assignment.task_id.clone();
        if !self.tracker.add_task(assignment.clone()) {
            return Err(Error::ResourceLimit(
                "Failed to add task to tracker".to_string()
            ));
        }

        info!(task_id = %task_id, task_type = %task_type, "Task queued for execution");

        // Spawn execution task
        let tracker = self.tracker.clone();
        let registry = self.registry.clone();
        let result_tx = self.result_tx.clone();
        let worker_id = self.worker_id.clone();
        let timeout_secs = assignment.timeout_secs;

        tokio::spawn(async move {
            execute_task(
                assignment,
                tracker,
                registry,
                result_tx,
                worker_id,
                timeout_secs,
            ).await;
        });

        Ok(())
    }

    /// Cancel a running task
    pub fn cancel(&self, task_id: &str) -> bool {
        self.tracker.cancel_task(task_id)
    }

    /// Check if we can handle a task type
    fn can_handle_task_type(&self, task_type: TaskType) -> bool {
        let registry = self.registry.read();
        registry.backends()
            .iter()
            .any(|b| b.blocking_read().capabilities().supported_tasks.contains(&task_type))
    }

    /// Get active task IDs
    pub fn active_tasks(&self) -> Vec<String> {
        self.tracker.active_task_ids()
    }

    /// Get running task count
    pub fn running_count(&self) -> usize {
        self.tracker.running_count()
    }

    /// Get queued task count
    pub fn queued_count(&self) -> usize {
        self.tracker.queued_count()
    }

    /// Check if executor can accept more tasks
    pub fn can_accept(&self) -> bool {
        self.tracker.can_accept()
    }

    /// Get total completed count
    pub fn completed_count(&self) -> u64 {
        self.tracker.total_completed()
    }

    /// Get total failed count
    pub fn failed_count(&self) -> u64 {
        self.tracker.total_failed()
    }

    /// Get task tracker reference
    pub fn tracker(&self) -> Arc<TaskTracker> {
        self.tracker.clone()
    }
}

// ─────────────────────────────────────────────────────────────────
// Task Execution
// ─────────────────────────────────────────────────────────────────

/// Execute a single task
async fn execute_task(
    assignment: TaskAssignmentMessage,
    tracker: Arc<TaskTracker>,
    registry: Arc<RwLock<BackendRegistry>>,
    result_tx: mpsc::Sender<TaskResultMessage>,
    worker_id: String,
    timeout_secs: u32,
) {
    let task_id = assignment.task_id.clone();
    let start_time = Instant::now();

    // Mark as running
    tracker.mark_running(&task_id);
    info!(task_id = %task_id, "Starting task execution");

    // Execute with timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs as u64),
        run_inference(&assignment, &registry),
    ).await;

    // Build result message
    let result_msg = match result {
        Ok(Ok(output)) => {
            tracker.mark_completed(&task_id);
            let metrics = tracker.get_metrics(&task_id).unwrap_or_default();

            info!(
                task_id = %task_id,
                execution_time_ms = metrics.execution_time_ms,
                "Task completed successfully"
            );

            TaskResultMessage {
                task_id: task_id.clone(),
                worker_id,
                success: true,
                output: Some(output),
                error: None,
                metrics,
            }
        }
        Ok(Err(e)) => {
            let error_msg = e.to_string();
            tracker.mark_failed(&task_id, error_msg.clone());
            let metrics = tracker.get_metrics(&task_id).unwrap_or_default();

            error!(task_id = %task_id, error = %e, "Task execution failed");

            TaskResultMessage {
                task_id: task_id.clone(),
                worker_id,
                success: false,
                output: None,
                error: Some(TaskError {
                    code: format!("E{}", e.code() as u16),
                    message: error_msg,
                    retryable: e.is_retryable(),
                    details: None,
                }),
                metrics,
            }
        }
        Err(_) => {
            let error_msg = format!("Task timed out after {} seconds", timeout_secs);
            tracker.mark_failed(&task_id, error_msg.clone());
            let metrics = tracker.get_metrics(&task_id).unwrap_or_default();

            error!(task_id = %task_id, timeout_secs = timeout_secs, "Task timed out");

            TaskResultMessage {
                task_id: task_id.clone(),
                worker_id,
                success: false,
                output: None,
                error: Some(TaskError {
                    code: "E501".to_string(), // ExecutionTimeout
                    message: error_msg,
                    retryable: true,
                    details: None,
                }),
                metrics,
            }
        }
    };

    // Send result
    if let Err(e) = result_tx.send(result_msg).await {
        error!(task_id = %task_id, error = %e, "Failed to send task result");
    }
}

/// Run the actual inference using the appropriate backend
async fn run_inference(
    assignment: &TaskAssignmentMessage,
    registry: &Arc<RwLock<BackendRegistry>>,
) -> Result<TaskOutput> {
    let task_type = assignment.input.task_type();

    // Find a suitable backend
    let backend: Arc<TokioRwLock<Box<dyn InferenceBackend>>> = {
        let reg = registry.read();
        reg.find_backend_for_task(task_type)
            .ok_or_else(|| Error::NotSupported(
                format!("No backend available for task type {:?}", task_type)
            ))?
    };

    // Acquire async read lock on the backend for inference
    // tokio::sync::RwLock guards are Send, so this is safe across await points
    let backend_guard = backend.read().await;

    // Execute based on task type
    match &assignment.input {
        TaskInput::TextCompletion(input) => {
            let output = backend_guard.text_completion(input.clone()).await?;
            Ok(TaskOutput::TextCompletion(output))
        }
        TaskInput::Embeddings(input) => {
            let output = backend_guard.embeddings(input.clone()).await?;
            Ok(TaskOutput::Embeddings(output))
        }
        TaskInput::Classification(input) => {
            let output = backend_guard.classify(input.clone()).await?;
            Ok(TaskOutput::Classification(output))
        }
        TaskInput::QuestionAnswering(input) => {
            let output = backend_guard.question_answering(input.clone()).await?;
            Ok(TaskOutput::QuestionAnswering(output))
        }
        TaskInput::Summarization(input) => {
            let output = backend_guard.summarize(input.clone()).await?;
            Ok(TaskOutput::Summarization(output))
        }
        TaskInput::TrainingBatch(input) => {
            let output = backend_guard.train(input.clone()).await?;
            Ok(TaskOutput::TrainingBatch(output))
        }
        TaskInput::Validation(input) => {
            let output = backend_guard.validate(input.clone()).await?;
            Ok(TaskOutput::Validation(output))
        }
        TaskInput::WebCrawl(input) => {
            let output = backend_guard.web_crawl(input.clone()).await?;
            Ok(TaskOutput::WebCrawl(output))
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::BackendConfig;
    use crate::types::{GenerationParams, TextCompletionInput};

    fn make_test_assignment() -> TaskAssignmentMessage {
        TaskAssignmentMessage {
            task_id: "test-task-1".to_string(),
            block_id: None,
            day_id: None,
            priority: crate::protocol::TaskPriority::Normal,
            deadline: None,
            model_id: "test-model".to_string(),
            input: TaskInput::TextCompletion(TextCompletionInput {
                prompt: "Hello".to_string(),
                system_prompt: None,
                params: GenerationParams::default(),
            }),
            is_canary: false,
            expected_hash: None,
            timeout_secs: 60,
        }
    }

    #[test]
    fn test_executor_config_default() {
        let config = ExecutorConfig::default();
        assert_eq!(config.max_concurrent_tasks, 4);
        assert_eq!(config.default_timeout_secs, 300);
    }

    #[tokio::test]
    async fn test_executor_creation() {
        let config = ExecutorConfig::default();
        let registry = Arc::new(RwLock::new(BackendRegistry::new()));
        let (executor, _rx) = TaskExecutor::new(config, registry, "worker-1".to_string());

        assert_eq!(executor.running_count(), 0);
        assert!(executor.can_accept());
    }
}
