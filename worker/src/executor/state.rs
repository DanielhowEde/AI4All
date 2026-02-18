//! Task execution state tracking
//!
//! Tracks active tasks and their execution states.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use tokio::sync::oneshot;

use crate::protocol::{TaskAssignmentMessage, TaskMetrics, TaskPriority};
use crate::types::TaskType;

// ─────────────────────────────────────────────────────────────────
// Task Execution State
// ─────────────────────────────────────────────────────────────────

/// Where a task originated from
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskSource {
    /// Task assigned by the central coordinator (WebSocket)
    Coordinator,
    /// Task received from a peer worker
    Peer { worker_id: String },
    /// Task polled from the coordinator HTTP task API
    HttpPolled,
}

impl Default for TaskSource {
    fn default() -> Self {
        TaskSource::Coordinator
    }
}

/// State of a task being executed
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState {
    /// Task is queued waiting for execution
    Queued,
    /// Task is currently being executed
    Running,
    /// Task completed successfully
    Completed,
    /// Task failed
    Failed,
    /// Task was cancelled
    Cancelled,
}

impl Default for TaskState {
    fn default() -> Self {
        TaskState::Queued
    }
}

// ─────────────────────────────────────────────────────────────────
// Active Task
// ─────────────────────────────────────────────────────────────────

/// Represents an active task being tracked
#[derive(Debug)]
pub struct ActiveTask {
    /// The original assignment message
    pub assignment: TaskAssignmentMessage,

    /// Current state
    pub state: TaskState,

    /// When the task was received
    pub received_at: Instant,

    /// When execution started
    pub started_at: Option<Instant>,

    /// When task completed
    pub completed_at: Option<Instant>,

    /// Cancellation signal sender
    pub cancel_tx: Option<oneshot::Sender<()>>,

    /// Error message if failed
    pub error: Option<String>,

    /// Tokens processed so far (for progress tracking)
    pub tokens_processed: u32,

    /// Where this task originated from
    pub source: TaskSource,
}

impl ActiveTask {
    /// Create a new active task from an assignment
    pub fn new(assignment: TaskAssignmentMessage) -> Self {
        Self {
            assignment,
            state: TaskState::Queued,
            received_at: Instant::now(),
            started_at: None,
            completed_at: None,
            cancel_tx: None,
            error: None,
            tokens_processed: 0,
            source: TaskSource::Coordinator,
        }
    }

    /// Get the task ID
    pub fn task_id(&self) -> &str {
        &self.assignment.task_id
    }

    /// Get the task type
    pub fn task_type(&self) -> TaskType {
        self.assignment.input.task_type()
    }

    /// Get the priority
    pub fn priority(&self) -> TaskPriority {
        self.assignment.priority
    }

    /// Mark the task as running
    pub fn mark_running(&mut self) {
        self.state = TaskState::Running;
        self.started_at = Some(Instant::now());
    }

    /// Mark the task as completed
    pub fn mark_completed(&mut self) {
        self.state = TaskState::Completed;
        self.completed_at = Some(Instant::now());
    }

    /// Mark the task as failed
    pub fn mark_failed(&mut self, error: String) {
        self.state = TaskState::Failed;
        self.completed_at = Some(Instant::now());
        self.error = Some(error);
    }

    /// Mark the task as cancelled
    pub fn mark_cancelled(&mut self) {
        self.state = TaskState::Cancelled;
        self.completed_at = Some(Instant::now());
    }

    /// Get queue time in milliseconds
    pub fn queue_time_ms(&self) -> u64 {
        self.started_at
            .map(|s| (s - self.received_at).as_millis() as u64)
            .unwrap_or(0)
    }

    /// Get execution time in milliseconds
    pub fn execution_time_ms(&self) -> u64 {
        match (self.started_at, self.completed_at) {
            (Some(start), Some(end)) => (end - start).as_millis() as u64,
            (Some(start), None) => start.elapsed().as_millis() as u64,
            _ => 0,
        }
    }

