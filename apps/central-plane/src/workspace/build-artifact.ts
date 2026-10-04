/**
 * workspace/build-artifact.ts — SI 티어 Train B · B-5b-4 (S3): 빌드 산출물 계약 (외부 경계 — Zod).
 *
 * 빌더 컨테이너는 게이트 초록불 뒤 산출물(Worker 모듈 · 정적 자산 · D1 마이그레이션 · 소스 트리)을
 * POST /internal/build-artifact로 올린다. 컨테이너는 LLM이 만든 코드를 실행한 곳이다 — 그 산출물은 **신뢰하지 않는 입력**이다:
 *   - 본문 상한(BUILD_ARTIFACT_LIMITS.maxBodyBytes)은 스트림을 세며 읽는다(content-length를 믿지 않는다).
 *   - Zod strict: 모르는 키 거부. 파일 목록의 개수·바이트 상한은 [PILOT] 상수 — 넘으면 artifact_too_large(413).
 *   - 경로 정규화(normalizeArtifactPath): NFC · `\` → `/` · 절대 경로·드라이브 문자·`..`·`.`·빈 조각·제어 문자·`.git` 거부.
 *     소스 경로는 스캐폴드 제외 규칙(node_modules·dist·dotfile 기본 거부·키 묶음)을 **다시** 적용한다(수집기가 이미 걸렀어도).
 *   - 모듈 이름은 ASCII만(multipart 파트 이름이자 import 지정자) · main 모듈은 .js/.mjs · 마이그레이션 이름은 MIGRATION_NAME_RE.
 *   - 배포 설정(호환 날짜·자산 라우팅)은 **여기서 받지 않는다** — Worker 상수(hosting-provision.ts)만 쓴다.
 *   - 자산 해시는 Worker가 스스로 계산한다(hosting-provision uploadUserWorkerAssets) — 컨테이너가 준 해시로 계정 공용 자산
 *     저장소를 오염시키지 못하게(해시 = 내용 주소).
 *
 * Rule 6(한글·비ASCII): 파일 **경로는 원본(NFC) 그대로** 둔다 — 저장소 push·정적 자산 URL·표시에 그 이름이 필요하다.
 * **저장 키는 ASCII**: R2 키 = `builds/<jobId>/artifact.json`(jobId = `bj_<hex>`) — 파일 이름은 키에 들어가지 않고 JSON 안에만 있다.
 * 산출물 상한은 컨테이너 수집기(builder-container/artifact-collect.mjs ARTIFACT_LIMITS)와 같은 값이다(테스트가 비교).
 */
import { z } from "zod";

/**
 * [PILOT] 산출물 상한. 컨테이너 수집기 ARTIFACT_LIMITS와 같은 값(test/train-b-b5b-s3-deploy.test.mjs가 비교).
 *
 * PR #569 S3 검증 결함 4 — **Worker isolate 메모리(128MB, 같은 isolate의 다른 요청과 함께 쓴다)가 기준**이다. 종전 상한(본문 26MiB ·
 * 구역 합계 18.5MiB)에서는 본문 텍스트 · 파싱본 · 저장용 재직렬화본(한글 경로면 2바이트 문자열)이 동시에 살아 요청 하나가
 * ≈124MiB를 붙잡았다(실측). 이제 ① 본문은 **ASCII JSON**(비ASCII는 \u 이스케이프 — 한 바이트 문자열) ② R2에는 받은 바이트를
 * 그대로(재직렬화 없음) ③ 파싱 뒤 텍스트를 놓는다 → 최악 ≈ 본문 × 2~3. 본문 상한 13MiB → 최악 ≈ 40MiB 아래(메모리 회귀 테스트).
 * 생성 앱(Hono Worker + Vite 클라이언트)의 실측 크기는 번들 수백 KB · 자산 1MB 안팎 · 소스(잠금 파일 64KB 포함) 수백 KB다.
 */
