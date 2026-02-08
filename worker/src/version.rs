//! Version and build information
//!
//! Provides access to build-time embedded information.

use std::fmt;

/// Build information embedded at compile time
#[derive(Debug, Clone)]
pub struct BuildInfo {
    /// Package version from Cargo.toml
    pub version: &'static str,
    /// Package name
    pub name: &'static str,
    /// Package authors
    pub authors: &'static str,
    /// Git commit hash (short)
    pub git_hash: &'static str,
    /// Git branch name
    pub git_branch: &'static str,
    /// Raw git dirty string ("true" or "false")
    git_dirty_str: &'static str,
    /// Build timestamp
    pub build_timestamp: &'static str,
    /// Target triple (e.g., x86_64-unknown-linux-gnu)
    pub target: &'static str,
    /// Build profile (debug/release)
    pub profile: &'static str,
    /// Rustc version used to build
    pub rustc_version: &'static str,
    /// Host triple (build machine)
    pub host: &'static str,
}

impl BuildInfo {
    /// Get the current build information
    pub const fn current() -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION"),
            name: env!("CARGO_PKG_NAME"),
            authors: env!("CARGO_PKG_AUTHORS"),
            git_hash: env!("AI4ALL_GIT_HASH"),
            git_branch: env!("AI4ALL_GIT_BRANCH"),
            git_dirty_str: env!("AI4ALL_GIT_DIRTY"),
            build_timestamp: env!("AI4ALL_BUILD_TIMESTAMP"),
            target: env!("AI4ALL_TARGET"),
            profile: env!("AI4ALL_PROFILE"),
            rustc_version: env!("AI4ALL_RUSTC_VERSION"),
            host: env!("AI4ALL_HOST"),
        }
    }

    /// Whether the working directory was dirty at build time
    pub fn git_dirty(&self) -> bool {
        self.git_dirty_str == "true"
    }

    /// Get the full version string (e.g., "0.1.0-abc1234")
    pub fn full_version(&self) -> String {
        if self.git_dirty() {
            format!("{}-{}-dirty", self.version, self.git_hash)
        } else {
            format!("{}-{}", self.version, self.git_hash)
        }
    }

    /// Get a short version string for display
    pub fn short_version(&self) -> String {
        format!("{} ({})", self.version, self.git_hash)
    }

    /// Check if this is a release build
    pub fn is_release(&self) -> bool {
        self.profile == "release"
    }

    /// Check if this is a debug build
    pub fn is_debug(&self) -> bool {
        self.profile == "debug"
    }
}

impl fmt::Display for BuildInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{} {}", self.name, self.full_version())?;
        writeln!(f)?;
        writeln!(f, "Build Information:")?;
        writeln!(f, "  Version:    {}", self.version)?;
        writeln!(f, "  Git Hash:   {}{}", self.git_hash, if self.git_dirty() { " (dirty)" } else { "" })?;
        writeln!(f, "  Git Branch: {}", self.git_branch)?;
        writeln!(f, "  Built:      {}", self.build_timestamp)?;
        writeln!(f, "  Profile:    {}", self.profile)?;
        writeln!(f)?;
        writeln!(f, "Target:")?;
        writeln!(f, "  Triple:     {}", self.target)?;
        writeln!(f, "  Host:       {}", self.host)?;
        writeln!(f)?;
        writeln!(f, "Compiler:")?;
        writeln!(f, "  {}", self.rustc_version)?;
        Ok(())
    }
}

/// Get the current build info
pub fn build_info() -> BuildInfo {
    BuildInfo::current()
}

/// Print version information to stdout
pub fn print_version() {
    let info = build_info();
    print!("{}", info);
}

/// Print short version to stdout
pub fn print_short_version() {
    let info = build_info();
    println!("{}", info.short_version());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_info_exists() {
        let info = build_info();
        assert!(!info.version.is_empty());
        assert!(!info.name.is_empty());
    }

    #[test]
    fn test_full_version_format() {
        let info = build_info();
        let full = info.full_version();

        // Should contain version
        assert!(full.contains(info.version));
        // Should contain git hash
        assert!(full.contains(info.git_hash));
    }

    #[test]
    fn test_display_format() {
        let info = build_info();
        let display = format!("{}", info);

        // Should contain key information
        assert!(display.contains("Version:"));
        assert!(display.contains("Git Hash:"));
        assert!(display.contains("Target:"));
    }
}
