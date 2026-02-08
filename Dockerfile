FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      procps ca-certificates curl bash \
 && rm -rf /var/lib/apt/lists/*
# Install claude code
RUN npm install -g @anthropic-ai/claude-code

# Install claude-flow and required runtime deps
RUN npm install -g claude-flow@alpha sql.js

# Ensure Node can resolve global modules (sql.js)
ENV NODE_PATH=/usr/local/lib/node_modules

# OpenRouter → Anthropic compatibility defaults
# IMPORTANT:
# - ANTHROPIC_API_KEY MUST exist and be empty
# - ANTHROPIC_AUTH_TOKEN will be set at runtime from OPENROUTER_API_KEY
ENV ANTHROPIC_BASE_URL="https://openrouter.ai/api" \
    ANTHROPIC_API_KEY=""

WORKDIR /workspace

# Runtime wiring happens here
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

#ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep", "infinity"]