export const BUILD_ARTIFACT_LIMITS = Object.freeze({
  /** 요청 본문(ASCII JSON, base64 포함) — 아래 합계 8.25 MiB × 4/3 ≈ 11 MiB + 틀(이스케이프된 한글 경로 포함). */
  maxBodyBytes: 13 * 1024 * 1024,
  maxModules: 20,
  /** Worker 모듈 합계(디코드 바이트). WfP 스크립트 상한보다 작게. */
  maxModuleBytes: 3 * 1024 * 1024,
  maxAssets: 300,
  maxAssetBytes: 3 * 1024 * 1024,
  maxAssetFileBytes: 2 * 1024 * 1024,
  maxMigrations: 50,
  maxMigrationBytes: 256 * 1024,
  /** 소스 파일 수 — Git Data API push가 파일마다 blob 요청 하나(Worker 서브요청 상한 안에서). */
  maxSourceFiles: 300,
  maxSourceBytes: 2 * 1024 * 1024,
  maxSourceFileBytes: 256 * 1024,
});

/** R2에 둔 산출물의 형식 표지(customMetadata.format) — 받은 본문 바이트 그대로. 읽는 쪽은 parseBuildArtifactBytes로 다시 검증·정규화한다. */
export const BUILD_ARTIFACT_STORAGE_FORMAT = "artifact-body-v1";

/** 컨테이너 수집기 MIGRATION_NAME_RE와 같다 — 이름이 d1_migrations 기록 SQL에 따옴표로 들어간다(따옴표·공백 불가). */
export const MIGRATION_NAME_RE = /^[0-9]{4}_[A-Za-z0-9_-]{1,80}\.sql$/;
/** 컨테이너 수집기 MODULE_NAME_RE와 같다. */
export const MODULE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.(?:js|mjs|wasm)$/;
/** jobId 모양(build-job-db randId("bj")) — R2 키에 들어간다. */
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
/**
 * Zod 단계의 거친 상한(파싱 일 자체를 묶는다 — 본문이 이미 maxBodyBytes 안이다). 세밀한 [PILOT] 상한(개수·바이트)은 파싱 뒤에
 * 세어 413 artifact_too_large로 답한다 — 크기 초과가 "형식 오류(400)"로 보이지 않게.
 */
const HARD_MAX_ITEMS = 5_000;
const HARD_MAX_B64 = BUILD_ARTIFACT_LIMITS.maxBodyBytes;

/** 스캐폴드·수집기와 같은 제외 규칙(builder-run.mjs isScaffoldExcluded) — 경로 조각 하나. */
const SOURCE_ALLOWED_DOTFILES = new Set([".gitignore", ".env.example"]);
const SOURCE_EXCLUDED_NAMES = new Set(["node_modules", "dist"]);
const SOURCE_SECRET_FILE_RE = /\.(pem|key|p12|pfx)$/i;
export function isSourceSegmentExcluded(name: string): boolean {
  if (SOURCE_EXCLUDED_NAMES.has(name)) return true;
  if (name.startsWith(".")) return !SOURCE_ALLOWED_DOTFILES.has(name);
  return SOURCE_SECRET_FILE_RE.test(name);
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_PATH_CHARS = 500;
const MAX_SEGMENT_BYTES = 255;

/**
 * 산출물 파일 경로 정규화(상대 경로). 반환 { ok, path } | { ok:false, reason }. 원본 문자(한글 등)는 보존 — NFC로만 맞춘다.
 * 거부: 빈 값 · 제어 문자 · 절대 경로(`/`·`~`·드라이브 문자·UNC) · 빈 조각(`a//b`) · `.`·`..` 조각 · `.git` 조각(대소문자 무관) ·
 * 조각 255바이트 초과 · 전체 500자 초과.
 */
export function normalizeArtifactPath(raw: unknown): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "empty" };
  const s = raw.normalize("NFC").replace(/\\/g, "/");
  if (CONTROL_RE.test(s)) return { ok: false, reason: "control_char" };
  if (s.length > MAX_PATH_CHARS) return { ok: false, reason: "too_long" };
  if (/^(\/|~|[A-Za-z]:(\/|$)|\/\/)/.test(s)) return { ok: false, reason: "absolute" };
  const parts = s.split("/");
  const enc = new TextEncoder();
  for (const p of parts) {
    if (p === "") return { ok: false, reason: "empty_segment" };
    if (p === "." || p === "..") return { ok: false, reason: "dot_segment" };
    if (p.toLowerCase() === ".git") return { ok: false, reason: "git_dir" };
    if (enc.encode(p).length > MAX_SEGMENT_BYTES) return { ok: false, reason: "segment_too_long" };
  }
  return { ok: true, path: parts.join("/") };
}

