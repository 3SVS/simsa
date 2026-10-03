#!/usr/bin/env node
/**
 * count-unindexed-training-copies — Train K · K-3 도구 (가격·동의 계획 §4 "철회·삭제", 0071).
 *
 * 왜: 학습 사본 색인(training_records_index, 0071)은 **생긴 뒤의 캡처**만 담는다. 그 전에 R2에 쌓인 사본은
 *   모두 본문에 subject_hash(= sha256(userKey))·project_id가 있어 사람·프로젝트를 **찾을 수는 있다**
 *   (PR #574 검증 #574-2로 정정 — 예전 문구 "여정 사본은 사람 기록이 어디에도 없다"는 틀렸다). 다만
 *   - 자동 경로(철회·프로젝트 삭제·6시간 크론)가 백필 없이 닿는 것은 검수 런 행(workspace_pr_review_runs.
 *     training_r2_key, 0057)이 **아직 가리키는** events/ 사본뿐이다.
 *   - 여정 사본(journey/…) 전부와, 검수 런 행이 사라진 events/ 사본(0071 이전에 삭제된 프로젝트의 사본·0057 이전
 *     캡처·키 기록 실패분)은 일회성 백필 scripts/backfill-training-index.mjs(적용은 별도 승인) 전까지 자동으로
 *     지워지지 않는다.
 * 방침의 "과거 일부 사본" 예외가 몇 개인지 세는 도구다. 지우지 않는다(읽기 전용).
 *
 * 무엇을 세나: 버킷의 events/ · journey/ · training/(0054 머리말에만 있던 옛 접두어 — 실제로 쓰였는지 확인용)
 * 아래 객체 수, 그리고 그중 --before 시각(0071 적용·배포 시각) **이전**에 마지막으로 쓰인 수.
 * 출력은 **개수뿐**이다 — 키(검수 런 id·프로젝트 id가 들어 있다)는 찍지 않는다.
 *
 * 비교할 D1 쪽 숫자(색인에 든 것)는 여기서 부르지 않는다 — 아래 SQL을 d1 콘솔/wrangler로 따로 본다:
 *   SELECT kind, COUNT(*) AS n, SUM(deleted_at IS NOT NULL) AS deleted FROM training_records_index GROUP BY kind;
 *
 * Usage:  node scripts/count-unindexed-training-copies.mjs --before=2026-10-01T00:00:00Z [--bucket=simsa-evidence]
 * Env:    R2_ACCOUNT_ID (없으면 CLOUDFLARE_ACCOUNT_ID) · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY
 *         — R2 API 토큰(**Object Read only**, 이 버킷만)으로 만든 S3 호환 키. 쓰기 권한은 필요 없다.
 *
 * 순수 부분(서명·XML 파싱·집계·인자)을 export해 test/count-unindexed-training-copies.test.mjs가 확인하고,
 * main만 네트워크(R2 S3 API ListObjectsV2)를 쓴다(d1-readonly-queries.mjs와 같은 구조).
 */
import { createHash, createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_BUCKET = "simsa-evidence";
export const PREFIXES = Object.freeze(["events/", "journey/", "training/"]);

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key, s) => createHmac("sha256", key).update(s, "utf8").digest();

/** RFC 3986 인코딩(S3 SigV4 규칙: A-Z a-z 0-9 - _ . ~ 만 그대로). */
export function uriEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * AWS Signature V4 — 본문 없는 GET 1건의 Authorization 헤더 재료.
 * @param {{ method: string, host: string, path: string, query: Record<string,string>, amzDate: string,
 *           region: string, service: string, accessKeyId: string, secretAccessKey: string }} p
 * @returns {{ signature: string, authorization: string, headers: Record<string,string>, canonicalQuery: string }}
 */
