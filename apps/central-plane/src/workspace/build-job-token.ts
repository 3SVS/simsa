/**
 * workspace/build-job-token.ts — Train B · B-5b S1: 빌드 잡 범위 토큰(jobToken).
 *
 * 왜(2026-10-01): B-5b-2부터 빌더 컨테이너는 **LLM이 만든 코드와 그 의존성(postinstall 포함)을 설치·실행**한다.
 * 종전 페이로드는 그 컨테이너에 계정 운영 토큰(HOSTING_CF_API_TOKEN)·전역 INTERNAL_CALLBACK_TOKEN(모든 내부 콜백과
 * /admin/usage-stats 인증)·simsa-hosted 조직 전체 설치 토큰·LLM 키를 넘겼다 — 생성 코드가 하나만 읽어 내보내도 모든
 * 호스팅 앱·조직 저장소·내부 콜백이 위험했다(D-6 "운영 자격은 Worker/Actions secret에만"과도 어긋난다).
 * 이제 컨테이너가 받는 비밀은 **이 잡 하나에만 통하는 토큰** 하나다:
 *
 *   subkey   = HMAC-SHA256(root, "simsa/build-job-token/v1")          ← 도메인 분리 파생(rate-limit-key.ts 관례)
 *   mac      = HMAC-SHA256(subkey, "simsa/build-job/v1:" + jobId)
 *   jobToken = "bjt1." + jobId + "." + hex(mac)
 *
 *   - root = CONCLAVE_TOKEN_KEK(프로덕션 — Worker 밖으로 나가지 않는 키). 없으면(로컬·테스트) INTERNAL_CALLBACK_TOKEN.
 *     새 시크릿이 필요 없다. 전역 콜백 토큰은 다른 컨테이너(검수·수리)도 들고 있으므로 KEK가 있으면 KEK를 쓴다 —
 *     그래야 전역 토큰이 새도 잡 토큰을 만들 수 없다.
 *   - jobId를 토큰 안에 싣는다: LLM 프록시(/internal/build-llm/*)는 SDK가 주는 헤더(x-api-key·Bearer)만 받으므로
 *     어느 잡인지 토큰에서 읽어야 한다. jobId를 바꾸면 mac이 맞지 않는다(위조 = 401).
 *   - 비교는 상수 시간.
 *   - 이 토큰으로 할 수 있는 것(PR #569 S1 검증 뒤): 그 잡의 **단계·WBS 진행** 보고, **실패** 보고, 그 잡 예산 안의 LLM
 *     호출(예약 — 동시 호출 초과 ≤ 1회). done·배포 주소·push 대상·커밋·빌드 결과는 쓸 수 없다(Worker 소유, S3).
 *   - 유효 범위는 잡이 활성인 동안이다: 끝난 잡에서는 프록시 409, 콜백은 아무 행도 바꾸지 않고 이벤트도 남기지 않는다.
 *     (토큰 자체에 만료 시각은 없다 — 활성 수명은 컨테이너 마감 45분·스턱 스윕 60분이 묶고, 살아 있는 잡을 붙잡는
 *     컨테이너가 할 수 있는 최대치는 그 잡의 예산과 잡당 이벤트 상한이다.)
 */
import type { Env } from "../env.js";

export const BUILD_JOB_TOKEN_PREFIX = "bjt1";
/** 서브키 파생 라벨 — 버전을 올리면 모든 토큰이 바뀐다. */
export const BUILD_JOB_TOKEN_LABEL = "simsa/build-job-token/v1";
/** mac 메시지 접두 — 다른 용도의 HMAC과 섞이지 않게. */
export const BUILD_JOB_TOKEN_MESSAGE_PREFIX = "simsa/build-job/v1:";

/** build-job-db.ts randId("bj") = `bj_<10 hex>`. 컨테이너 JOB_ID_RE와 같은 문자 집합(점 없음 — 토큰 구분자). */
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_RE = /^bjt1\.([A-Za-z0-9_-]{1,64})\.([0-9a-f]{64})$/;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function importHmacKey(raw: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** 루트 비밀 문자열 → 이 용도의 서브키. 루트 값이 바뀌면(회전) 다시 파생. */
const subkeyCache = new Map<string, Promise<CryptoKey>>();
function subkeyFor(root: string): Promise<CryptoKey> {
  const cached = subkeyCache.get(root);
  if (cached) return cached;
  const key = (async () => {
    const rootKey = await importHmacKey(encoder.encode(root));
    return importHmacKey(await crypto.subtle.sign("HMAC", rootKey, encoder.encode(BUILD_JOB_TOKEN_LABEL)));
  })();
  if (subkeyCache.size > 4) subkeyCache.clear();
  subkeyCache.set(root, key);
  key.catch(() => {
    if (subkeyCache.get(root) === key) subkeyCache.delete(root);
  });
  return key;
}

type TokenEnv = Pick<Env, "CONCLAVE_TOKEN_KEK" | "INTERNAL_CALLBACK_TOKEN">;

/** 파생 루트. KEK 우선, 없으면 전역 콜백 토큰. 둘 다 없으면 null(토큰을 만들 수 없다). */
function rootOf(env: TokenEnv): string | null {
  const kek = env.CONCLAVE_TOKEN_KEK;
  if (typeof kek === "string" && kek.length > 0) return kek;
  const ict = env.INTERNAL_CALLBACK_TOKEN;
  if (typeof ict === "string" && ict.length > 0) return ict;
  return null;
}

async function macHex(root: string, jobId: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await subkeyFor(root), encoder.encode(BUILD_JOB_TOKEN_MESSAGE_PREFIX + jobId)));
}

