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
 *
 * The network, not the address (2026-10-01): an IP bucket counts per NETWORK —
 * ipRateLimitKey passes the IP through networkPrefix() before hashing:
 *   - IPv4: the address itself, byte for byte (so every IPv4 counter written
 *     before this change is still the same row — no reset).
 *   - IPv6: the first 64 bits, "a:b:c:d::/64" — one LAN. Any address inside it
 *     can be picked at will, so the full address let one caller rotate through
 *     2^64 fresh counters: measured on 3a1ca07, 60 inspections from one /64 with
 *     rotating addresses were all accepted against a network cap of 30, and 50
 *     repairs from one /64 drained the whole service's daily repair bucket.
 *   - IPv4-mapped IPv6 (::ffff:a.b.c.d) is the IPv4 address — the same row as
 *     the plain dotted form.
 *   - Anything that is not an IP ("", "unknown", an already-tagged network like
 *     "v6:…/64") is passed through unchanged, so a caller that normalizes on its
 *     own keeps its keys.
 * The label and the "v1:" marker stay as they were: IPv4 rows continue, and the
 * old per-address IPv6 rows simply stop being read (their window ends — at most
 * the current hour / UTC day restarts once for an IPv6 caller — and the 48h
 * window purge in rate-limit-retention.ts removes them like any other row).
 *
 * But a /64 is not one caller's whole allocation (PR #580 review P1): home
 * prefix delegation hands out a /56 (RIPE-690) or /60, and a free tunnel broker
 * a routed /48 — measured on the /64-only code, one /48 gave 65,536 distinct
 * 'repair-daily-ip' rows and one /56 gave 256, so 16 /64s of one /48 took all
 * 50 of the service's daily repairs. The atomic daily caps therefore count an
 * IPv6 caller at TWO widths (rate-limit.ts consumeDailyCaps): its /64 row (this
 * key, the cap's own limit) AND the /48 around it (ipWideRateLimitKey, a larger
 * share that stays under half of the service bucket). The /48 row lives under
 * its own bucket name (`${bucket}/48`), so it can never be a /64 row. The older
 * read-then-increment hourly caps (workspace.ts, document intake) and the demo
 * count the /64 only — see docs/simsa-rate-limit-network-units-2026-10-01.md.
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
 * The longest textual IPv6 address (eight groups with an embedded IPv4 tail)
 * is 45 characters; a zone id ("%eth0") adds a few. Anything longer is not an
 * address this parser reads — it is passed through as it is.
 */
const MAX_IP_TEXT_LENGTH = 64;

const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const DEC_OCTET = /^[0-9]{1,3}$/;

/**
 * "a.b.c.d" → four bytes, or null. Only used for an IPv6 address's dotted tail.
 *
 * Leading zeros are accepted here on purpose (PR #580 review P2):
 * "::ffff:001.002.003.004" is read as 1.2.3.4 — stricter than node:net, which
 * rejects it. Being lenient only ever gathers spellings of one address into ONE
 * row; it never splits one caller into more counters. A plain dotted IPv4 is
 * never parsed at all (byte-for-byte continuity of the IPv4 rows), so
 * "001.002.003.004" stays its own row. Neither spelling comes from
 * cf-connecting-ip; only the x-forwarded-for fallback (no Cloudflare in front)
 * can bring one.
 */
function parseDottedIpv4(s: string): [number, number, number, number] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!DEC_OCTET.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  const [a = 0, b = 0, c = 0, d = 0] = bytes;
  return [a, b, c, d];
}

/**
 * Lower-case IPv6 text (zone id already dropped) → its eight 16-bit groups, or
 * null when it is not a valid address. Handles "::" compression and a dotted
 * IPv4 tail ("::ffff:198.51.100.7"). No backtracking regex: split + a fixed
 * group pattern, on an input already capped at MAX_IP_TEXT_LENGTH.
 */
