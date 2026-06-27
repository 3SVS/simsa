# Fix Brief — https://golf-nngxsj9ap-seunghunbae-3svs-projects.vercel.app/

## Observed failure

2 backend/network request(s) failed while loading the page (e.g. a required API host is unreachable); a user cannot complete the intended flow against a broken data dependency.

## Reproduction steps

1. open homepage
2. identify the primary CTA or primary input related to checking golf course/current playability conditions
3. click the primary CTA or interact with the primary input if safe
4. observe whether the app advances to a usable next screen, search/result state, course-condition view, or clear next step

## Expected behavior (from intent anchor)

> A golfer should be able to open the app, understand that it helps check current golf course conditions, and start a core flow for checking whether a course or round is playable now.

Interacting with the primary intent CTA/input should advance the user to a usable next screen that serves the stated intent, with no console/network errors.

## Suspected area

Restore the failing backend/data requests (a required API host appears unreachable); the homepage cannot render its content or onboarding entry point until those requests succeed.

Read-only repo context (no code modified): golf-now reads its backend from process.env.NEXT_PUBLIC_SUPABASE_URL (see src/lib/supabase/*). The deployed app's browser requests to its Supabase REST host fail with ERR_NAME_NOT_RESOLVED, i.e. the configured Supabase host does not resolve (paused/deleted project or stale deploy env).

## Specific repair instruction

- The page's required backend/API requests are failing (host unreachable). Restore the data dependency: verify the deployed environment's backend URL points to a live host, re-provision the backing service if it was paused/deleted, then redeploy and re-run this flow.
- Repo context indicates the backend URL comes from `NEXT_PUBLIC_SUPABASE_URL`; confirm that env var (in the deploy target) resolves to a live Supabase project. Do NOT commit secrets.

## Rerun command

```
node tools/simsa-completion-loop-spike/run.mjs
```

## Acceptance condition

- Interacting with the primary intent CTA/input advances to a usable next screen that serves the intent anchor.
- No console errors and no failed network requests during the flow.
- The same result is observed on two consecutive runs.
