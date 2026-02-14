//! CLI argument parsing using clap v4
//!
//! Defines the command-line interface for the AI4All worker.

use clap::{Parser, Subcommand};

/// AI4All Worker - Distributed AI compute worker
///
/// Connects to the AI4All coordinator network, receives AI work assignments,
/// executes them using local CPU/GPU resources, and returns results.
#[derive(Parser, Debug)]
#[command(name = "ai4all-worker")]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
pub struct Cli {
    /// Increase logging verbosity (-v for debug, -vv for trace)
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    pub verbose: u8,

    /// Suppress all output except errors
    #[arg(short, long, global = true)]
    pub quiet: bool,

    #[command(subcommand)]
    pub command: Commands,
}

/// Available commands for the worker
#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Run the worker (connects to coordinator and processes work)
    Run {
        /// Path to configuration file
        #[arg(short, long, env = "AI4ALL_CONFIG")]
        config: Option<String>,

        /// Override active persona for this run (master-ba, project-ba, coder, tester)
        #[arg(long, env = "AI4ALL_PERSONA")]
        persona: Option<String>,
    },

    /// Run performance benchmarks
    Benchmark {
        /// Number of benchmark iterations
        #[arg(short, long, default_value = "3")]
        iterations: u32,

        /// Output file for benchmark results (JSON)
        #[arg(short, long)]
        output: Option<String>,
    },

    /// Display version and build information
    Version,

    /// Pair this worker with a wallet via QR code
    Pair {
        /// API server URL (e.g. http://localhost:3000)
        #[arg(long, env = "AI4ALL_API_URL", default_value = "http://localhost:3000")]
        api_url: String,

        /// Human-readable device name shown on the phone
        #[arg(long, default_value_t = default_device_name())]
        name: String,

        /// Force new keypair generation (overwrite existing)
        #[arg(long)]
        force: bool,
    },

    /// Configuration management
    Config {
        #[command(subcommand)]
        subcommand: ConfigSubcommand,
    },

    /// Persona management (governance hierarchy roles)
    Persona {
        #[command(subcommand)]
        subcommand: PersonaSubcommand,
    },
}

/// Persona subcommands
#[derive(Subcommand, Debug, Clone)]
pub enum PersonaSubcommand {
    /// List all available and installed personas
    List,

    /// Download a persona config to local storage
    Download {
        /// Persona type: master-ba, project-ba, coder, tester
        persona: String,
    },

    /// Show the currently active persona
    Show,

    /// Activate a persona for this worker
    Activate {
        /// Persona type: master-ba, project-ba, coder, tester
        persona: String,
    },

    /// Validate a downloaded persona config
    Validate {
        /// Persona type: master-ba, project-ba, coder, tester
        persona: String,
    },
}

/// Configuration subcommands
#[derive(Subcommand, Debug, Clone)]
pub enum ConfigSubcommand {
    /// Display the current configuration
    Show {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,
    },

    /// Initialize a new configuration file
    Init {
        /// Path where to create the config file
        #[arg(short, long)]
        path: Option<String>,

        /// Overwrite existing configuration
        #[arg(short, long)]
        force: bool,
    },

    /// Validate a configuration file
    Validate {
        /// Path to configuration file to validate
        #[arg(short, long)]
        config: Option<String>,
    },
}

/// Default device name based on hostname
fn default_device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "AI4All Worker".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn verify_cli() {
        // Verifies that the CLI definition is valid
        Cli::command().debug_assert();
    }

    #[test]
    fn test_run_command() {
        let cli = Cli::parse_from(["ai4all-worker", "run"]);
        match cli.command {
            Commands::Run { config, persona } => {
                assert!(config.is_none());
                assert!(persona.is_none());
            }
            _ => panic!("Expected Run command"),
        }
    }

    #[test]
    fn test_run_with_config() {
        let cli = Cli::parse_from(["ai4all-worker", "run", "--config", "/path/to/config.toml"]);
        match cli.command {
            Commands::Run { config, .. } => {
                assert_eq!(config, Some("/path/to/config.toml".to_string()));
            }
            _ => panic!("Expected Run command"),
        }
    }

    #[test]
    fn test_run_with_persona() {
        let cli = Cli::parse_from(["ai4all-worker", "run", "--persona", "coder"]);
        match cli.command {
            Commands::Run { persona, .. } => {
                assert_eq!(persona, Some("coder".to_string()));
            }
            _ => panic!("Expected Run command"),
        }
    }

    #[test]
    fn test_persona_list() {
        let cli = Cli::parse_from(["ai4all-worker", "persona", "list"]);
        match cli.command {
            Commands::Persona { subcommand: PersonaSubcommand::List } => {}
            _ => panic!("Expected Persona List command"),
        }
    }

    #[test]
    fn test_persona_activate() {
        let cli = Cli::parse_from(["ai4all-worker", "persona", "activate", "coder"]);
        match cli.command {
            Commands::Persona { subcommand: PersonaSubcommand::Activate { persona } } => {
                assert_eq!(persona, "coder");
            }
            _ => panic!("Expected Persona Activate command"),
        }
    }

    #[test]
    fn test_benchmark_defaults() {
        let cli = Cli::parse_from(["ai4all-worker", "benchmark"]);
        match cli.command {
            Commands::Benchmark { iterations, output } => {
                assert_eq!(iterations, 3);
                assert!(output.is_none());
            }
            _ => panic!("Expected Benchmark command"),
        }
    }

    #[test]
    fn test_benchmark_with_options() {
        let cli = Cli::parse_from([
            "ai4all-worker",
            "benchmark",
            "--iterations",
            "10",
            "--output",
            "results.json",
        ]);
        match cli.command {
            Commands::Benchmark { iterations, output } => {
                assert_eq!(iterations, 10);
                assert_eq!(output, Some("results.json".to_string()));
            }
            _ => panic!("Expected Benchmark command"),
        }
    }

    #[test]
    fn test_verbose_flags() {
        let cli = Cli::parse_from(["ai4all-worker", "-vv", "version"]);
        assert_eq!(cli.verbose, 2);
        assert!(!cli.quiet);
    }

    #[test]
    fn test_quiet_flag() {
        let cli = Cli::parse_from(["ai4all-worker", "--quiet", "version"]);
        assert!(cli.quiet);
    }

    #[test]
    fn test_config_show() {
        let cli = Cli::parse_from(["ai4all-worker", "config", "show"]);
        match cli.command {
            Commands::Config { subcommand: ConfigSubcommand::Show { config } } => {
                assert!(config.is_none());
            }
            _ => panic!("Expected Config Show command"),
        }
    }

    #[test]
    fn test_config_init() {
        let cli = Cli::parse_from(["ai4all-worker", "config", "init", "--force"]);
        match cli.command {
            Commands::Config { subcommand: ConfigSubcommand::Init { path, force } } => {
                assert!(path.is_none());
                assert!(force);
            }
            _ => panic!("Expected Config Init command"),
        }
    }
}
