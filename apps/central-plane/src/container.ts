/**
 * Cloudflare Container Durable Object — wraps the Conclave AI sandbox
 * container that actually executes the autofix-pipeline.
 *
 * Pattern (per `cloudflare/templates/containers-template`):
 *   - extends Container<Env>
 *   - declared in wrangler.toml under [[containers]]
 *   - bound as a Durable Object (MY_CONTAINER) so we can address
 *     specific instances by name (one per PR for isolation)
 *   - the Worker calls `c.env.SANDBOX.idFromName(...)`,
 *     `.get()` to obtain the DO stub, and `.fetch(req)` to forward
 *     a request into the container
 *
 * sleepAfter controls how long an idle container stays warm before
 * Cloudflare reclaims it. We use 5min — long enough for autofix
 * to run + some retries, short enough that we don't pay for ghosts.
 *
 * defaultPort matches the EXPOSE in apps/central-plane/container/Dockerfile.
 */
import { Container } from "@cloudflare/containers";
import type { Env } from "./env.js";

export class ConclaveSandbox extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "5m";
  override envVars = {
    NODE_ENV: "production",
    WORK_ROOT: "/var/lib/conclave",
  };

  override onStart() {
    console.log("conclave-sandbox container started");
  }

  override onStop() {
    console.log("conclave-sandbox container stopped");
  }

  override onError(err: unknown) {
    console.error("conclave-sandbox container error:", err);
  }
}
