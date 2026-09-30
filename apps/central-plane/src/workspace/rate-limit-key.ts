/**
 * rate-limit-key.ts — the stored key (`ip_hash` column) of every request-limit
 * row (workspace_rate_limit · demo_rate_limit), whatever the bucket.
 *
 * Why (2026-09-29): the routes stored `sha256("workspace::" + ip)` — a hash
 * WITHOUT a secret. IPv4 has ~4.3 billion addresses, so anyone who can read the
 * table recovers every IP by hashing them all: a pseudonym in name only, an IP
 * in fact. The Train W network cap (rate-limit.ts, bucket `…-daily-ip`) did the
 * same, and the demo used a salt whose default was a public string in the code.
 *
 * The userKey buckets had the same flaw by another road (PR #566 review P2): a
 * userKey is NOT a random UUID — it is `uk_${Date.now().toString(36)}` + five
 * Math.random chars (dashboard workflow-store.ts getUserKey), and the same D1
 * keeps it in plain text in 20+ tables (user_key columns, 0027~0070). So
 * `sha256(bucket::userKey)` links straight back to the user for anyone who reads
 * the DB: compute it for every stored user_key and a handful of bucket names.
 *
 * Now every personal key is a keyed HMAC-SHA256. No new secret is needed —
 * purpose-bound subkeys are derived from the existing CONCLAVE_TOKEN_KEK:
 *
 *   subkey = HMAC-SHA256(KEK, label)     label "simsa/rate-limit-ip/v1" | "simsa/rate-limit-user/v1"
 *   stored = "v1:" + hex(HMAC-SHA256(subkey, `${bucket}::${value}`))
 *
 *   - The KEK string's UTF-8 bytes are the HMAC key (HMAC takes any length). The
 *     KEK's own format (base64 of 32 bytes) is preflight.ts's job; deriving a
 *     rate-limit key never throws on it.
 *   - The labels separate these subkeys from each other and from the KEK's
 *     token-encryption use, and version the scheme.
 *   - Rotating the KEK changes every stored value: counters restart, old rows
 *     simply age out (rate-limit-retention.ts, 48h).
 *
 * "v1:" (RATE_LIMIT_KEY_PREFIX) marks every key this code writes — IP, user AND
 * service buckets. A row without it was written before this scheme (the unkeyed
 * IP hashes, the plain-sha256 user rows); nothing reads it any more (every key
 * changed), and rate-limit-retention.ts deletes it on its next run whatever its
 * window. That is what makes "no unkeyed IP hash is left" true within one cron
 * interval of the deploy, instead of 48h + 6h later.
 *
 * No KEK (local dev, tests):
 *   - IP buckets fall back to ONE shared value per bucket,
 *     `v1:` + sha256(`${bucket}::no-key`) — failing toward "store nothing
 *     IP-derived", never toward the unkeyed IP hash. Every caller then shares
 *     that bucket's counter (it fills sooner — stricter, not looser). In local
 *     dev nothing changes: without cf-connecting-ip every request is "unknown".
 *   - userKey buckets fall back to an HMAC under a random key made once per
 *     isolate and never stored or exported: per-user counting still works inside
 *     the isolate (local dev keeps its per-user caps), nothing linkable reaches
 *     the table, and the counters restart when the isolate does (looser — the
 *     network and service caps still apply).
 *   Production always has the KEK (GitHub token encryption requires it), so both
 *   paths are dev-only; if one ever runs it logs one JSON line per isolate.
 *
 * Service buckets (a fixed key like "all") hold nothing personal: `v1:` + sha256.
 */
import type { Env } from "../env.js";

/** Format marker at the front of every key this code writes. Bump with the labels. */
export const RATE_LIMIT_KEY_PREFIX = "v1:";

/** Purpose label of the IP subkey. Bump the version to change the scheme. */
export const RATE_LIMIT_IP_KEY_LABEL = "simsa/rate-limit-ip/v1";

/** Purpose label of the userKey subkey. */
export const RATE_LIMIT_USER_KEY_LABEL = "simsa/rate-limit-user/v1";

/** The shared stand-in for the IP when no secret is configured. */
export const RATE_LIMIT_NO_KEY = "no-key";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