const B64 = z.string().max(HARD_MAX_B64).refine((s) => s.length % 4 === 0 && BASE64_RE.test(s), { message: "not base64" });
const ModuleFileSchema = z.object({ name: z.string().min(1).max(200), base64: B64 }).strict();
const AssetFileSchema = z.object({ path: z.string().min(2).max(MAX_PATH_CHARS + 1), base64: B64 }).strict();
const MigrationFileSchema = z.object({ name: z.string().min(1).max(100), base64: B64 }).strict();
const SourceFileSchema = z.object({ path: z.string().min(1).max(MAX_PATH_CHARS), base64: B64, executable: z.boolean().optional() }).strict();
const SummarySchema = z
  .object({
    commits: z.number().int().min(0).max(100_000),
    wbsDone: z.number().int().min(0).max(1_000),
    wbsFailed: z.array(z.string().max(40)).max(120),
    gateRounds: z.number().int().min(0).max(100),
  })
  .strict();

export const BuildArtifactBodySchema = z
  .object({
    jobId: z.string().regex(JOB_ID_RE),
    worker: z.object({ mainModule: z.string().min(1).max(200), modules: z.array(ModuleFileSchema).min(1).max(HARD_MAX_ITEMS) }).strict(),
    assets: z.array(AssetFileSchema).max(HARD_MAX_ITEMS),
    migrations: z.array(MigrationFileSchema).max(HARD_MAX_ITEMS),
    source: z.array(SourceFileSchema).max(HARD_MAX_ITEMS),
    summary: SummarySchema.optional(),
  })
  .strict();

export type BuildArtifactSummary = z.infer<typeof SummarySchema>;

/** base64 길이 → 디코드 바이트 수(디코드하지 않고). */
export function base64DecodedBytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export type BuildArtifactModule = { name: string; base64: string; bytes: number; kind: "esm" | "wasm" };
export type BuildArtifactAsset = { path: string; base64: string; bytes: number };
export type BuildArtifactMigration = { name: string; sql: string; base64: string; bytes: number };
export type BuildArtifactSource = { path: string; base64: string; bytes: number; executable: boolean };
export type BuildArtifactStats = Record<"modules" | "assets" | "migrations" | "source", { count: number; bytes: number }>;

/** 검증·정규화를 마친 산출물. 경로는 원본(NFC) — 표시·push·자산 URL용. */
export type BuildArtifact = {
  jobId: string;
  worker: { mainModule: string; modules: BuildArtifactModule[] };
  assets: BuildArtifactAsset[];
  migrations: BuildArtifactMigration[];
  source: BuildArtifactSource[];
  summary: BuildArtifactSummary | null;
  stats: BuildArtifactStats;
};

export type ParseArtifactResult =
  | { ok: true; artifact: BuildArtifact }
  /** jobId: 본문에서 읽을 수 있었으면(토큰의 잡과 비교해 교차 잡이면 상태를 바꾸지 않는다). */
  | { ok: false; status: 400 | 413; error: string; jobId: string | null };

function issuePath(issues: readonly z.ZodIssue[]): string {
  const first = issues[0];
  if (!first) return "body";
  const at = first.path.filter((p) => typeof p === "string").join(".") || "body";
  return first.code === "unrecognized_keys" ? `${at}:unknown_key` : at;
}

/**
 * JSON 텍스트 → 검증된 산출물. 실패 코드:
 *   400 artifact_invalid:json · artifact_invalid:<필드> · artifact_invalid:<구역>_path:<사유> · artifact_invalid:duplicate_path ·
 *       artifact_invalid:module_name · artifact_invalid:main_module · artifact_invalid:migration_name · artifact_invalid:migration_utf8 ·
 *       artifact_invalid:source_excluded
 *   413 artifact_too_large:<구역>(_count|_file)
 */