    /// Get total time in milliseconds
    pub fn total_time_ms(&self) -> u64 {
        self.completed_at
            .map(|e| (e - self.received_at).as_millis() as u64)
            .unwrap_or_else(|| self.received_at.elapsed().as_millis() as u64)
    }

    /// Build task metrics
    pub fn metrics(&self) -> TaskMetrics {
        TaskMetrics {
            queue_time_ms: self.queue_time_ms(),
            execution_time_ms: self.execution_time_ms(),
            total_time_ms: self.total_time_ms(),
            tokens_processed: if self.tokens_processed > 0 {
                Some(self.tokens_processed)
            } else {
                None
            },
            tokens_per_second: self.calculate_tokens_per_second(),
            peak_memory_mb: None, // TODO: Track memory usage
            peak_gpu_memory_mb: None,
        }
    }

    fn calculate_tokens_per_second(&self) -> Option<f32> {
        if self.tokens_processed == 0 {
            return None;
        }
        let exec_time = self.execution_time_ms();
        if exec_time == 0 {
            return None;
        }
        Some((self.tokens_processed as f32) / (exec_time as f32 / 1000.0))
    }
}

// ─────────────────────────────────────────────────────────────────
// Task Tracker
// ─────────────────────────────────────────────────────────────────

/// Tracks all active and recently completed tasks
pub struct TaskTracker {
    /// Active tasks by ID
    tasks: RwLock<HashMap<String, ActiveTask>>,

    /// Maximum concurrent tasks
    max_concurrent: usize,

    /// Completed task count (since startup)
    completed_count: RwLock<u64>,

    /// Failed task count (since startup)
    failed_count: RwLock<u64>,
}

impl TaskTracker {
    /// Create a new task tracker
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            tasks: RwLock::new(HashMap::new()),
            max_concurrent,
            completed_count: RwLock::new(0),
            failed_count: RwLock::new(0),
        }
    }

    /// Add a new task
    pub fn add_task(&self, assignment: TaskAssignmentMessage) -> bool {
        let mut tasks = self.tasks.write();

        // Check if we can accept more tasks
        let running_count = tasks.values()
            .filter(|t| t.state == TaskState::Running || t.state == TaskState::Queued)
            .count();

        if running_count >= self.max_concurrent {
            return false;
        }

        let task_id = assignment.task_id.clone();
        tasks.insert(task_id, ActiveTask::new(assignment));
        true
    }

    /// Mark a task as running
    pub fn mark_running(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            task.mark_running();
            true
        } else {
            false
        }
    }

    /// Mark a task as completed
    pub fn mark_completed(&self, task_id: &str) {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            task.mark_completed();
            *self.completed_count.write() += 1;
        }
    }

    /// Mark a task as failed
    pub fn mark_failed(&self, task_id: &str, error: String) {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            task.mark_failed(error);
            *self.failed_count.write() += 1;
        }
    }

    /// Cancel a task
    pub fn cancel_task(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.write();
        if let Some(task) = tasks.get_mut(task_id) {
            if task.state == TaskState::Running || task.state == TaskState::Queued {
                // Send cancellation signal if available
                if let Some(tx) = task.cancel_tx.take() {
                    let _ = tx.send(());
                }
                task.mark_cancelled();
                return true;
            }
        }
        false
    }

    /// Get task metrics
    pub fn get_metrics(&self, task_id: &str) -> Option<TaskMetrics> {
        self.tasks.read().get(task_id).map(|t| t.metrics())
    }

    /// Get list of active task IDs
    pub fn active_task_ids(&self) -> Vec<String> {
        self.tasks.read()
            .iter()
            .filter(|(_, t)| t.state == TaskState::Running || t.state == TaskState::Queued)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Get count of running tasks
    pub fn running_count(&self) -> usize {
        self.tasks.read()
            .values()
            .filter(|t| t.state == TaskState::Running)
            .count()
    }

    /// Get count of queued tasks
    pub fn queued_count(&self) -> usize {
        self.tasks.read()
            .values()
            .filter(|t| t.state == TaskState::Queued)
            .count()
    }

    /// Check if we can accept more tasks
    pub fn can_accept(&self) -> bool {
        let tasks = self.tasks.read();
        let active = tasks.values()
            .filter(|t| t.state == TaskState::Running || t.state == TaskState::Queued)
            .count();
        active < self.max_concurrent
    }

    /// Get total completed count
    pub fn total_completed(&self) -> u64 {
        *self.completed_count.read()
    }

    /// Get total failed count
    pub fn total_failed(&self) -> u64 {
        *self.failed_count.read()
    }

    /// Clean up old completed/failed tasks (keep last N)
    pub fn cleanup_old_tasks(&self, keep_count: usize) {
        let mut tasks = self.tasks.write();

        // Get completed/failed tasks sorted by completion time
        let mut completed: Vec<_> = tasks.iter()
            .filter(|(_, t)| matches!(t.state, TaskState::Completed | TaskState::Failed | TaskState::Cancelled))
            .map(|(id, t)| (id.clone(), t.completed_at))
            .collect();

        completed.sort_by(|a, b| a.1.cmp(&b.1));

        // Remove oldest if we have too many
        let to_remove = completed.len().saturating_sub(keep_count);
        for (id, _) in completed.into_iter().take(to_remove) {
            tasks.remove(&id);
        }
    }
}

