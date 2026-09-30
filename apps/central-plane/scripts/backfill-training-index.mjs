#!/usr/bin/env node
/**
 * backfill-training-index — Train K · K-3 일회성 도구 (PR #574 검증 #574-2).
 *
 * 왜: 학습 사본 색인(training_records_index, 0071)은 생긴 뒤의 캡처만 담는다. 그 전에 R2에 쌓인 사본은 **키**에
 * 사람이 없지만(여정 키의 한글 프로젝트 id는 `_`로 뭉개진다), **본문**에는 처음부터(#198 검수 사본, #469 여정
 * 사본) subject_hash = sha256(userKey)(솔트 없음)와 원문 project_id가 들어 있다. user_key 원문은
 * workspace_training_consent에 평문으로 있으므로(캡처는 동의 행이 있어야만 일어났다) 해시를 대조하면 사람이 1:1로
 * 나온다. 이 도구는 그 대조로 과거 사본을 색인에 넣는 SQL 파일을 만든다 — 넣고 나면 철회·프로젝트 삭제·6시간
 * 크론이 과거분까지 같은 경로로 지운다.
 *
 * 무엇을 하나: (1) R2 목록 + 본문 읽기(읽기 전용 키) (2) 본문의 subject_hash를 --user-keys의 sha256과 대조
 * (3) SQL 파일 쓰기. **D1에 쓰지 않는다** — SQL 파일 적용은 별도 승인 뒤 사람이 한다.
 *
 * 만든 SQL이 적용 때 하는 일(한 사본 = 한 문장, 다시 적용해도 같다):
 *   - 같은 r2_key가 이미 색인에 있으면 건너뛴다(0071 이후 캡처·'trl_' 옮김과 겹치지 않게).
 *   - 행 id = 'tri_' + sha256(r2_key) 앞 32자(캡처와 같은 규칙 — trainingIndexId).
 *   - delete_requested_at: 그 사람이 지금 동의 중(consented = 1)이고 프로젝트가 그 사람 것으로 남아 있으면 NULL
 *     (색인만 — 나중에 철회·프로젝트 삭제 때 지워진다). 아니면(철회했거나, 프로젝트가 이미 삭제됐으면) **적용 시각**
 *     → **다음 6시간 크론이 R2에서 지운다(되돌릴 수 없다)**. 방침: 철회·프로젝트 삭제 시 학습 사본을 지운다.
 *
 * 찾지 못하는 것(요약에 개수로 나온다): 본문을 못 읽거나 subject_hash가 없는 사본(invalid), 해시가 어느 동의
 * 행과도 맞지 않는 사본(unmatched — 동의 행이 지워진 경우). 이들은 문의로 처리한다.
 *
 * Usage (cwd: apps/central-plane):
 *   1) 동의 행의 user_key 내보내기(D1 읽기 전용 토큰, 저장소 **밖** 임시 폴더로):
 *      node node_modules/wrangler/bin/wrangler.js d1 execute conclave-ai --remote --json \
 *        --command "SELECT user_key FROM workspace_training_consent" > <임시>/consent-keys.json
 *   2) node scripts/backfill-training-index.mjs --user-keys=<임시>/consent-keys.json --out=<임시>/backfill.sql
 *        [--bucket=simsa-evidence] [--before=<0071 배포 시각 ISO — 이후에 쓰인 객체는 읽지 않는다>]
 *      Env: R2_ACCOUNT_ID(없으면 CLOUDFLARE_ACCOUNT_ID) · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY (Object Read only)
 *   3) SQL 검토 → **별도 승인 뒤에만**: wrangler d1 execute conclave-ai --remote --file=<임시>/backfill.sql
 *   4) 두 임시 파일 삭제 — user_key 원문과 프로젝트 id가 들어 있다(그래서 --out은 저장소 안을 거부한다).
 * stdout에는 개수만 나온다(키·user_key·프로젝트 id 없음).
 *
 * 순수 부분(본문 파싱·해시 대조·SQL 생성·인자)을 export해 test/backfill-training-index.test.mjs가 실제
 * SQLite(0001~0071)에 적용까지 확인하고, main만 네트워크(R2 S3 API)를 쓴다.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_BUCKET, PREFIXES, listAll, signV4, uriEncode } from "./count-unindexed-training-copies.mjs";

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** 캡처와 같은 색인 행 id(training-records-index.ts trainingIndexId). */
export function indexIdForKey(r2Key) {
  return `tri_${sha256Hex(r2Key).slice(0, 32)}`;
}

/** 접두어 → 색인 kind. 모르는 접두어는 null(건너뜀). training/은 0054 머리말의 옛 접두어(실제로 쓰였는지 확인용). */
export function kindForKey(key) {
  if (key.startsWith("journey/")) return "journey";
  if (key.startsWith("events/") || key.startsWith("training/")) return "training";
  return null;
}

const MAX_PROJECT_ID = 512;

/**
 * 사본 본문(JSON 문자열) → { ok:true, subjectHash, projectId, capturedAt } | { ok:false, reason }.
 * 추측하지 않는다: subject_hash는 64자리 소문자 hex만, project_id는 문자열만(아니면 null), captured_at은 날짜로
 * 읽히는 문자열만(아니면 null — 호출자가 R2 LastModified로 채운다).
 */
