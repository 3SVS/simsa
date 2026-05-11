# Templates — five Next.js bases for the 15 synthetic-bug PRs

Each template is a public Next.js starter that vibe-coder users
actually deploy. The intent: cover the realistic surface area of
"AI-built apps" without overfitting to one stack.

| # | Template | Repo | Why it's in the set |
|---|---|---|---|
| 1 | Vercel commerce | `vercel/commerce` | E-commerce + Stripe surface, lots of TypeScript route handlers and webhooks — good for spec-mismatch bugs. |
| 2 | ai-chatbot | `vercel/ai-chatbot` | LLM-call surface, streaming routes, tool-use — exposes prompt / streaming-error patterns most reviews miss. |
| 3 | next-forge | `haydenbleasel/next-forge` | Monorepo (Turborepo + Bun/pnpm). Tests cross-package change blast radius — single-agent reviewers tend to localize to one package. |
| 4 | platforms | `vercel/platforms` | Multi-tenancy (subdomains, custom domains, edge middleware). Surface for a11y + middleware-isolation bugs. |
| 5 | postgres-auth-starter | `vercel/nextjs-postgres-auth-starter` | Auth + DB migration + RLS-adjacent code. Surface for security blockers (XSS, SQL injection, token leak). |

## The 15 synthetic bugs (per-template breakdown)

Three PRs per template, each targeting a different blocker family:

| PR # | Template | Family | One-line description |
|---|---|---|---|
| 1 | commerce | spec-mismatch | `POST /api/order/refund` route shipped without an entry in PRD §3 acceptance criteria. |
| 2 | commerce | security | `dangerouslySetInnerHTML` renders user product `description` unsanitized. |
| 3 | commerce | testing | Refund handler ships with zero integration tests covering the new route. |
| 4 | ai-chatbot | spec-mismatch | Streaming endpoint adds a `temperature=2.0` override the PRD's "deterministic mode" forbids. |
| 5 | ai-chatbot | security | Tool-use response interpolates user input into a shell command without escaping. |
| 6 | ai-chatbot | a11y | Streaming message rerenders rip focus from the input on every chunk — keyboard users can't type while a response streams. |
| 7 | next-forge | spec-mismatch | New `packages/billing` exported types diverge from the API contract the `packages/api` consumer expects. |
| 8 | next-forge | testing | Cross-package migration ships without a contract test pinning the API surface. |
| 9 | next-forge | regression | Test was deleted as "obsolete" but the behavior it pinned is still load-bearing. |
| 10 | platforms | spec-mismatch | Custom domain rewrite shipped without the `__sites__` reservation rule from PRD §4.2. |
| 11 | platforms | a11y | Edge-middleware redirect strips `lang` cookie — screen-reader settings lost on every navigation. |
| 12 | platforms | security | Subdomain tenant lookup is case-sensitive; an attacker can register `Tenant` if `tenant` is taken. |
| 13 | postgres-auth-starter | security | Session token logged in `req.headers` dump inside an error path. |
| 14 | postgres-auth-starter | testing | New migration `0007_add_column` ships without the rollback half-pair. |
| 15 | postgres-auth-starter | spec-mismatch | Login route returns 500 on bad credentials where PRD specifies 401. |

## Why these particular families

The four categories — `spec-mismatch`, `security`, `a11y`,
`testing` — are the ones where the 3-agent council most often
surfaces blockers that a single agent classified as "minor enough to
skip." See `scoring.md` for how each category is counted. Regression
(PR 9) is included once as a control: a finding that has nothing to
do with multi-agent depth and should be found by either run, so it
checks the catch-rate parity claim.