function importHmacKey(raw: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function hmacHex(key: CryptoKey, message: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

// One derived subkey per label per isolate, re-derived when the KEK value changes (rotation).
const cachedSubkeys = new Map<string, { kek: string; key: Promise<CryptoKey> }>();

function subkeyFor(kek: string, label: string): Promise<CryptoKey> {
  const cached = cachedSubkeys.get(label);
  if (cached && cached.kek === kek) return cached.key;
  const key = (async () => {
    const root = await importHmacKey(encoder.encode(kek));
    const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(label));
    return importHmacKey(derived);
  })();
  cachedSubkeys.set(label, { kek, key });
  // A failed derivation must not stick for the life of the isolate.
  key.catch(() => {
    if (cachedSubkeys.get(label)?.key === key) cachedSubkeys.delete(label);
  });
  return key;
}

// The no-KEK userKey fallback: random, non-extractable, made on first use (never
// at global scope — Workers forbid randomness there), gone with the isolate.
let ephemeralUserKey: Promise<CryptoKey> | null = null;

function ephemeralKey(): Promise<CryptoKey> {
  if (!ephemeralUserKey) {
    // 32 random bytes imported as a non-extractable key; the byte array is dropped here.
    const key = importHmacKey(crypto.getRandomValues(new Uint8Array(32)));
    ephemeralUserKey = key;
    key.catch(() => {
      if (ephemeralUserKey === key) ephemeralUserKey = null;
    });
  }
  return ephemeralUserKey;
}

const warned = { ip: false, user: false };

function warnNoKek(kind: "ip" | "user"): void {
  if (warned[kind]) return;
  warned[kind] = true;
  console.warn(
    JSON.stringify({
      event: `rate_limit_${kind}_key_fallback`,
      reason: "no_kek",
      effect:
        kind === "ip"
          ? "ip-keyed buckets share one counter per bucket; no IP-derived value is stored"
          : "user-keyed buckets use a per-isolate random key; counters restart with the isolate",
    }),
  );
}

function kekOf(env: Pick<Env, "CONCLAVE_TOKEN_KEK">): string | null {
  const kek = env.CONCLAVE_TOKEN_KEK;
  return typeof kek === "string" && kek.length > 0 ? kek : null;
}

/**
 * The value to store in `ip_hash` for an IP-keyed limit bucket.
 * `ip` is whatever the caller extracted (cf-connecting-ip, an x-forwarded-for
 * hop, "unknown"); it never reaches storage or logs.
 */
export async function ipRateLimitKey(
  env: Pick<Env, "CONCLAVE_TOKEN_KEK">,
  bucket: string,
  ip: string,
): Promise<string> {
  const kek = kekOf(env);
  if (!kek) {
    warnNoKek("ip");
    return RATE_LIMIT_KEY_PREFIX + (await sha256Hex(`${bucket}::${RATE_LIMIT_NO_KEY}`));
  }
  return RATE_LIMIT_KEY_PREFIX + (await hmacHex(await subkeyFor(kek, RATE_LIMIT_IP_KEY_LABEL), `${bucket}::${ip}`));
}

/**
 * The value to store in `ip_hash` for a userKey limit bucket. `userKey` never
 * reaches storage or logs, and without the KEK the stored value cannot be
 * matched against the user_key columns elsewhere in the DB.
 */
export async function userRateLimitKey(
  env: Pick<Env, "CONCLAVE_TOKEN_KEK">,
  bucket: string,
  userKey: string,
): Promise<string> {
  const kek = kekOf(env);
  if (!kek) {
    warnNoKek("user");
    return RATE_LIMIT_KEY_PREFIX + (await hmacHex(await ephemeralKey(), `${bucket}::${userKey}`));
  }
  return RATE_LIMIT_KEY_PREFIX + (await hmacHex(await subkeyFor(kek, RATE_LIMIT_USER_KEY_LABEL), `${bucket}::${userKey}`));
}

/** The value to store for a service-wide bucket (a fixed, non-personal key). */
export async function serviceRateLimitKey(bucket: string, key: string): Promise<string> {
  return RATE_LIMIT_KEY_PREFIX + (await sha256Hex(`${bucket}::${key}`));
}