export function parseBuildArtifact(text: string, limits: typeof BUILD_ARTIFACT_LIMITS = BUILD_ARTIFACT_LIMITS): ParseArtifactResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: "artifact_invalid:json", jobId: null };
  }
  const maybeJobId = typeof raw === "object" && raw !== null && typeof (raw as { jobId?: unknown }).jobId === "string" ? (raw as { jobId: string }).jobId : null;
  const parsed = BuildArtifactBodySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: `artifact_invalid:${issuePath(parsed.error.issues)}`.slice(0, 120), jobId: maybeJobId };
  const b = parsed.data;
  const bad = (error: string): ParseArtifactResult => ({ ok: false, status: 400, error, jobId: b.jobId });
  const big = (error: string): ParseArtifactResult => ({ ok: false, status: 413, error, jobId: b.jobId });

  // ── 개수 상한 ──
  if (b.worker.modules.length > limits.maxModules) return big("artifact_too_large:modules_count");
  if (b.assets.length > limits.maxAssets) return big("artifact_too_large:assets_count");
  if (b.migrations.length > limits.maxMigrations) return big("artifact_too_large:migrations_count");
  if (b.source.length > limits.maxSourceFiles) return big("artifact_too_large:source_count");

  // ── 모듈 ──
  const modules: BuildArtifactModule[] = [];
  const moduleNames = new Set<string>();
  let moduleBytes = 0;
  for (const m of b.worker.modules) {
    const n = normalizeArtifactPath(m.name);
    if (!n.ok || n.path !== m.name || !MODULE_NAME_RE.test(m.name)) return bad("artifact_invalid:module_name");
    if (moduleNames.has(m.name)) return bad("artifact_invalid:duplicate_path");
    moduleNames.add(m.name);
    const bytes = base64DecodedBytes(m.base64);
    moduleBytes += bytes;
    if (moduleBytes > limits.maxModuleBytes) return big("artifact_too_large:modules");
    modules.push({ name: m.name, base64: m.base64, bytes, kind: m.name.endsWith(".wasm") ? "wasm" : "esm" });
  }
  const main = modules.find((m) => m.name === b.worker.mainModule);
  if (!main || main.kind !== "esm") return bad("artifact_invalid:main_module");
  // main이 첫 번째(uploadUserWorker는 modules[0]을 main으로 쓴다).
  const orderedModules = [main, ...modules.filter((m) => m !== main)];

  // ── 정적 자산 — 경로는 "/" + 상대 경로(Workers 자산 manifest 모양) ──
  const assets: BuildArtifactAsset[] = [];
  const assetPaths = new Set<string>();
  let assetBytes = 0;
  for (const a of b.assets) {
    if (!a.path.startsWith("/")) return bad("artifact_invalid:assets_path:not_rooted");
    const n = normalizeArtifactPath(a.path.slice(1));
    if (!n.ok) return bad(`artifact_invalid:assets_path:${n.reason}`);
    const p = `/${n.path}`;
    if (assetPaths.has(p)) return bad("artifact_invalid:duplicate_path");
    assetPaths.add(p);
    const bytes = base64DecodedBytes(a.base64);
    if (bytes > limits.maxAssetFileBytes) return big("artifact_too_large:assets_file");
    assetBytes += bytes;
    if (assetBytes > limits.maxAssetBytes) return big("artifact_too_large:assets");
    assets.push({ path: p, base64: a.base64, bytes });
  }

  // ── D1 마이그레이션 — 이름순, UTF-8 SQL ──
  const migrations: BuildArtifactMigration[] = [];
  const migNames = new Set<string>();
  let migBytes = 0;
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  for (const m of [...b.migrations].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))) {
    if (!MIGRATION_NAME_RE.test(m.name)) return bad("artifact_invalid:migration_name");
    if (migNames.has(m.name)) return bad("artifact_invalid:duplicate_path");
    migNames.add(m.name);
    const bytes = base64DecodedBytes(m.base64);
    migBytes += bytes;
    if (migBytes > limits.maxMigrationBytes) return big("artifact_too_large:migrations");
    let sql: string;
    try {
      sql = utf8.decode(base64ToBytes(m.base64));
    } catch {
      return bad("artifact_invalid:migration_utf8");
    }
    migrations.push({ name: m.name, sql, base64: m.base64, bytes });
  }

  // ── 소스 트리 — 제외 규칙 재적용 ──
  const source: BuildArtifactSource[] = [];
  const srcPaths = new Set<string>();
  let srcBytes = 0;
  for (const f of b.source) {
    const n = normalizeArtifactPath(f.path);
    if (!n.ok) return bad(`artifact_invalid:source_path:${n.reason}`);
    if (n.path.split("/").some((seg) => isSourceSegmentExcluded(seg))) return bad("artifact_invalid:source_excluded");
    if (srcPaths.has(n.path)) return bad("artifact_invalid:duplicate_path");
    srcPaths.add(n.path);
    const bytes = base64DecodedBytes(f.base64);
    if (bytes > limits.maxSourceFileBytes) return big("artifact_too_large:source_file");
    srcBytes += bytes;
    if (srcBytes > limits.maxSourceBytes) return big("artifact_too_large:source");
    source.push({ path: n.path, base64: f.base64, bytes, executable: f.executable === true });
  }

  return {
    ok: true,
    artifact: {
      jobId: b.jobId,
      worker: { mainModule: main.name, modules: orderedModules },
      assets,
      migrations,
      source,
      summary: b.summary ?? null,
      stats: {
        modules: { count: orderedModules.length, bytes: moduleBytes },
        assets: { count: assets.length, bytes: assetBytes },
        migrations: { count: migrations.length, bytes: migBytes },
        source: { count: source.length, bytes: srcBytes },
      },
    },
  };
}