export function parseCopyBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "not_object" };
  const subjectHash = body.subject_hash;
  if (typeof subjectHash !== "string" || !/^[0-9a-f]{64}$/.test(subjectHash)) return { ok: false, reason: "no_subject_hash" };
  const pid = body.project_id;
  if (pid !== undefined && pid !== null && typeof pid !== "string") return { ok: false, reason: "bad_project_id" };
  if (typeof pid === "string" && (pid.length === 0 || pid.length > MAX_PROJECT_ID || pid.includes("\u0000"))) {
    return { ok: false, reason: "bad_project_id" };
  }
  const cap = body.captured_at;
  const capturedAt = typeof cap === "string" && !Number.isNaN(Date.parse(cap)) ? cap : null;
  return { ok: true, subjectHash, projectId: typeof pid === "string" ? pid : null, capturedAt };
}

/**
 * --user-keys 파일 → user_key 목록. wrangler `d1 execute --json` 출력([{ results:[{user_key}] }]),
 * [{user_key}] 배열, 문자열 배열을 받는다. 그 밖의 모양은 던진다(빈 목록으로 조용히 넘어가지 않게).
 */
export function parseUserKeysFile(text) {
  const data = JSON.parse(text);
  const out = [];
  const take = (row) => {
    if (typeof row === "string" && row) out.push(row);
    else if (row && typeof row === "object" && typeof row.user_key === "string" && row.user_key) out.push(row.user_key);
    else throw new Error("unrecognised user-keys row");
  };
  if (!Array.isArray(data)) throw new Error("user-keys file must be a JSON array");
  for (const item of data) {
    if (item && typeof item === "object" && Array.isArray(item.results)) item.results.forEach(take);
    else take(item);
  }
  if (out.length === 0) throw new Error("user-keys file has no user_key");
  return [...new Set(out)];
}

/** user_key 목록 → Map(sha256(user_key) → user_key). 캡처와 같은 해시(솔트 없음, UTF-8). */
export function hashUserKeys(userKeys) {
  const map = new Map();
  for (const k of userKeys) map.set(sha256Hex(k), k);
  return map;
}

/**
 * copies = [{ key, lastModified, text }] → { rows, counts }. rows = 색인에 넣을 사본(사람을 찾은 것만).
 * counts = { scanned, matched, unmatched, invalid, byKind:{training,journey} } — 개수만(요약·로그용).
 */
export function planBackfill(copies, hashToUser) {
  const rows = [];
  const counts = { scanned: 0, matched: 0, unmatched: 0, invalid: 0, byKind: { training: 0, journey: 0 } };
  for (const c of copies) {
    counts.scanned++;
    const kind = kindForKey(c.key);
    const parsed = kind ? parseCopyBody(c.text) : { ok: false };
    if (!kind || !parsed.ok) {
      counts.invalid++;
      continue;
    }
    const userKey = hashToUser.get(parsed.subjectHash);
    if (!userKey) {
      counts.unmatched++;
      continue;
    }
    const capturedAt = parsed.capturedAt ?? (c.lastModified && !Number.isNaN(Date.parse(c.lastModified)) ? c.lastModified : "unknown");
    rows.push({ id: indexIdForKey(c.key), userKey, projectId: parsed.projectId, r2Key: c.key, kind, capturedAt });
    counts.matched++;
    counts.byKind[kind]++;
  }
  return { rows, counts };
}

/** SQL 문자열 리터럴. null → NULL. 작은따옴표는 두 번. NUL은 거부(SQLite 문자열을 자른다). */
export function sqlString(v) {
  if (v === null || v === undefined) return "NULL";
  const s = String(v);
  if (s.includes("\u0000")) throw new Error("NUL in SQL value");
  return `'${s.replace(/'/g, "''")}'`;
}

/** 한 사본의 문장. 적용 시점의 D1 상태로 삭제 요청 여부를 정한다(위 머리말). */
export function backfillStatement(row, requestedAt) {
  const uk = sqlString(row.userKey);
  const pid = sqlString(row.projectId);
  const key = sqlString(row.r2Key);
  return `INSERT INTO training_records_index (id, user_key, project_id, r2_key, kind, captured_at, delete_requested_at, deleted_at)
SELECT ${sqlString(row.id)}, ${uk}, ${pid}, ${key}, ${sqlString(row.kind)}, ${sqlString(row.capturedAt)},
  CASE WHEN EXISTS (SELECT 1 FROM workspace_training_consent c WHERE c.user_key = ${uk} AND c.consented = 1)
        AND (${pid} IS NULL OR EXISTS (SELECT 1 FROM workspace_projects p WHERE p.id = ${pid} AND p.user_key = ${uk}))
       THEN NULL ELSE ${sqlString(requestedAt)} END,
  NULL
 WHERE NOT EXISTS (SELECT 1 FROM training_records_index i WHERE i.r2_key = ${key})
ON CONFLICT(id) DO NOTHING;`;
}

