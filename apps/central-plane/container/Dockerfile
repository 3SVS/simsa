# Conclave AI sandbox container — Node 20 + git + Playwright deps.
#
# Spawned by the Worker (apps/central-plane/src/container.ts) via the
# Cloudflare Containers Durable-Object binding when /saas/review or
# /saas/autofix fires. Runs the @conclave-ai/cli autofix-pipeline
# inside the container, isolated from the Worker's CPU budget.
#
# Build context: apps/central-plane/ (set in wrangler.toml).
#
# IMAGE LAYOUT:
#   /app                — workspace root (cli + agents + core dist)
#   /app/server.js      — HTTP server entry (this Container's only API)
#   /var/lib/conclave   — work dir for cloned repos (writable, ephemeral)
#
# RUNTIME ENV (provided by Worker via container.fetch envVars):
#   PORT                — HTTP listen port (default 8080, set by Worker)
#   ANTHROPIC_API_KEY   — for the worker LLM
#   OPENAI_API_KEY      — for review council
#   GEMINI_API_KEY      — for review council
#   GH_INSTALLATION_TOKEN — GitHub App installation token, used for clone + push
#   JOB_PAYLOAD         — JSON: { jobId, repo, prNumber, prd?, autofix }
#   WORKER_CALLBACK_URL — /internal/job-done URL on the Worker
#   WORKER_CALLBACK_TOKEN — bearer for the callback
#
# CONSTRAINTS:
#   - container has 2 vCPU + 4GB RAM (CF Containers default)
#   - 5-minute wall-clock budget per request (sleepAfter 5m on Worker side)
#   - ephemeral storage; clones are gone after the container sleeps

FROM node:20-alpine AS workspace

# git: needed by the pipeline for clone + commit + push
# bash: many node_modules postinstall scripts assume bash
# curl: callback to Worker uses fetch which needs system CA bundle (alpine)
RUN apk add --no-cache git bash curl ca-certificates

# pnpm at the right major version for workspace install reproducibility.
RUN npm install -g pnpm@10

WORKDIR /app

# We copy the entire monorepo into the build context. The wrangler.toml
# build context is `apps/central-plane/`; we need the parent monorepo,
# so the build is invoked from the repo root via:
#   docker build -f apps/central-plane/container/Dockerfile -t conclave-sandbox .
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages packages
COPY apps/central-plane/container/server.mjs ./server.mjs

# Install deps + build the cli + its workspace dependencies. Using
# --frozen-lockfile to catch lockfile drift early (would block deploy).
RUN pnpm install --frozen-lockfile

# Build the packages the container actually invokes at runtime: cli +
# all of its workspace dependencies. Skip apps/* and packages we don't
# call (visual-review for the smoke path is loaded via lazy-import).
RUN pnpm turbo run build \
    --filter @conclave-ai/cli \
    --filter @conclave-ai/smoke-verifier \
    --filter @conclave-ai/failure-classifier

# Pre-create the work dir so the runtime user has writable space.
RUN mkdir -p /var/lib/conclave && chmod 770 /var/lib/conclave

EXPOSE 8080

# server.mjs is a tiny HTTP wrapper that:
#   1. listens on PORT
#   2. accepts POST /run with JOB_PAYLOAD-shaped body
#   3. clones, runs the pipeline, posts back to Worker
CMD ["node", "/app/server.mjs"]
