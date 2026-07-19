# Simsa

**The acceptance layer for AI-built software.**

You built something with AI. Simsa helps you make sure it's actually what you
asked for — turn your idea into a clear product spec, check what was built
against it, and get a plain-language brief of what to fix. For everyone who ships
with AI, not just developers.

→ **Learn more: [simsa.dev](https://simsa.dev)** · **Open the app: [app.trysimsa.com](https://app.trysimsa.com)**

## What it does

1. **Idea → spec.** Describe your app in plain language. Simsa asks a few
   questions and writes a product spec plus a checklist of what must be true.
2. **Build pack.** Export a package your AI coding agent (Claude Code, Codex, …)
   can build from end to end — including service setup and deploy.
3. **Review.** Point Simsa at your repo or your deployed app. It checks each item
   — passed / issue found / not verified — with evidence, not vibes.
4. **Fix brief.** Get a plain-language brief of exactly what to change, ready to
   hand back to your agent.

No developer jargon required. Simsa keeps the PRD / requirements / verification
machinery behind a workspace anyone can follow.

## Who it's for

People who build apps with AI tools (v0, Lovable, Bolt, Cursor, Claude Code,
Codex, Replit, Windsurf, …) and want confidence that what shipped matches what
they meant — before real users see it.

## Status

Simsa is in open beta. Star this repo to follow along, and try it at
[simsa.dev](https://simsa.dev).

## What actually runs the live product

This monorepo contains two generations. **If you are evaluating the codebase,
read this first** — line counts alone will mislead you.

| | Path | Status |
|---|---|---|
| **Simsa (live product)** | `apps/central-plane` (Cloudflare Worker + D1 + R2 + inspector container), `apps/dashboard` (app.trysimsa.com), `apps/simsa-landing` (simsa.dev) | **Production.** Every user-facing flow runs here. |
| Consensus review layer | `apps/central-plane/src/workspace/verify-panel.ts`, `council-review.ts` | **Production (2026-07).** Cross-vendor verification of harmful verdicts for everyone; a 3-vendor (Anthropic/OpenAI/Gemini) council as a paid option. Worker-native — written fresh, live-verified. |
| Deterministic inspection | `apps/central-plane/inspector-container` + `src/nondev-report.ts`, `visual-flow-plan.ts` | **Production.** Evidence-based verdict ladder incl. reload-persistence ("Potemkin") checks. Accuracy is measured against fixtures with known ground truth (`docs/simsa-inspection-accuracy-eval-*.md`). |
| **Conclave (origin, legacy)** | `packages/*` (council/Mastra graph, efficiency gate, self-evolve memory, federated sync), `packages/cli` | **EOL-declared legacy (2026-07-08 decision).** Does **not** power any Simsa user flow. Kept for reference; concepts were re-implemented Worker-native where they earned their way into the live product. |

Rule of thumb: `apps/*` is the product, `packages/*` is history.

---

**한국어** — Simsa(심사)는 **AI로 만든 소프트웨어를 검수하고 수락하는 레이어**입니다.
아이디어를 제품 설명서로 바꾸고, AI가 실제로 만든 결과물을 그 기준으로 확인하고,
무엇을 고쳐야 하는지 쉬운 말로 알려줍니다. 개발자가 아니어도 됩니다.
→ [simsa.dev](https://simsa.dev) · 앱 열기 [app.trysimsa.com](https://app.trysimsa.com)