/** R2 키 — ASCII만(jobId 모양 검증). 파일 이름은 키에 넣지 않는다(Rule 6). */
export function buildArtifactR2Key(jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) throw new Error("invalid_job_id");
  return `builds/${jobId}/artifact.json`;
}

/** 이 잡의 R2 접두(프로젝트 삭제 시 쓸어 담는다). */
export function buildArtifactR2Prefix(jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) throw new Error("invalid_job_id");
  return `builds/${jobId}/`;
}

/**
 * 요청 본문을 **바이트로** 읽는다(스트림을 세며 — content-length를 믿지 않는다). 선언된 길이가 상한 안이면 그 크기 버퍼 하나에
 * 바로 채운다(조각 목록 + 이어 붙인 사본이 동시에 살지 않게 — 결함 4). 선언이 없거나 틀리면 조각을 모아 한 번 잇는다.
 */
export async function readCappedBytes(req: Request, max: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "unreadable" }> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  let buf: Uint8Array | null = Number.isFinite(declared) && declared > 0 ? new Uint8Array(declared) : null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return { ok: false, reason: "unreadable" };
      if (total + value.byteLength > max) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      if (buf && total + value.byteLength <= buf.byteLength) {
        buf.set(value, total);
      } else {
        // 선언보다 길다 — 지금까지 채운 것을 조각으로 옮기고 모으기로 바꾼다.
        if (buf) {
          chunks.push(buf.subarray(0, total));
          buf = null;
        }
        chunks.push(value);
      }
      total += value.byteLength;
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (buf) return { ok: true, bytes: total === buf.byteLength ? buf : buf.subarray(0, total) };
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, bytes: out };
}

/**
 * 바이트 본문 → 검증된 산출물(결함 4). 본문은 **ASCII JSON**이어야 한다(비ASCII 문자는 `\uXXXX` 이스케이프 — 컨테이너
 * builder-run.mjs asciiJson). 한 바이트라도 0x80 이상이면 400 artifact_invalid:non_ascii_body: 한글 경로가 날것으로 오면 본문
 * 텍스트 전체가 2바이트 문자열이 되어 메모리가 두 배가 된다. 이스케이프된 한글은 JSON.parse가 원본 그대로 되살린다(Rule 6).
 * 텍스트는 이 함수 안에서만 산다 — 반환값은 텍스트를 붙잡지 않는다(호출자가 따로 들고 있지 않는 한).
 */
export function parseBuildArtifactBytes(bytes: Uint8Array, limits: typeof BUILD_ARTIFACT_LIMITS = BUILD_ARTIFACT_LIMITS): ParseArtifactResult {
  for (let i = 0; i < bytes.length; i += 1) {
    if ((bytes[i] ?? 0) >= 0x80) return { ok: false, status: 400, error: "artifact_invalid:non_ascii_body", jobId: null };
  }
  return parseBuildArtifact(new TextDecoder().decode(bytes), limits);
}
