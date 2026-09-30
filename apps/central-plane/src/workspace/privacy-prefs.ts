/**
 * workspace/privacy-prefs.ts — Train K · K-1 운영 정보(ⓐ) 기록 선택 (가격·동의 계획 §4, 0071 privacy_prefs).
 *
 * 무엇을 끄는가: 0069가 더한 **통계용 운영 정보** 칸만 —
 *   workspace_visual_checks.region · envelope_json · finding_codes_json
 *   workspace_repair_jobs.region
 *   workspace_projects.region_at_create
 * 그리고 학습 사본(ⓑ, 따로 동의한 사람만)의 region 칸.
 * 끄지 않는 것(방침 §1 '운영 정보'에 함께 고지돼 있지만 이 설정의 대상이 아니다 — 토글 문구는 '통계용 운영 정보
 * (국가 코드·봉투·실패 유형)'로 범위를 한정해야 한다, PR #574 검증 #574-6):
 *   - 기능 데이터(화면이 이 값으로 동작한다): user_verdict(+at)·source_check_id·resolved·verify_check_id·locale.
 *     이 칸들이 없으면 판정 탭·다시 확인·수리 결과 표시가 멈춘다.
 *   - llm_usage(0070, user_key_hash·project_id) — AI 비용 원장. 비용 상한·정산 목적이라 그대로 기록한다.
 *   - workspace_rate_limit·demo_rate_limit — 요청 횟수 제한(남용 방지). 48시간 뒤 크론이 지운다.
 *   - 0055·0056 프로젝트 행(built_with_json·entry_path·topic_tags_json·acquisition_json) — 계약 범위 밖(Bae 결정 필요).
 *
 * 기본값: 행이 없으면 접속 국가로 정한다. EU/EEA(27개국+IS·LI·NO)·GB·CH(+ 같은 법이 닿는 EU 영역 코드와
 * GDPR과 같은 법을 둔 지역)는 **off** — ePrivacy 5(3): localStorage의 userKey를 서버로 보내는 구조는 단말 접근이라
 * 동의 없이는 기록하지 않는다. Tor(T1)·국가 미상(XX)·**국가를 모름(null)**은 어디서 왔는지 모르므로 보수적으로
 * off. 그 밖은 on (정당한 이익 + 고지 + 이 설정으로 이의).
 *
 * ★fail-closed: 선택을 못 읽으면(D1 오류·0071 미적용) **기록하지 않는다** — 한 줄 JSON 로그를 남긴다.
 * 선택을 모르는 채로 기록하면 "끔"을 고른 사람의 값을 쓸 수 있고, 안 쓰면 통계 한 줄을 잃을 뿐이다.
 */
import { z } from "zod";
import type { Env } from "../env.js";

export const OPS_META_VALUES = ["on", "off"] as const;
export type OpsMeta = (typeof OPS_META_VALUES)[number];
/** "user" = 이 사람이 고른 값, "default" = 고른 적 없어 접속 국가로 정한 기본값. */
export type OpsMetaSource = "default" | "user";

/** EU 27개국 (ISO-3166 alpha-2 — 그리스는 EL이 아니라 GR). */
const EU_27 = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;
/** EEA 비EU 3개국. */
const EEA_NON_EU = ["IS", "LI", "NO"] as const;
/** 영국(UK GDPR + PECR)·스위스(revFADP). */
const UK_CH = ["GB", "CH"] as const;
/** 법적으로 EU 영역인데 Cloudflare가 따로 보고하는 코드(올란드·프랑스 해외 주). */
const EU_TERRITORIES = ["AX", "GF", "GP", "MQ", "RE", "YT", "MF"] as const;
/** GDPR과 같은 법을 둔 지역(지브롤터·맨섬·저지·건지) — 보수적으로 같이 끈다. */
const GDPR_EQUIVALENT = ["GI", "IM", "JE", "GG"] as const;
/** Cloudflare 특수 코드: T1 = Tor, XX = 국가 미상. 어디서 왔는지 모르면 끈 쪽이 안전하다. */
const UNKNOWN_ORIGIN = ["T1", "XX"] as const;

/** 행이 없을 때 기본값이 "off"인 접속 국가 코드. */
export const OPS_META_DEFAULT_OFF_REGIONS: ReadonlySet<string> = new Set<string>([
  ...EU_27,
  ...EEA_NON_EU,
  ...UK_CH,
  ...EU_TERRITORIES,
  ...GDPR_EQUIVALENT,
  ...UNKNOWN_ORIGIN,
]);

/**
 * 접속 국가 → 기본값. region이 null(국가를 모름 — 엣지 밖 로컬·테스트, 또는 앞으로 생길 내부 호출자
 * (서비스 바인딩·SSR 프록시)가 cf.country 없이 부르는 경우)이면 **"off"** — 'XX'(미상)·'T1'과 같은 규칙
 * (모르면 안 쓰는 쪽). 예전에는 null만 "on"이라 EU 사람도 내부 경로로 들어오면 조용히 켜질 수 있었다(#574-5).
 * 순수 함수 — 대시보드 표시와 서버 게이트가 같은 표를 쓰도록 GET 응답이 이 값을 그대로 돌려준다.
 */
export function defaultOpsMetaForRegion(region: string | null): OpsMeta {
  if (!region || !region.trim()) return "off";
  return OPS_META_DEFAULT_OFF_REGIONS.has(region.trim().toUpperCase()) ? "off" : "on";
}

