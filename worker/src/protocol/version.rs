//! Protocol versioning
//!
//! Handles protocol version negotiation and compatibility checking.

use serde::{Deserialize, Serialize};

/// Current protocol version
pub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion {
    major: 1,
    minor: 0,
    patch: 0,
};

/// Protocol version identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl ProtocolVersion {
    /// Create a new version
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self { major, minor, patch }
    }

    /// Check if this version is compatible with another version
    ///
    /// Compatibility rules:
    /// - Major version must match exactly
    /// - Minor version of self must be >= other (backward compatible)
    pub fn is_compatible_with(&self, other: &ProtocolVersion) -> bool {
        self.major == other.major && self.minor >= other.minor
    }

    /// Check if versions are exactly equal
    pub fn is_exact_match(&self, other: &ProtocolVersion) -> bool {
        self.major == other.major
            && self.minor == other.minor
            && self.patch == other.patch
    }
}

impl std::fmt::Display for ProtocolVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl Default for ProtocolVersion {
    fn default() -> Self {
        PROTOCOL_VERSION
    }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_display() {
        let v = ProtocolVersion::new(1, 2, 3);
        assert_eq!(v.to_string(), "1.2.3");
    }

    #[test]
    fn test_version_compatibility() {
        let v1_0 = ProtocolVersion::new(1, 0, 0);
        let v1_1 = ProtocolVersion::new(1, 1, 0);
        let v2_0 = ProtocolVersion::new(2, 0, 0);

        // Same major, newer minor is compatible
        assert!(v1_1.is_compatible_with(&v1_0));

        // Same major, older minor is not compatible
        assert!(!v1_0.is_compatible_with(&v1_1));

        // Different major is not compatible
        assert!(!v2_0.is_compatible_with(&v1_0));
        assert!(!v1_0.is_compatible_with(&v2_0));
    }

    #[test]
    fn test_version_exact_match() {
        let v1 = ProtocolVersion::new(1, 2, 3);
        let v2 = ProtocolVersion::new(1, 2, 3);
        let v3 = ProtocolVersion::new(1, 2, 4);

        assert!(v1.is_exact_match(&v2));
        assert!(!v1.is_exact_match(&v3));
    }

    #[test]
    fn test_version_serialize() {
        let v = ProtocolVersion::new(1, 0, 0);
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("\"major\":1"));
    }
}
