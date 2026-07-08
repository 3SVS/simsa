> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 103 — Product URL Intake

**Date:** 2026-06-23
**Train:** Core Intake Train (Stage 101~108) · branch `feat/stage-101-unified-intake` · PR #142 (do not merge until Stage 108).

## Goal
Make the `product_url` intake type useful: paste a product/service URL and get a deterministic **review plan** — what Simsa would check before the surface can be accepted, fixed, or released. **No live crawl/fetch** — Stage 103 reasons only from the URL shape.

## Product principle
A URL is a product artifact. Simsa turns it into "what to review", never claiming to know the real page content (it isn't fetched).

## Helper — `apps/dashboard/src/lib/intake-url.mjs` (+ `.d.mts`)
`buildProductUrlIntakePreview(rawInput): ProductUrlIntakePreview` — pure, deterministic, throw-free:
- **URL normalization**: accepts bare domains, adds `https://`, validates via `URL`; bad input → fallback (`domain:"Unknown"`, `pathType:"unknown"`, `confidence:"low"`), never throws.
- **pathType**: `homepage / pricing / docs / app / demo / blog / unknown` from path + `app.` subdomain.
- **likelySurface**: human label per path type.
- **reviewFocusAreas**: path-type-specific (homepage value-prop/CTA/trust; pricing plan/billing/refund; docs getting-started/keys; app onboarding/empty/error/privacy; demo fictional-labeling/limitations; …).
- **candidateAcceptanceItems**: surface-quality checks (visitor understands audience, CTA clear, claims have evidence/limitations, error/empty states handled, no private/misleading exposure).
- **missingQuestions**: 3–6, with pricing/app/docs-specific additions.
- **confidence**: `high` for a recognized path type, `medium` for unknown-but-parsed, `low` for unparseable.
- `SAMPLE_PRODUCT_URL = https://trysimsa.com/demo` (→ `demo`).

## UI — `/projects/new/intake` (product_url type only)
After "Create intake draft" with `Product URL` selected, a **"Product URL preview"** card shows normalized URL · domain · surface type · likely surface · review focus areas · candidate acceptance items · missing questions · confidence. "Use example URL" button. Labeled **"Preview only — no live crawl or external fetch."** Other types unchanged; existing `/projects/new` untouched.

## Deterministic limitations (intentional)
Reasons from URL shape only — no HTML, no rendered content, no screenshot, no API. Surfaces a *review plan + questions*, not findings about the actual page.

## Verification
- `apps/dashboard`: **218/218** tests (+9 URL), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 4.88 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
live URL fetch / crawler / screenshot / HTML parse / external API / central-plane / Anthropic / browser automation / DB / migration / deploy / domain — none.

## Next
Stage 104 — GitHub Repo Intake v1.
