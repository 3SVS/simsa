/**
 * v0.16 (Problem 3) — GitHub App helpers.
 *
 * Three responsibilities:
 *   1. Verify the X-Hub-Signature-256 HMAC on incoming webhooks
 *      (using GH_APP_WEBHOOK_SECRET).
 *   2. Mint a short-lived JWT for app-level GitHub API calls (using
 *      GH_APP_PRIVATE_KEY + GH_APP_ID).
 *   3. Exchange the app JWT for an installation access token that the
 *      pipeline uses to read repos / push autofix commits / set checks
 *      / leave comments.
 *
 * Notes on the runtime:
 *   - This runs on Cloudflare Workers, so we use WebCrypto (subtle.crypto)
 *     for HMAC-SHA256 + RS256 JWT signing. No node:crypto.
 *   - Installation tokens last 60 minutes; we mint fresh per request and
 *     never cache server-side because the Worker can scale to many isolates.
 *     For high-volume workloads, KV-cache the token by installation_id
 *     (TTL ≤ 50 min) — out of scope for v0.16.
 */
import type { Env } from "./env.js";

// --- HMAC: webhook signature verification --------------------------------

/**
 * Verify GitHub webhook HMAC. Returns true when sig matches; false on any
 * mismatch / malformed input. Constant-time compare via WebCrypto's
 * subtle.verify avoids timing leaks.
 */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const sigHex = signatureHeader.slice("sha256=".length);
  if (sigHex.length !== 64 || !/^[0-9a-f]+$/i.test(sigHex)) return false;
  const expected = await hmacSha256Hex(secret, body);
  // Constant-time compare via length match + xor accumulator.
  return constantTimeEqual(expected, sigHex.toLowerCase());
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// --- JWT: app-level auth (RS256) -----------------------------------------

/**
 * Mint a JWT signed with the GH App's private key. Used for app-level
 * GitHub API calls (mainly /app/installations/{id}/access_tokens).
 *
 * The app JWT itself is short-lived (10 min) per GitHub's recommendation;
 * the installation token returned by GitHub lasts 60 min.
 */
export async function mintAppJwt(env: Env): Promise<string> {
  if (!env.GH_APP_ID) throw new Error("GH_APP_ID secret not set");
  if (!env.GH_APP_PRIVATE_KEY) throw new Error("GH_APP_PRIVATE_KEY secret not set");

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iat: now - 60, // small skew tolerance per GH guidance
        exp: now + 9 * 60,
        iss: env.GH_APP_ID,
      }),
    ),
  );
  const message = `${header}.${payload}`;

  const key = await importPrivateKey(env.GH_APP_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64UrlEncode(new Uint8Array(sig))}`;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers/footers + whitespace to get base64 body.
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = base64Decode(body);
  // GitHub usually delivers `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1);
  // WebCrypto wants PKCS#8. Wrap PKCS#1 in PKCS#8 if needed.
  const isPkcs8 = pem.includes("BEGIN PRIVATE KEY");
  const keyBytes = isPkcs8 ? der : pkcs1ToPkcs8(der);
  return crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Wrap a PKCS#1 RSA private key in a PKCS#8 envelope so WebCrypto can
 * import it. Reference: RFC 5208. The PKCS#8 outer structure:
 *   SEQUENCE {
 *     INTEGER 0                                          -- version
 *     SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }        -- AlgorithmIdentifier (rsaEncryption)
 *     OCTET STRING { <PKCS#1 RSAPrivateKey bytes> }      -- privateKey
 *   }
 *
 * Encoded by hand because workers don't ship a real ASN.1 lib and we
 * only ever need this one fixed wrapping.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  // Constant prefix bytes that introduce the SEQUENCE + version + AlgorithmIdentifier.
  // Build the OCTET STRING + outer SEQUENCE around the PKCS#1 content.
  const algId = new Uint8Array([
    0x30, 0x0d, // SEQUENCE (13 bytes)
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // OID 1.2.840.113549.1.1.1
    0x05, 0x00, // NULL
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0
  const octetStr = derOctetString(pkcs1);
  const inner = concatBytes(version, algId, octetStr);
  return derSequence(inner);
}

function derLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  let x = n;
  while (x > 0) {
    bytes.unshift(x & 0xff);
    x >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}
function derSequence(content: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([0x30]), derLength(content.length), content);
}
function derOctetString(content: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([0x04]), derLength(content.length), content);
}
function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function base64UrlEncode(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Installation access token ------------------------------------------

export interface InstallationToken {
  token: string;
  expiresAt: string; // ISO-8601
  permissions: Record<string, string>;
}

/**
 * Exchange an app JWT for an installation access token. This token is
 * what every pipeline call uses to read/write the user's repo.
 */
export async function getInstallationToken(
  env: Env,
  installationId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<InstallationToken> {
  const jwt = await mintAppJwt(env);
  const r = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "conclave-ai-code-council",
      },
    },
  );
  if (!r.ok) {
    const tail = await r.text();
    throw new Error(`installation_access_tokens ${r.status}: ${tail.slice(0, 300)}`);
  }
  const j = (await r.json()) as { token: string; expires_at: string; permissions: Record<string, string> };
  return { token: j.token, expiresAt: j.expires_at, permissions: j.permissions };
}

// --- OAuth user code → user access token --------------------------------