export type OpsMetaResolution = { opsMeta: OpsMeta; source: OpsMetaSource };

/** 저장된 선택(없으면 null) + 접속 국가 → 이 사람의 현재 값. 순수 함수. */
export function resolveOpsMetaFrom(choice: OpsMeta | null, region: string | null): OpsMetaResolution {
  if (choice) return { opsMeta: choice, source: "user" };
  return { opsMeta: defaultOpsMetaForRegion(region), source: "default" };
}

export const PRIVACY_PREFS_SELECT_SQL = `SELECT ops_meta FROM privacy_prefs WHERE user_key = ? LIMIT 1`;

/** Binds: (user_key, ops_meta, updated_at). 행 = 이 사람이 고른 값(행 없음 = 기본값). */
export const PRIVACY_PREFS_UPSERT_SQL = `INSERT INTO privacy_prefs (user_key, ops_meta, updated_at)
 VALUES (?, ?, ?)
 ON CONFLICT(user_key) DO UPDATE SET ops_meta = excluded.ops_meta, updated_at = excluded.updated_at`;

/** 저장된 선택. 행 없음·NULL·모르는 값 → null(기본값을 따른다). D1 오류는 던진다(호출자가 정한다). */
export async function getOpsMetaChoice(env: Pick<Env, "DB">, userKey: string): Promise<OpsMeta | null> {
  const row = await env.DB.prepare(PRIVACY_PREFS_SELECT_SQL).bind(userKey).first<{ ops_meta?: unknown }>();
  const v = row?.ops_meta;
  return v === "on" || v === "off" ? v : null;
}

export async function setOpsMetaChoice(
  env: Pick<Env, "DB">,
  userKey: string,
  opsMeta: OpsMeta,
  now: string = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(PRIVACY_PREFS_UPSERT_SQL).bind(userKey, opsMeta, now).run();
}

/** 이 사람의 현재 값(선택 우선, 없으면 기본값). D1 오류는 던진다 — API는 500으로, 게이트는 아래 함수로. */
export async function resolveOpsMeta(
  env: Pick<Env, "DB">,
  userKey: string,
  region: string | null,
): Promise<OpsMetaResolution> {
  return resolveOpsMetaFrom(await getOpsMetaChoice(env, userKey), region);
}

function logGateError(site: string, err: unknown): void {
  console.error(
    JSON.stringify({
      at: "ops-meta-gate",
      site,
      decision: "off",
      note: "choice unreadable — fail-closed (not recorded)",
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    }),
  );
}

/**
 * 요청 경로의 게이트(프로젝트 생성·검수 런·수리 잡·학습 사본): 이 사람의 운영 정보를 **지금 기록해도 되는가**.
 * 선택을 못 읽으면 false(기록 안 함) + 한 줄 JSON 로그. 던지지 않는다.
 */
export async function opsMetaRecordingAllowed(
  env: Pick<Env, "DB">,
  userKey: string,
  region: string | null,
  site: string,
): Promise<boolean> {
  try {
    return (await resolveOpsMeta(env, userKey, region)).opsMeta === "on";
  } catch (err) {
    logGateError(site, err);
    return false;
  }
}

/**
 * 요청이 없는 경로의 게이트(검수 완료 콜백·verify-sweep 재검수): 이 요청에는 접속 국가가 없다.
 * 규칙 — 이 사람이 고른 값이 있으면 그것, 없으면 **런에 기록된 국가의 기본값**(defaultOpsMetaForRegion).
 *   - 0071 이후 런: 기본 off였으면 region이 NULL로 남아 있다 → 국가 모름 = off. 기본 on(KR 등)이면 region이 있다 → on.
 *   - 0071 **이전** 런: 게이트 없이 region이 기록돼 있다(EU 사람도 'DE'). "무언가 기록돼 있으면 그때 켜져 있었다"로
 *     읽으면 EU 기본 off가 뒤집힌다(#574-1 — 배포 때 진행 중이던 런의 콜백, 배포 뒤 머지된 수리 PR의 재검수).
 *     기록된 국가로 기본값을 다시 계산하면 'DE'는 off다.
 * envelope_json만 있고 region이 없는 런은 기본값을 정할 근거가 없으므로 기록하지 않는다(모르면 안 쓰는 쪽).
 * 선택을 못 읽으면 false + 로그. 던지지 않는다.
 */
export async function opsMetaAllowedForRun(
  env: Pick<Env, "DB">,
  run: { userKey: string; region: string | null },
  site: string,
): Promise<boolean> {
  try {
    const choice = await getOpsMetaChoice(env, run.userKey);
    if (choice) return choice === "on";
    return defaultOpsMetaForRegion(run.region) === "on";
  } catch (err) {
    logGateError(site, err);
    return false;
  }
}

/** userKey — 다른 라우트와 같은 핸들(원문 그대로 비교하므로 다듬지 않는다). 길이만 막는다. */
export const PrivacyPrefsUserKeySchema = z.string().min(1).max(256);

/** POST /workspace/privacy-prefs 본문. */
export const PrivacyPrefsPostSchema = z.object({
  userKey: PrivacyPrefsUserKeySchema,
  opsMeta: z.enum(OPS_META_VALUES),
});
export type PrivacyPrefsPost = z.infer<typeof PrivacyPrefsPostSchema>;
