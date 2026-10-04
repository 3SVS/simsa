# Simsa KV Spike — 2026-10-01

## Decision

Use Cloudflare Workers KV only for short-lived, non-authoritative data in `apps/central-plane`.

KV is optional. If the `CENTRAL_CACHE` binding is missing or KV operations fail, routes must continue on the existing D1/network path.

## Allowed

- TTL caches for external reachability checks.
- Idempotency keys and short duplicate-click locks.
- Temporary computed hints that can be rebuilt from D1, R2, GitHub, or a live URL.

## Not Allowed

- `DevSpec`, `build_jobs`, `workspace_visual_checks`, receipts, credits, billing, consent, project ownership, or any source-of-truth data.
- Secrets, API keys, OAuth tokens, repository contents, or uploaded documents.
- Anything that must be queried relationally or audited later.

## First Spike

`source-reachability.ts` now caches anonymous GitHub reachability results for five minutes:

- KV key: `source-reachability:github:v1:<sha256(lowercase owner/repo)>`
- Binding: `CENTRAL_CACHE`
- TTL: 300 seconds
- Scope: anonymous GitHub reachability only

User-token results are not cached because private-repo visibility is user-specific.

Only definitive anonymous results (`readable`, `needs_access`) are cached. Transient `unknown` results (timeout, network, rate limit) are never cached, so a momentary GitHub hiccup cannot pin a wrong answer for five minutes.

Status: code + tests only. The namespace is not created and the binding is commented out, so production behavior is unchanged until Bae approves enabling it.

## Enablement

Create the namespace:

```bash
wrangler kv namespace create CENTRAL_CACHE
```

Then uncomment the `[[kv_namespaces]]` placeholder in `apps/central-plane/wrangler.toml` and replace the namespace id.
