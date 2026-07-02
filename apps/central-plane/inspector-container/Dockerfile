# Stage 263 — SimsaInspector container: Playwright + Chromium visual runner.
#
# Spawned by the Worker (apps/central-plane/src/inspector-container.ts) via the
# INSPECTOR Durable-Object binding when POST /workspace/projects/:id/
# visual-checks/run fires. Executes the Simsa deep-flow visual completion
# check (same logic as tools/simsa-completion-loop-spike/visual-run.mjs) in a
# real headless Chromium, uploads screenshots + video to the Stage 261
# evidence endpoint, then reports the verdict to /internal/visual-check-done.
#
# Build context: repo root (wrangler.toml image_build_context = "../.."), same
# as the autofix sandbox container. Built in CI by deploy-central-plane.yml.
#
# BASE IMAGE: the mcr playwright tag MUST match the `playwright` npm version
# installed below AND the version pinned in
# tools/simsa-completion-loop-spike/package.json — the browsers baked into the
# image at /ms-playwright are only guaranteed compatible with that exact
# library version. test/inspector-invariants.test.mjs pins this alignment.
#
# CODE-IN STRATEGY: unlike the sandbox container (full pnpm workspace build),
# this image compiles ONLY the two canonical, dependency-free Simsa modules
# (src/visual-flow-plan.ts + src/nondev-report.ts) with a standalone tsc.
# Why not mirror the full workspace build: (1) the playwright base is already
# ~2 GB and a full monorepo node_modules would push the image past the 4 GB
# disk of the "basic" container instance; (2) the runner needs exactly these
# two pure modules — nothing else from central-plane runs in the container.
# The sources are the SAME files the Worker builds, so logic stays lock-step.
#
# IMAGE LAYOUT:
#   /runner                  — app root (package.json type:module)
#   /runner/server.mjs       — HTTP entry (the container's only API)
#   /runner/inspector-run.mjs— Playwright deep-flow executor
#   /runner/safety.mjs       — forbidden-action classifier (from the spike)
#   /runner/dist/            — compiled visual-flow-plan.js + nondev-report.js
#
# RUNTIME: job payload arrives over POST /run (no secrets baked into the
# image); evidence + callbacks use the URLs/token carried in the payload.

FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /runner

# package.json first (type:module + pinned playwright/typescript versions).
COPY apps/central-plane/inspector-container/package.json ./package.json
RUN npm install --no-package-lock --loglevel=error

# Canonical Simsa modules — compiled in-image from apps/central-plane/src so
# the container always runs the exact logic the repo ships.
COPY apps/central-plane/src/visual-flow-plan.ts apps/central-plane/src/nondev-report.ts ./src/
RUN npx tsc src/visual-flow-plan.ts src/nondev-report.ts \
    --outDir dist --module nodenext --moduleResolution nodenext \
    --target es2022 --skipLibCheck

# Runner scripts (plain .mjs — no TS build step for the runtime shell).
COPY apps/central-plane/inspector-container/server.mjs ./server.mjs
COPY apps/central-plane/inspector-container/inspector-run.mjs ./inspector-run.mjs
COPY apps/central-plane/inspector-container/safety.mjs ./safety.mjs

# Writable scratch space for per-run screenshots/video.
RUN mkdir -p /var/lib/simsa && chmod 770 /var/lib/simsa

EXPOSE 8080

CMD ["node", "/runner/server.mjs"]
