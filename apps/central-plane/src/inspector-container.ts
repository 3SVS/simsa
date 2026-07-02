/**
 * Stage 263 — SimsaInspector Cloudflare Container Durable Object.
 *
 * Wraps the Playwright + Chromium container (inspector-container/Dockerfile)
 * that executes Simsa visual completion checks in the cloud. Mirrors the
 * ConclaveSandbox pattern (src/container.ts):
 *   - extends Container<Env>
 *   - declared in wrangler.toml under a second [[containers]] block
 *   - bound as a Durable Object (INSPECTOR) so the Worker can address one
 *     instance per run (`vc-<runId>`) for isolation
 *   - exported ONLY from src/index.ts — never imported into router.ts —
 *     so node --test consumers stay free of `cloudflare:workers` imports.
 *
 * sleepAfter 10m: a single inspection is hard-capped at ~4 minutes inside the
 * container (wall-clock rail in server.mjs); 10 minutes covers evidence
 * upload + callback with margin while releasing the instance before cost
 * matters. defaultPort matches the EXPOSE in inspector-container/Dockerfile.
 */
import { Container } from "@cloudflare/containers";
import type { Env } from "./env.js";

export class SimsaInspector extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override envVars = {
    NODE_ENV: "production",
  };

  override onStart() {
    console.log("simsa-inspector container started");
  }

  override onStop() {
    console.log("simsa-inspector container stopped");
  }

  override onError(err: unknown) {
    console.error("simsa-inspector container error:", err);
  }
}