function parseIpv6Groups(text: string): number[] | null {
  let s = text;
  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseDottedIpv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = left;
  } else {
    // "::" stands for one or more zero groups (RFC 4291 §2.2).
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!HEX_GROUP.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/** How wide an IPv6 network is counted: one LAN (/64), or the site allocation around it (/48). */
export type Ipv6PrefixBits = 48 | 64;

/** The wider IPv6 tier of the daily caps (rate-limit.ts consumeDailyCaps). */
export const IPV6_WIDE_PREFIX_BITS = 48;

/**
 * Bucket-name suffix of the wider tier's rows. Its stored input is
 * `${bucket}/48::…` and a /64 row's is `${bucket}::…`, so no caller text can
 * make one the other.
 */
export const IPV6_WIDE_BUCKET_SUFFIX = "/48";

/** A client IP read once: an IPv4 address (only ever from an IPv4-mapped IPv6), or IPv6 groups. */
type ReadIp = { kind: "ipv4"; dotted: string } | { kind: "ipv6"; groups: readonly number[] };

/**
 * IPv6 text → its address; null for everything else (plain IPv4 text — never
 * rewritten — and anything that is not an IP). IPv4-mapped (::ffff:a.b.c.d)
 * comes back as its IPv4 address.
 */
function readIpv6(ip: string): ReadIp | null {
  if (typeof ip !== "string" || ip.length === 0 || ip.length > MAX_IP_TEXT_LENGTH) return null;
  if (!ip.includes(":")) return null; // IPv4 (or not an IP): the address itself, never rewritten.
  let text = ip.trim().toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  const g = parseIpv6Groups(text);
  if (!g) return null;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return { kind: "ipv4", dotted: `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}` };
  }
  return { kind: "ipv6", groups: g };
}

/** "a:b:c:d::/64" or "a:b:c::/48" — lower-case hex, no leading zeros. */
function ipv6PrefixText(groups: readonly number[], bits: Ipv6PrefixBits): string {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0] = groups;
  const head = `${g0.toString(16)}:${g1.toString(16)}:${g2.toString(16)}`;
  return bits === 48 ? `${head}::/48` : `${head}:${g3.toString(16)}::/64`;
}

/**
 * The network a client IP belongs to — the unit every IP-keyed limit counts.
 *
 *   IPv4                    → unchanged ("198.51.100.7")
 *   IPv6                    → first 64 bits, "2001:db8:abcd:12::/64" (lower-case,
 *                             no leading zeros — "2001:0DB8:ABCD:0012::1" is the same network);
 *                             with ipv6Bits = 48 the first 48, "2001:db8:abcd::/48"
 *   IPv4-mapped (::ffff:…)  → the dotted IPv4 ("::ffff:198.51.100.7" → "198.51.100.7"), at any width
 *   not an IP               → unchanged ("", "unknown", "v6:2001:db8::/64", "2001:db8::/48", …)
 *
 * Idempotent: networkPrefix(networkPrefix(x)) === networkPrefix(x). The /64
 * text matches PR #575's hosting reporterNetwork() without its "v6:" tag.
 * The /48 is always computed from the ADDRESS, never from a /64 text (which is
 * "not an IP" here and passes through).
 */
export function networkPrefix(ip: string, ipv6Bits: Ipv6PrefixBits = 64): string {
  const read = readIpv6(ip);
  if (!read) return ip;
  return read.kind === "ipv4" ? read.dotted : ipv6PrefixText(read.groups, ipv6Bits);
}

/**
 * The value to store in `ip_hash` for an IP-keyed limit bucket.
 * `ip` is whatever the caller extracted (cf-connecting-ip, an x-forwarded-for
 * hop, "unknown"); it never reaches storage or logs. It is counted per network
 * (networkPrefix): every IP-keyed limit — the hourly workspace routes, the
 * document intake, the demo and the daily network caps — goes through here, so
 * no caller has to normalize on its own.
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
  return (
    RATE_LIMIT_KEY_PREFIX +
    (await hmacHex(await subkeyFor(kek, RATE_LIMIT_IP_KEY_LABEL), `${bucket}::${networkPrefix(ip)}`))
  );
}

/**
 * The wider-tier row of an IP-keyed bucket: the /48 around an IPv6 caller,
 * stored as `"v1:" + HMAC(subkey, `${bucket}/48::a:b:c::/48`)` under the same
 * IP subkey. null when there is no wider tier to count:
 *   - IPv4 and IPv4-mapped callers (an IPv4 address is already the whole unit),
 *   - anything that is not an IPv6 address ("unknown", a tagged "v6:…/64", …),
 *   - no KEK — the /64 bucket is then ONE shared counter for every caller
 *     (ipRateLimitKey), already stricter than any wider tier, and not even
 *     "this caller was IPv6" should reach the table.
 */
export async function ipWideRateLimitKey(
  env: Pick<Env, "CONCLAVE_TOKEN_KEK">,
  bucket: string,
  ip: string,
): Promise<string | null> {
  const read = readIpv6(ip);
  if (!read || read.kind !== "ipv6") return null;
  const kek = kekOf(env);
  if (!kek) {
    warnNoKek("ip");
    return null;
  }
  const network = ipv6PrefixText(read.groups, IPV6_WIDE_PREFIX_BITS);
  return (
    RATE_LIMIT_KEY_PREFIX +
    (await hmacHex(await subkeyFor(kek, RATE_LIMIT_IP_KEY_LABEL), `${bucket}${IPV6_WIDE_BUCKET_SUFFIX}::${network}`))
  );
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
