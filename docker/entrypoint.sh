#!/usr/bin/env bash
set -euo pipefail

# Bridge OpenRouter key into Anthropic-style token
# Only do this if user provided OPENROUTER_API_KEY
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  export ANTHROPIC_AUTH_TOKEN="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"
fi

# Guarantee ANTHROPIC_API_KEY exists and is empty
export ANTHROPIC_API_KEY=""
echo $ANTHROPIC_AUTH_TOKEN