impl Default for TaskTracker {
    fn default() -> Self {
        Self::new(4) // Default to 4 concurrent tasks
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{GenerationParams, TaskInput, TextCompletionInput};

    fn make_test_assignment(task_id: &str) -> TaskAssignmentMessage {
        TaskAssignmentMessage {
            task_id: task_id.to_string(),
            block_id: None,
            day_id: None,
            priority: TaskPriority::Normal,
            deadline: None,
            model_id: "test-model".to_string(),
            input: TaskInput::TextCompletion(TextCompletionInput {
                prompt: "Test".to_string(),
                system_prompt: None,
                params: GenerationParams::default(),
            }),
            is_canary: false,
            expected_hash: None,
            timeout_secs: 60,
        }
    }

    #[test]
    fn test_active_task_lifecycle() {
        let assignment = make_test_assignment("task-1");
        let mut task = ActiveTask::new(assignment);

        assert_eq!(task.state, TaskState::Queued);
        assert!(task.started_at.is_none());

        task.mark_running();
        assert_eq!(task.state, TaskState::Running);
        assert!(task.started_at.is_some());

        task.mark_completed();
        assert_eq!(task.state, TaskState::Completed);
        assert!(task.completed_at.is_some());
    }

    #[test]
    fn test_task_tracker_add() {
        let tracker = TaskTracker::new(2);

        assert!(tracker.add_task(make_test_assignment("task-1")));
        assert!(tracker.add_task(make_test_assignment("task-2")));
        // Should reject third task (max concurrent = 2)
        assert!(!tracker.add_task(make_test_assignment("task-3")));
    }

    #[test]
    fn test_task_tracker_lifecycle() {
        let tracker = TaskTracker::new(4);

        tracker.add_task(make_test_assignment("task-1"));
        assert_eq!(tracker.queued_count(), 1);
        assert_eq!(tracker.running_count(), 0);

        tracker.mark_running("task-1");
        assert_eq!(tracker.queued_count(), 0);
        assert_eq!(tracker.running_count(), 1);

        tracker.mark_completed("task-1");
        assert_eq!(tracker.running_count(), 0);
        assert_eq!(tracker.total_completed(), 1);
    }

    #[test]
    fn test_task_tracker_cancel() {
        let tracker = TaskTracker::new(4);
        tracker.add_task(make_test_assignment("task-1"));
        tracker.mark_running("task-1");

        assert!(tracker.cancel_task("task-1"));
        assert_eq!(tracker.running_count(), 0);
    }

    #[test]
    fn test_active_task_ids() {
        let tracker = TaskTracker::new(4);
        tracker.add_task(make_test_assignment("task-1"));
        tracker.add_task(make_test_assignment("task-2"));
        tracker.mark_running("task-1");

        let ids = tracker.active_task_ids();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"task-1".to_string()));
        assert!(ids.contains(&"task-2".to_string()));
    }
}
