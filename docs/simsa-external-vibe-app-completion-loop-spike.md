# Simsa External Vibe-App Completion Loop (Spike)

> **Status:** Local/dev-only spike (Stage 258A). Proves one loop end-to-end against an **authorized,
> non-Simsa** target app. It is NOT generic QA, NOT a code-review wrapper, NOT a production feature,
> and NOT approval to modify the target. Code lives under `tools/simsa-completion-loop-spike/` and is
> intentionally outside the pnpm workspace (`packages/*`, `apps/*`), so it never enters CI or production.

## What the loop proves

```
intent anchor → authorized external app URL → real browser interaction → browser evidence
   → AI Opinion (kept separate from evidence) → failure classified against the intent
   → Fix Brief for the next AI repair loop → same target run twice for reproducibility
```

## Target app category (no secrets)

A small **golfer-facing web app** ("golf-now") deployed on Vercel, owned by and tested with the
explicit authorization of the repo owner. It is a separate app — **not** Simsa, `app.trysimsa.com`, or
the central-plane Worker. The repo is used **read-only** for Fix Brief context; the app's code is never
modified, pushed, or deployed by the spike.

## Why URL-only QA is insufficient

Hitting a URL and getting `200 OK` tells you the server responded — not that a human can accomplish
anything. This app returns 200, yet its course-data backend is unreachable, so a golfer cannot actually
check course conditions. Completion is a property of the **user-facing flow**, not the HTTP status.
The loop therefore drives a **real browser** and judges against an **intent anchor**.

## Why an intent anchor is required

Without a declared intent, "is it done?" is unanswerable — done *for what*? The intent anchor
("a golfer should be able to … check whether a course is playable now") is the yardstick. The spike
detects the primary CTA/input **related to that intent** and reports the gap between intent and observed
behavior, instead of scoring the app on a generic checklist.

## Why repo context is read-only

The local repo is consulted **read-only** to make the Fix Brief specific (e.g. "the backend URL comes
from `NEXT_PUBLIC_SUPABASE_URL`"). The spike never edits, commits, pushes, or deploys the target. Any
sensitive values encountered are masked and never logged or stored.

## Browser Evidence vs AI Opinion (strict separation)

- **Browser Evidence** is factual only: URL loaded, HTTP status, selector/text clicked, route after
  click, console errors, failed network requests, screenshot paths, viewport, timestamp, skipped
  actions, detected inputs. It is what the browser actually observed.
- **AI Opinion** is interpretation only: likely intent mismatch, likely implementation choice,
  suggested severity, why this may block completion, recommended fix direction. It is clearly labeled
  "interpretation — NOT a measured fact."

The receipt keeps these in separate sections and never lets opinion masquerade as evidence. A reader can
reject the opinion while still trusting the facts.

## The Fix Brief loop

Each run emits a Claude/Codex-ready `fix-brief.md`: observed failure, reproduction steps, expected
behavior (from the intent anchor), suspected area (with read-only repo context), a specific repair
instruction, a rerun command, and an acceptance condition. This is the artifact a repair agent consumes
to attempt a fix; re-running the spike checks whether the acceptance condition is met.

## Reproducibility requirement

The same target is run **twice**. Reproducibility is judged on **stable core findings** — target, CTA
presence/text, post-click route, error class (console/network present or not), and the final decision.
Timing-sensitive noise (e.g. how many times an unreachable request was retried) is reported as
**non-gating variance**, not success/failure. If a **core** finding diverges, the result is marked
**nondeterministic** and is NOT treated as success.

## Decision states (no numeric scoring)

`Ready · Needs Fix · Not Verified · User Acceptance Required · Needs Clarification`. There is no score.
Absent evidence is **Not Verified**, never Pass. Clean navigation stops at **User Acceptance Required**
(the spike has no visual oracle to declare a next screen genuinely usable) — it never auto-declares
"Ready".

## Limitations (explicit)

- Single core flow only (homepage → primary intent CTA/input → next screen).
- **No visual oracle:** the spike confirms navigation/console/network facts but does not judge whether
  the next screen is genuinely usable.
- Does not log in, does not click destructive/forbidden actions, does not bypass auth, does not type
  into unknown forms.
- Read-only repo context only; the target app is never modified/pushed/deployed.
- **Not** a claim that all bugs are found. **Not** a claim that the app is complete or perfect.

## Run it

```
cd tools/simsa-completion-loop-spike
npm install            # local, isolated; browsers come from the Playwright cache
node spike.mjs         # runs run-1 and run-2 against config.json, writes artifacts + comparison
node --test test/*.test.mjs   # deterministic shaping tests (no browser)
```

Artifacts are written under
`conclave-builder-pack/out/stage-258a-external-vibe-app-completion-loop-spike/`.