/**
 * After a user clicks "Authorize" on the GitHub App OAuth page, GH
 * redirects to /auth/github/callback?code=...&state=.... We exchange
 * the code for a user access token using the GH App's client_id/secret.
 *
 * Different from installation tokens — this is "the user as themselves".
 * Used to identify the user during Device Flow login.
 */
export async function exchangeOAuthCode(
  env: Env,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; tokenType: string; scope: string }> {
  if (!env.GH_APP_CLIENT_ID || !env.GH_APP_CLIENT_SECRET) {
    throw new Error("GH_APP_CLIENT_ID + GH_APP_CLIENT_SECRET required");
  }
  const r = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GH_APP_CLIENT_ID,
      client_secret: env.GH_APP_CLIENT_SECRET,
      code,
    }),
  });
  if (!r.ok) {
    const tail = await r.text();
    throw new Error(`oauth code exchange ${r.status}: ${tail.slice(0, 300)}`);
  }
  const j = (await r.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (j.error) {
    throw new Error(`oauth: ${j.error}: ${j.error_description ?? ""}`);
  }
  if (!j.access_token) throw new Error("oauth: response missing access_token");
  return { accessToken: j.access_token, tokenType: j.token_type ?? "bearer", scope: j.scope ?? "" };
}

/**
 * Fetch the authenticated user's GH profile (numeric id + login + email).
 * Used after exchangeOAuthCode to identify which user we just logged in.
 */
export async function getAuthedUser(
  userAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: number; login: string; email: string | null }> {
  const r = await fetchImpl("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${userAccessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "conclave-ai-code-council",
    },
  });
  if (!r.ok) {
    const tail = await r.text();
    throw new Error(`/user ${r.status}: ${tail.slice(0, 200)}`);
  }
  const j = (await r.json()) as { id: number; login: string; email: string | null };
  return { id: j.id, login: j.login, email: j.email ?? null };
}

/**
 * Post a comment on a pull request using a fresh installation token.
 * Used by the SaaS pipeline to keep users informed at every stage:
 *   - "🤖 Reviewing..." when the webhook fires
 *   - "✅ Verdict: approve / 🔁 rework / ❌ reject" when callback lands
 *   - "❌ Failed: <reason>" on errored callbacks
 *
 * Best-effort — if the comment fails (rate limit, scope mismatch),
 * the caller should swallow the error rather than fail the parent flow.
 *
 * Requires the GH App to have `pull-requests: write` permission, which
 * the Conclave AI Code Council manifest declares.
 */
export async function postPrComment(
  env: import("./env.js").Env,
  installationId: number,
  repoSlug: string,
  prNumber: number,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: number } | null> {
  let token: string;
  try {
    const t = await getInstallationToken(env, installationId, fetchImpl);
    token = t.token;
  } catch {
    return null;
  }
  // PR comments are issue comments under GH's REST shape.
  const url = `https://api.github.com/repos/${repoSlug}/issues/${prNumber}/comments`;
  const r = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "conclave-ai-code-council",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { id: number };
  return { id: j.id };
}

/**
 * Create a GitHub check-run for the council verdict on a PR head sha.
 *
 * Why: GH PR UI has a separate "Checks" section that decides whether
 * the merge button is green. Without our own check-run, conclave's
 * verdict only lives in the comment thread — so a PR can show all
 * green checks (Vercel build, CI etc) even when the council voted
 * REWORK or REJECT, misleading the user into thinking it's mergeable.
 *
 * Mapping:
 *   approve → conclusion: "success"           (green ✓)
 *   rework  → conclusion: "action_required"   (orange — blocks merge in
 *                                              repos with required-checks)
 *   reject  → conclusion: "failure"           (red ✘)
 *   errored → conclusion: "cancelled"
 *
 * Best-effort. Requires `checks: write` permission on the GH App.
 */
export async function createCouncilCheckRun(
  env: import("./env.js").Env,
  installationId: number,
  repoSlug: string,
  headSha: string,
  args: {
    verdict?: string;
    blockers?: number;
    durationMs?: number;
    summary?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: number } | null> {
  let token: string;
  try {
    const t = await getInstallationToken(env, installationId, fetchImpl);
    token = t.token;
  } catch {
    return null;
  }
  const v = (args.verdict ?? "").toLowerCase();
  const conclusion =
    v === "approve"
      ? "success"
      : v === "reject"
        ? "failure"
        : v === "rework"
          ? "action_required"
          : "cancelled";
  const dur = typeof args.durationMs === "number" ? `${Math.round(args.durationMs / 1000)}s` : "";
  const titleVerb =
    v === "approve" ? "APPROVE" : v === "reject" ? "REJECT" : v === "rework" ? "REWORK" : "errored";
  const blockerLine =
    typeof args.blockers === "number" && args.blockers > 0
      ? `${args.blockers} blocker${args.blockers === 1 ? "" : "s"} · `
      : "";
  const r = await fetchImpl(`https://api.github.com/repos/${repoSlug}/check-runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "conclave-ai-code-council",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Conclave AI Council",
      head_sha: headSha,
      status: "completed",
      conclusion,
      output: {
        title: `Council verdict: ${titleVerb}${dur ? ` · ${dur}` : ""}`,
        summary:
          args.summary ??
          (v === "approve"
            ? "Three-agent council found no blockers. Safe to merge."
            : v === "reject"
              ? `${blockerLine}Council recommends not merging in current shape.`
              : v === "rework"
                ? `${blockerLine}Council requires changes before merge.`
                : "Council review did not complete — check the PR comment for details."),
      },
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { id: number };
  return { id: j.id };
}