/** 길이가 같을 때 모든 문자를 본다(조기 종료 없음). 길이가 다르면 false. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 잡 하나의 토큰. 루트 비밀이 없거나 jobId 모양이 틀리면 null. */
export async function mintBuildJobToken(env: TokenEnv, jobId: string): Promise<string | null> {
  const root = rootOf(env);
  if (!root || !JOB_ID_RE.test(jobId)) return null;
  return `${BUILD_JOB_TOKEN_PREFIX}.${jobId}.${await macHex(root, jobId)}`;
}

/** 토큰 모양만 본다(검증 아님) — 들어 있는 jobId. */
export function parseBuildJobToken(token: string): { jobId: string; mac: string } | null {
  const m = TOKEN_RE.exec(token);
  return m && m[1] && m[2] ? { jobId: m[1], mac: m[2] } : null;
}

/** 우리가 만든 토큰인가. 맞으면 그 jobId. 모양이 틀리거나 mac이 다르면(위조·jobId 바꿔치기) ok=false. */
export async function verifyBuildJobToken(env: TokenEnv, token: string): Promise<{ ok: true; jobId: string } | { ok: false }> {
  const parsed = parseBuildJobToken(token);
  const root = rootOf(env);
  if (!parsed || !root) return { ok: false };
  const expected = await macHex(root, parsed.jobId);
  return constantTimeEqual(expected, parsed.mac) ? { ok: true, jobId: parsed.jobId } : { ok: false };
}

/** `Authorization: Bearer <x>` → x. 없으면 null. */
export function bearerOf(header: string | undefined | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m && m[1] ? m[1] : null;
}

export type BuildCallbackAuth =
  | { ok: true; tokenJobId: string }
  | { ok: false; status: 401 | 403 | 503; error: "unauthorized" | "job_token_required" | "callback_disabled" };

/**
 * 빌드 콜백(/internal/build-progress · build-done)의 인증 1단계 — 본문을 읽기 **전에**.
 *   - 그 잡의 jobToken → ok(tokenJobId). 본문 jobId와 같은지는 checkCallbackJob가 본다.
 *   - 전역 INTERNAL_CALLBACK_TOKEN → **403 job_token_required**(LLM 프록시와 같은 답).
 *     PR #569 S1 검증 결함 8: 종전에는 옛 이미지 호환으로 전역 토큰을 "한 릴리스만" 받았는데, 끝이 TODO뿐이었고 그동안
 *     전역 토큰(검수·수리 컨테이너 페이로드에도 실린다)을 가진 누구나 **어느 빌드 잡이든** 진행·실패·done으로 만들 수 있었다.
 *     지켜 줄 옛 잡이 없다: 프로덕션 빌더 이미지(b1-builder-1)는 kind=build를 받자마자 builder_stage_not_implemented로
 *     실패하고(진행 중인 긴 잡이 없다), 새 페이로드에는 callbackToken·projectId·userKey가 없어 옛 이미지는 202 전에 400
 *     (디스패치 실패 = 즉시 failed(queued))이다. 배포 순간 몇 초 창에 걸린 옛 실패 콜백은 스턱 스윕(60분)이 정리한다.
 *     그래서 호환 분기를 코드에서 지웠다.
 *   - 그 밖 → 401. 루트 비밀(KEK·전역 토큰)이 하나도 없으면 503(잡 토큰을 검증할 수 없다).
 */
export async function authenticateBuildCallback(env: TokenEnv, authorization: string | undefined): Promise<BuildCallbackAuth> {
  if (rootOf(env) === null) return { ok: false, status: 503, error: "callback_disabled" };
  const presented = bearerOf(authorization);
  if (!presented) return { ok: false, status: 401, error: "unauthorized" };
  if (parseBuildJobToken(presented)) {
    const v = await verifyBuildJobToken(env, presented);
    return v.ok ? { ok: true, tokenJobId: v.jobId } : { ok: false, status: 401, error: "unauthorized" };
  }
  const ict = env.INTERNAL_CALLBACK_TOKEN;
  if (typeof ict === "string" && ict.length > 0 && constantTimeEqual(presented, ict)) return { ok: false, status: 403, error: "job_token_required" };
  return { ok: false, status: 401, error: "unauthorized" };
}

/** 인증 2단계 — 본문 jobId와 토큰의 잡이 같은가. 다른 잡의 토큰(교차 잡 위조)은 403, 상태를 바꾸지 않는다. */
export function checkCallbackJob(auth: Extract<BuildCallbackAuth, { ok: true }>, bodyJobId: string): { ok: true } | { ok: false; status: 403; error: "job_token_mismatch" } {
  return constantTimeEqual(auth.tokenJobId, bodyJobId) ? { ok: true } : { ok: false, status: 403, error: "job_token_mismatch" };
}
