//! Work groups — logical groupings of workers for collaborative tasks
//!
//! Groups coordinate workers for:
//! - **Model sharding**: Split large model layers across machines
//! - **Task pipelines**: Chain processing stages (e.g. embed → classify)
//! - **General collaboration**: Any coordinated multi-worker activity

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use uuid::Uuid;

use crate::types::TaskType;

// ─────────────────────────────────────────────────────────────────
// Group Types
// ─────────────────────────────────────────────────────────────────

/// Role of a worker within a group
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupRole {
    /// Group coordinator — manages workflow and assignments
    Coordinator,
    /// Regular group member
    Member,
}

/// Purpose and configuration of a work group
#[derive(Debug, Clone)]
pub enum GroupPurpose {
    /// Split a model across workers (tensor/pipeline parallelism)
    ModelShard {
        model_id: String,
        total_shards: u32,
    },
    /// Chain task types through a processing pipeline
    TaskPipeline {
        pipeline_id: String,
        stages: Vec<TaskType>,
    },
    /// General-purpose worker coordination
    General,
}

/// A member of a work group
#[derive(Debug, Clone)]
pub struct GroupMember {
    /// Worker ID
    pub worker_id: String,

    /// Role in the group
    pub role: GroupRole,

    /// Assigned shard index (for model sharding)
    pub shard_index: Option<u32>,

    /// Assigned pipeline stage (for task pipelines)
    pub pipeline_stage: Option<usize>,

    /// Whether this member has signaled readiness
    pub ready: bool,
}

/// A work group containing multiple workers
#[derive(Debug, Clone)]
pub struct WorkGroup {
    /// Unique group ID
    pub group_id: String,

    /// Group purpose and configuration
    pub purpose: GroupPurpose,

    /// Members of this group
    pub members: Vec<GroupMember>,

    /// When the group was created
    pub created_at: DateTime<Utc>,
}

// ─────────────────────────────────────────────────────────────────
// Group Manager
// ─────────────────────────────────────────────────────────────────

/// Manages work groups for this worker
pub struct GroupManager {
    groups: RwLock<HashMap<String, WorkGroup>>,
    my_worker_id: String,
}

impl GroupManager {
    /// Create a new group manager
    pub fn new(worker_id: String) -> Self {
        Self {
            groups: RwLock::new(HashMap::new()),
            my_worker_id: worker_id,
        }
    }

    /// Create a new group and return its ID
    pub fn create_group(&self, purpose: GroupPurpose) -> String {
        let group_id = format!("grp-{}", &Uuid::new_v4().to_string()[..8]);

        let group = WorkGroup {
            group_id: group_id.clone(),
            purpose,
            members: vec![GroupMember {
                worker_id: self.my_worker_id.clone(),
                role: GroupRole::Coordinator,
                shard_index: None,
                pipeline_stage: None,
                ready: false,
            }],
            created_at: Utc::now(),
        };

        self.groups.write().insert(group_id.clone(), group);
        group_id
    }

    /// Add a group (e.g. assigned by coordinator)
    pub fn add_group(&self, group: WorkGroup) {
        self.groups
            .write()
            .insert(group.group_id.clone(), group);
    }

    /// Join an existing group
    pub fn join_group(&self, group_id: &str, role: GroupRole) {
        let mut groups = self.groups.write();
        if let Some(group) = groups.get_mut(group_id) {
            // Don't add if already a member
            if group
                .members
                .iter()
                .any(|m| m.worker_id == self.my_worker_id)
            {
                return;
            }
            group.members.push(GroupMember {
                worker_id: self.my_worker_id.clone(),
                role,
                shard_index: None,
                pipeline_stage: None,
                ready: false,
            });
        }
    }

    /// Leave a group
    pub fn leave_group(&self, group_id: &str) {
        let mut groups = self.groups.write();
        if let Some(group) = groups.get_mut(group_id) {
            group
                .members
                .retain(|m| m.worker_id != self.my_worker_id);
            // If no members left, remove the group
            if group.members.is_empty() {
                groups.remove(group_id);
            }
        }
    }

    /// Remove a group entirely
    pub fn remove_group(&self, group_id: &str) {
        self.groups.write().remove(group_id);
    }

    /// Get groups this worker belongs to
    pub fn my_groups(&self) -> Vec<String> {
        self.groups
            .read()
            .values()
            .filter(|g| g.members.iter().any(|m| m.worker_id == self.my_worker_id))
            .map(|g| g.group_id.clone())
            .collect()
    }

    /// Get a clone of a group
    pub fn get_group(&self, group_id: &str) -> Option<WorkGroup> {
        self.groups.read().get(group_id).cloned()
    }

    /// Mark a member as ready
    pub fn set_member_ready(&self, group_id: &str, worker_id: &str) {
        if let Some(group) = self.groups.write().get_mut(group_id) {
            if let Some(member) = group
                .members
                .iter_mut()
                .find(|m| m.worker_id == worker_id)
            {
                member.ready = true;
            }
        }
    }

    /// Check if all members in a group are ready
    pub fn all_members_ready(&self, group_id: &str) -> bool {
        self.groups
            .read()
            .get(group_id)
            .map(|g| g.members.iter().all(|m| m.ready))
            .unwrap_or(false)
    }

    /// Get the worker responsible for the next pipeline stage
    pub fn next_in_pipeline(
        &self,
        group_id: &str,
        current_stage: usize,
    ) -> Option<String> {
        self.groups.read().get(group_id).and_then(|g| {
            g.members
                .iter()
                .find(|m| m.pipeline_stage == Some(current_stage + 1))
                .map(|m| m.worker_id.clone())
        })
    }