export function signV4(p) {
  const payloadHash = sha256Hex("");
  const date = p.amzDate.slice(0, 8);
  const canonicalQuery = Object.keys(p.query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(p.query[k])}`)
    .join("&");
  const canonicalHeaders = `host:${p.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${p.amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [p.method, p.path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${p.region}/${p.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", p.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${p.secretAccessKey}`, date), p.region), p.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    signature,
    canonicalQuery,
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": p.amzDate },
  };
}

const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * ListObjectsV2 응답 XML → { objects: [{ key, lastModified }], truncated, nextToken }.
 * 필요한 세 태그만 읽는 좁은 파서(의존성 없음).
 */
export function parseListObjectsV2(xml) {
  const objects = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = m[1] ?? "";
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
    const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(body)?.[1];
    if (key !== undefined) objects.push({ key: unescapeXml(key), lastModified: lastModified ?? null });
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const nextRaw = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { objects, truncated, nextToken: nextRaw === undefined ? null : unescapeXml(nextRaw) };
}

/** 한 접두어의 객체 목록 → { total, beforeCutoff, unknownTime }. 시각을 못 읽은 것은 따로 센다(추측하지 않는다). */
export function tally(objects, cutoffIso) {
  const cutoff = Date.parse(cutoffIso);
  let beforeCutoff = 0;
  let unknownTime = 0;
  for (const o of objects) {
    const t = o.lastModified ? Date.parse(o.lastModified) : NaN;
    if (Number.isNaN(t)) unknownTime++;
    else if (t < cutoff) beforeCutoff++;
  }
  return { total: objects.length, beforeCutoff, unknownTime };
}

/** --before=ISO (필수) · --bucket=이름. 잘못되면 { error }. */
export function parseArgs(argv) {
  const out = { bucket: DEFAULT_BUCKET, before: null };
  for (const a of argv) {
    if (a.startsWith("--before=")) out.before = a.slice("--before=".length);
    else if (a.startsWith("--bucket=")) out.bucket = a.slice("--bucket=".length);
    else return { error: `unknown argument: ${a}` };
  }
  if (!out.before || Number.isNaN(Date.parse(out.before))) return { error: "--before=<ISO time of the 0071 deploy> is required" };
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(out.bucket)) return { error: "invalid --bucket" };
  return out;
}

/** 마크다운 표(개수만). */
export function render(rows, before) {
  const lines = [
    `학습 사본 개수 (기준 시각 ${before} — 이 시각 이전 객체는 색인에 없을 수 있다)`,
    "",
    "| 접두어 | 전체 | 기준 시각 이전 | 시각 모름 |",
    "|---|---|---|---|",
  ];
  for (const r of rows) lines.push(`| ${r.prefix} | ${r.total} | ${r.beforeCutoff} | ${r.unknownTime} |`);
  lines.push(
    "",
    "기준 시각 이전 사본은 모두 본문의 subject_hash·project_id로 사람·프로젝트를 찾을 수 있다. 백필 전 자동 삭제(크론·철회·프로젝트 삭제)가 닿는 것은 검수 런 행이 아직 가리키는 events/ 사본뿐이고, journey/ 전부와 검수 런 행이 사라진 events/ 사본은 backfill-training-index.mjs(적용은 별도 승인) 뒤에 같은 경로로 지워진다.",
  );
  return lines.join("\n");
}

/** 한 접두어의 전체 목록(ListObjectsV2 페이지 이어받기). backfill-training-index.mjs도 쓴다. */
export async function listAll({ fetchImpl, accountId, bucket, prefix, accessKeyId, secretAccessKey, now = () => new Date() }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const objects = [];
  let token = null;
  for (let page = 0; page < 10_000; page++) {
    const query = { "list-type": "2", "max-keys": "1000", prefix, ...(token ? { "continuation-token": token } : {}) };
    const amzDate = now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const signed = signV4({ method: "GET", host, path: `/${bucket}`, query, amzDate, region: "auto", service: "s3", accessKeyId, secretAccessKey });
    const res = await fetchImpl(`https://${host}/${bucket}?${signed.canonicalQuery}`, {
      headers: { ...signed.headers, authorization: signed.authorization },
    });
    if (!res.ok) throw new Error(`R2 list ${prefix} failed: HTTP ${res.status}`);
    const parsed = parseListObjectsV2(await res.text());
    objects.push(...parsed.objects);
    if (!parsed.truncated || !parsed.nextToken) return objects;
    token = parsed.nextToken;
  }
  throw new Error(`R2 list ${prefix}: too many pages`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(2);
  }
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.error("R2_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY are required (read-only R2 token).");
    process.exit(2);
  }
  const rows = [];
  for (const prefix of PREFIXES) {
    const objects = await listAll({ fetchImpl: fetch, accountId, bucket: args.bucket, prefix, accessKeyId, secretAccessKey });
    rows.push({ prefix, ...tally(objects, args.before) });
  }
  console.log(render(rows, args.before));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
