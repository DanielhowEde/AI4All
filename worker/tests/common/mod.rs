//! Common test utilities and fixtures
//!
//! This module provides shared test infrastructure

use std::path::PathBuf;

/// Get the path to the test fixtures directory
pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

/// Get a path to a specific fixture file
pub fn fixture_path(name: &str) -> PathBuf {
    fixtures_dir().join(name)
}

/// Get the valid config fixture path
pub fn valid_config_fixture() -> PathBuf {
    fixture_path("valid_config.toml")
}

/// Get the invalid config fixture path
pub fn invalid_config_fixture() -> PathBuf {
    fixture_path("invalid_config.toml")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fixtures_dir_exists() {
        assert!(fixtures_dir().exists(), "Fixtures directory should exist");
    }

    #[test]
    fn test_valid_config_exists() {
        assert!(
            valid_config_fixture().exists(),
            "Valid config fixture should exist"
        );
    }

    #[test]
    fn test_invalid_config_exists() {
        assert!(
            invalid_config_fixture().exists(),
            "Invalid config fixture should exist"
        );
    }
}