/** SQL 파일 전체. 머리말은 주석(사람이 읽고 승인하는 것). */
export function renderBackfillSql(rows, requestedAt) {
  const head = [
    `-- backfill-training-index (Train K · PR #574 #574-2) — 생성 ${requestedAt}`,
    `-- 0071 이전 학습 사본 ${rows.length}개를 training_records_index에 넣는다(이미 색인된 키는 건너뜀).`,
    "-- 적용하면: 철회한 사람·이미 삭제된 프로젝트의 사본에 삭제 요청이 찍히고, 다음 6시간 크론이 R2에서 지운다(되돌릴 수 없다).",
    "-- 이 파일에는 user_key 원문과 프로젝트 id가 들어 있다 — 적용 뒤 지운다. 적용은 별도 승인 뒤에만.",
  ];
  return `${head.join("\n")}\n${rows.map((r) => backfillStatement(r, requestedAt)).join("\n")}\n`;
}

/** stdout 요약 — 개수만. */
export function renderSummary(counts, outPath) {
  return [
    "학습 사본 백필 계획(개수만)",
    "",
    "| 읽은 사본 | 사람을 찾음 | 검수 사본 | 여정 사본 | 해시 불일치 | 본문 못 읽음 |",
    "|---|---|---|---|---|---|",
    `| ${counts.scanned} | ${counts.matched} | ${counts.byKind.training} | ${counts.byKind.journey} | ${counts.unmatched} | ${counts.invalid} |`,
    "",
    `SQL: ${outPath} — 적용은 별도 승인 뒤에만(wrangler d1 execute conclave-ai --remote --file=…). 적용 뒤 이 파일과 user-keys 파일을 지운다.`,
  ].join("\n");
}

/** 저장소 뿌리(.git이 있는 가장 가까운 상위 폴더). 없으면 null. */
export function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** --user-keys=경로 --out=경로 (필수) · --bucket · --before. out이 저장소 안이면 거부(user_key 원문 커밋 사고 방지). */
export function parseArgs(argv, { repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url))) } = {}) {
  const out = { bucket: DEFAULT_BUCKET, before: null, userKeys: null, out: null };
  for (const a of argv) {
    if (a.startsWith("--user-keys=")) out.userKeys = a.slice("--user-keys=".length);
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
    else if (a.startsWith("--bucket=")) out.bucket = a.slice("--bucket=".length);
    else if (a.startsWith("--before=")) out.before = a.slice("--before=".length);
    else return { error: `unknown argument: ${a}` };
  }
  if (!out.userKeys) return { error: "--user-keys=<wrangler --json export of workspace_training_consent.user_key> is required" };
  if (!out.out) return { error: "--out=<path outside the repository> is required" };
  if (out.before !== null && Number.isNaN(Date.parse(out.before))) return { error: "--before must be an ISO time" };
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(out.bucket)) return { error: "invalid --bucket" };
  if (repoRoot) {
    const rel = path.relative(repoRoot, path.resolve(out.out));
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return { error: "--out must be outside the repository (it holds raw user keys)" };
  }
  return out;
}

async function getObjectText({ fetchImpl, accountId, bucket, key, accessKeyId, secretAccessKey, now = () => new Date() }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const objectPath = `/${bucket}/${key.split("/").map(uriEncode).join("/")}`;
  const amzDate = now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const signed = signV4({ method: "GET", host, path: objectPath, query: {}, amzDate, region: "auto", service: "s3", accessKeyId, secretAccessKey });
  const res = await fetchImpl(`https://${host}${objectPath}`, { headers: { ...signed.headers, authorization: signed.authorization } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 get failed: HTTP ${res.status}`);
  return res.text();
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
  const hashToUser = hashUserKeys(parseUserKeysFile(readFileSync(args.userKeys, "utf8")));
  const cutoff = args.before ? Date.parse(args.before) : null;
  const copies = [];
  const r2 = { fetchImpl: fetch, accountId, bucket: args.bucket, accessKeyId, secretAccessKey };
  for (const prefix of PREFIXES) {
    const objects = await listAll({ ...r2, prefix });
    const wanted = objects.filter((o) => {
      if (cutoff === null) return true;
      const t = o.lastModified ? Date.parse(o.lastModified) : NaN;
      return Number.isNaN(t) || t < cutoff; // 시각을 모르면 읽는다(이미 색인된 키는 SQL이 건너뛴다)
    });
    // 동시 8개씩 — 한 번에 버킷 전체를 두드리지 않는다.
    for (let i = 0; i < wanted.length; i += 8) {
      const batch = wanted.slice(i, i + 8);
      const texts = await Promise.all(batch.map((o) => getObjectText({ ...r2, key: o.key })));
      batch.forEach((o, j) => {
        const text = texts[j];
        if (text !== null && text !== undefined) copies.push({ key: o.key, lastModified: o.lastModified, text });
      });
    }
  }
  const plan = planBackfill(copies, hashToUser);
  writeFileSync(args.out, renderBackfillSql(plan.rows, new Date().toISOString()), { encoding: "utf8", mode: 0o600 });
  console.log(renderSummary(plan.counts, args.out));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
