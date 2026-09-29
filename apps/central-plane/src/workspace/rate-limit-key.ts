/**
 * rate-limit-key.ts — the stored key of every IP-derived request-limit row
 * (workspace_rate_limit · demo_rate_limit `ip_hash`).
 *
 * Why (2026-09-29): the routes stored `sha256("workspace::" + ip)` — a hash
 * WITHOUT a secret. IPv4 has ~4.3 billion addresses, so anyone who can read the
 * table recovers every IP by hashing them all: a pseudonym in name only, an IP
 * in fact. The Train W network cap (rate-limit.ts, bucket `…-daily-ip`) did the
 * same, and the demo used a salt whose default was a public string in the code.
 *
 * Now every IP-derived key is a keyed HMAC-SHA256. No new secret is needed — a
 * purpose-bound subkey is derived from the existing CONCLAVE_TOKEN_KEK:
 *
 *   subkey = HMAC-SHA256(KEK, "simsa/rate-limit-ip/v1")
 *   stored = hex(HMAC-SHA256(subkey, `${bucket}::${ip}`))
 *
 *   - The KEK string's UTF-8 bytes are the HMAC key (HMAC takes any length). The
 *     KEK's own format (base64 of 32 bytes) is preflight.ts's job; deriving a
 *     rate-limit key never throws on it.
 *   - The label separates this subkey from the KEK's token-encryption use and
 *     versions the scheme (a change of method → "v2", which also starts every
 *     counter fresh — acceptable for hour/day windows).
 *   - Rotating the KEK changes every stored value: counters restart, old rows
 *     simply age out (rate-limit-retention.ts, 48h).
 *
 * No KEK (local dev, tests): the key falls back to ONE shared value per bucket,
 * `sha256(${bucket}::no-key)` — failing toward "store nothing IP-derived", never
 * toward the unkeyed IP hash. The cost is that every caller shares that bucket's
 * counter (it fills sooner — stricter per caller, not looser). Production always
 * has the KEK (GitHub token encryption requires it), so this path is dev-only;
 * if it ever runs it logs one JSON line per isolate.
 *
 * userKey buckets keep their plain sha256: a userKey is a random client-made id,
 * so there is no small input space to brute-force (and it is not an IP).
 */
import type { Env } from "../env.js";

/** Purpose label of the derived subkey. Bump the version to change the scheme. */
export const RATE_LIMIT_IP_KEY_LABEL = "simsa/rate-limit-ip/v1";

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

// One derived subkey per isolate, re-derived when the KEK value changes (rotation).
let cachedSubkey: { kek: string; key: Promise<CryptoKey> } | null = null;

function subkeyFor(kek: string): Promise<CryptoKey> {
  if (cachedSubkey && cachedSubkey.kek === kek) return cachedSubkey.key;
  const key = (async () => {
    const root = await importHmacKey(encoder.encode(kek));
    const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(RATE_LIMIT_IP_KEY_LABEL));
    return importHmacKey(derived);
  })();
  cachedSubkey = { kek, key };
  // A failed derivation must not stick for the life of the isolate.
  key.catch(() => {
    if (cachedSubkey?.key === key) cachedSubkey = null;
  });
  return key;
}

let warnedNoKey = false;

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
  const kek = env.CONCLAVE_TOKEN_KEK;
  if (typeof kek !== "string" || kek.length === 0) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        JSON.stringify({
          event: "rate_limit_ip_key_fallback",
          reason: "no_kek",
          effect: "ip-keyed buckets share one counter per bucket; no IP-derived value is stored",
        }),
      );
    }
    return sha256Hex(`${bucket}::${RATE_LIMIT_NO_KEY}`);
  }
  const subkey = await subkeyFor(kek);
  return toHex(await crypto.subtle.sign("HMAC", subkey, encoder.encode(`${bucket}::${ip}`)));
}