    /// Get the worker that owns a specific shard
    pub fn shard_owner(&self, group_id: &str, shard_index: u32) -> Option<String> {
        self.groups.read().get(group_id).and_then(|g| {
            g.members
                .iter()
                .find(|m| m.shard_index == Some(shard_index))
                .map(|m| m.worker_id.clone())
        })
    }

    /// Set the shard index for a member
    pub fn set_shard_index(
        &self,
        group_id: &str,
        worker_id: &str,
        shard_index: u32,
    ) {
        if let Some(group) = self.groups.write().get_mut(group_id) {
            if let Some(member) = group
                .members
                .iter_mut()
                .find(|m| m.worker_id == worker_id)
            {
                member.shard_index = Some(shard_index);
            }
        }
    }

    /// Set the pipeline stage for a member
    pub fn set_pipeline_stage(
        &self,
        group_id: &str,
        worker_id: &str,
        stage: usize,
    ) {
        if let Some(group) = self.groups.write().get_mut(group_id) {
            if let Some(member) = group
                .members
                .iter_mut()
                .find(|m| m.worker_id == worker_id)
            {
                member.pipeline_stage = Some(stage);
            }
        }
    }

    /// Add a remote member to a group (peer joined)
    pub fn add_member(
        &self,
        group_id: &str,
        worker_id: &str,
        role: GroupRole,
    ) {
        if let Some(group) = self.groups.write().get_mut(group_id) {
            if !group.members.iter().any(|m| m.worker_id == worker_id) {
                group.members.push(GroupMember {
                    worker_id: worker_id.to_string(),
                    role,
                    shard_index: None,
                    pipeline_stage: None,
                    ready: false,
                });
            }
        }
    }

    /// Remove a member from a group (peer left)
    pub fn remove_member(&self, group_id: &str, worker_id: &str) {
        if let Some(group) = self.groups.write().get_mut(group_id) {
            group.members.retain(|m| m.worker_id != worker_id);
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
    fn test_create_group() {
        let mgr = GroupManager::new("w1".to_string());
        let gid = mgr.create_group(GroupPurpose::General);

        assert!(!gid.is_empty());
        assert_eq!(mgr.my_groups().len(), 1);

        let group = mgr.get_group(&gid).unwrap();
        assert_eq!(group.members.len(), 1);
        assert_eq!(group.members[0].worker_id, "w1");
        assert_eq!(group.members[0].role, GroupRole::Coordinator);
    }

    #[test]
    fn test_join_and_leave_group() {
        let mgr = GroupManager::new("w1".to_string());
        let gid = mgr.create_group(GroupPurpose::General);

        mgr.add_member(&gid, "w2", GroupRole::Member);

        let group = mgr.get_group(&gid).unwrap();
        assert_eq!(group.members.len(), 2);

        mgr.remove_member(&gid, "w2");
        let group = mgr.get_group(&gid).unwrap();
        assert_eq!(group.members.len(), 1);
    }

    #[test]
    fn test_shard_management() {
        let mgr = GroupManager::new("w1".to_string());
        let gid = mgr.create_group(GroupPurpose::ModelShard {
            model_id: "llama-70b".to_string(),
            total_shards: 3,
        });

        mgr.add_member(&gid, "w2", GroupRole::Member);
        mgr.add_member(&gid, "w3", GroupRole::Member);

        mgr.set_shard_index(&gid, "w1", 0);
        mgr.set_shard_index(&gid, "w2", 1);
        mgr.set_shard_index(&gid, "w3", 2);

        assert_eq!(mgr.shard_owner(&gid, 0), Some("w1".to_string()));
        assert_eq!(mgr.shard_owner(&gid, 1), Some("w2".to_string()));
        assert_eq!(mgr.shard_owner(&gid, 2), Some("w3".to_string()));
        assert_eq!(mgr.shard_owner(&gid, 3), None);
    }

    #[test]
    fn test_pipeline_management() {
        let mgr = GroupManager::new("w1".to_string());
        let gid = mgr.create_group(GroupPurpose::TaskPipeline {
            pipeline_id: "embed-classify".to_string(),
            stages: vec![TaskType::Embeddings, TaskType::Classification],
        });

        mgr.add_member(&gid, "w2", GroupRole::Member);

        mgr.set_pipeline_stage(&gid, "w1", 0);
        mgr.set_pipeline_stage(&gid, "w2", 1);

        assert_eq!(mgr.next_in_pipeline(&gid, 0), Some("w2".to_string()));
        assert_eq!(mgr.next_in_pipeline(&gid, 1), None);
    }

    #[test]
    fn test_readiness() {
        let mgr = GroupManager::new("w1".to_string());
        let gid = mgr.create_group(GroupPurpose::General);
        mgr.add_member(&gid, "w2", GroupRole::Member);

        assert!(!mgr.all_members_ready(&gid));

        mgr.set_member_ready(&gid, "w1");
        assert!(!mgr.all_members_ready(&gid));

        mgr.set_member_ready(&gid, "w2");
        assert!(mgr.all_members_ready(&gid));
    }

    #[test]
    fn test_leave_last_member_removes_group() {
        let mgr = GroupManager::new("w1".to_string());
        let gid = mgr.create_group(GroupPurpose::General);

        mgr.leave_group(&gid);
        assert!(mgr.get_group(&gid).is_none());
        assert_eq!(mgr.my_groups().len(), 0);
    }
}
