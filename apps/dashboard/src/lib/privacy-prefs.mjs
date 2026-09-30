// Train K — 동의·프라이버시 (가격·동의 계획 2026-09-27 §4 · §5.2 K-1·K-2 · 계약 5).
//
// 두 층을 따로 다룬다:
//   ⓐ 운영 정보(비식별) — 기본 기록 + 끄기(EU/EEA·영국·스위스는 기본 off, 켜야 기록). 서버
//      GET/POST /workspace/privacy-prefs 의 opsMeta·opsMetaSource.
//   ⓑ 학습 데이터 — 동의만. 결과 화면 인라인 카드(동등 버튼 2개, 사전 체크·닫기 없음)와 설정 토글.
//      서버 privacy-prefs 의 training.state("consented"|"declined"|"undecided").
//
// PURE — 네트워크·저장소 없음. 화면 문구는 전부 사전(t.trainingConsent.* / t.privacyPrefs.*).
// 이 모듈이 서버 응답의 **경계 검사**다(대시보드엔 Zod가 없다): 모양이 계약과 다르면 null →
// 화면은 "모름"으로 다룬다(카드 숨김·운영 정보 줄 숨김·설정 토글 비활성). 옛 서버(경로 없음 →
// 404에 CORS 헤더가 없어 브라우저에선 네트워크 오류로 보인다)도 같은 null이다.

/** @typedef {"on" | "off"} OpsMeta */
/** @typedef {"default" | "user"} OpsMetaSource */
/** @typedef {"consented" | "declined" | "undecided"} TrainingState */

export const OPS_META_VALUES = /** @type {const} */ (["on", "off"]);
export const OPS_META_SOURCES = /** @type {const} */ (["default", "user"]);
export const TRAINING_STATES = /** @type {const} */ (["consented", "declined", "undecided"]);

/**
 * 결과 화면 학습 카드를 **결정 없이** 보여 준 확인 결과 수의 상한. 첫 완료 결과 1회 + 다음 완료
 * 결과에서 1회만 다시 — 그 뒤로는 설정에서만(계획 §4 ⓑ "떠나면 미결정, 다음 완료 검수에서 1회만 재노출").
 */
export const TRAINING_CARD_MAX_EXPOSURES = 2;

/** 카드를 보여 준 확인 결과(runId) 목록을 이 브라우저에 적어 두는 키. */
export const TRAINING_CARD_STORAGE_KEY = "simsa:training-card-seen:v1";

const REGION_RE = /^[A-Z]{2}$/;

/**
 * @param {readonly string[]} allowed
 * @param {unknown} v
 * @returns {string | null}
 */
function oneOf(allowed, v) {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}

/**
 * GET/POST /workspace/privacy-prefs 응답 → 정규화된 선택값, 또는 null(모름).
 * 계약: `{ ok:true, opsMeta:"on"|"off", opsMetaSource:"default"|"user", region:"KR"|…|null,
 *         training:{ state, version, decidedAt } }`.
 * 필수 칸(opsMeta·opsMetaSource·training.state) 중 하나라도 계약 밖이면 null — 절반만 맞는 응답으로
 * "기록되고 있어요" 같은 사실 문장을 그리지 않는다.
 * @param {unknown} raw
 */
export function normalizePrivacyPrefs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.ok !== true) return null;
  const opsMeta = oneOf(OPS_META_VALUES, r.opsMeta);
  const opsMetaSource = oneOf(OPS_META_SOURCES, r.opsMetaSource);
  const tr = r.training;
  if (!tr || typeof tr !== "object" || Array.isArray(tr)) return null;
  const t = /** @type {Record<string, unknown>} */ (tr);
  const state = oneOf(TRAINING_STATES, t.state);
  if (!opsMeta || !opsMetaSource || !state) return null;
  return {
    opsMeta: /** @type {OpsMeta} */ (opsMeta),
    opsMetaSource: /** @type {OpsMetaSource} */ (opsMetaSource),
    region: typeof r.region === "string" && REGION_RE.test(r.region) ? r.region : null,
    training: {
      state: /** @type {TrainingState} */ (state),
      version: typeof t.version === "string" && t.version ? t.version : null,
      decidedAt: typeof t.decidedAt === "string" && t.decidedAt ? t.decidedAt : null,
    },
  };
}

/**
 * GET/POST /workspace/training-consent 응답(옛 서버에도 있는 경로) → `{ ok, active, storageConfigured }`.
 * `active` = 현재 조항 버전에 동의(캡처 게이트와 같은 조건). 모양이 다르면 ok:false.
 * @param {unknown} raw
 */
export function normalizeTrainingConsent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, active: false, storageConfigured: false };
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.ok !== true || typeof r.active !== "boolean") return { ok: false, active: false, storageConfigured: false };
  return { ok: true, active: r.active, storageConfigured: r.storageConfigured === true };
}

/**
 * localStorage 값 → 카드를 보여 준 runId 목록(최대 TRAINING_CARD_MAX_EXPOSURES개). 깨진 값은 빈 목록.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseSeenRuns(raw) {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) {
      if (typeof x === "string" && x && x.length <= 200 && !out.includes(x)) out.push(x);
      if (out.length >= TRAINING_CARD_MAX_EXPOSURES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 학습 카드 노출 조건 (계약 5).
 *   - 확인 결과가 끝났다(resultDone)
 *   - 서버가 "아직 정하지 않음"이라고 말한다(undecided) — 동의·거절 모두 다시 묻지 않는다.
 *     서버를 모르면(null) 숨긴다(옛 서버 방어).
 *   - 이 브라우저에서 결정 없이 카드를 본 확인 결과가 상한 미만이거나, 이 결과가 이미 그 안에 있다
 *     (같은 결과를 다시 열어도 새 노출로 세지 않는다).
 * @param {{ resultDone: boolean, trainingState: TrainingState | null | undefined, seenRuns: readonly string[], runId: string }} input
 */
export function trainingCardVisible(input) {
  if (input?.resultDone !== true) return false;
  if (input.trainingState !== "undecided") return false;
  const runId = typeof input.runId === "string" ? input.runId : "";
  if (!runId) return false;
  const seen = Array.isArray(input.seenRuns) ? input.seenRuns : [];
  const at = seen.indexOf(runId);
  if (at >= 0) return at < TRAINING_CARD_MAX_EXPOSURES;
  return seen.length < TRAINING_CARD_MAX_EXPOSURES;
}

/**
 * 카드를 보여 줬을 때 목록에 더한다(이미 있으면 그대로, 상한이면 그대로).
 * @param {readonly string[]} seenRuns
 * @param {string} runId
 * @returns {string[]}
 */
export function rememberTrainingCardSeen(seenRuns, runId) {
  const seen = Array.isArray(seenRuns) ? [...seenRuns] : [];
  if (!runId || seen.includes(runId) || seen.length >= TRAINING_CARD_MAX_EXPOSURES) return seen;
  return [...seen, runId];
}

/**
 * 카드에서 고른 뒤 서버 응답 → 화면 상태. 저장이 실제로 요청대로 됐을 때만 "저장됨".
 * @param {boolean} requested 허용하기 = true
 * @param {{ ok: boolean, active: boolean }} res normalizeTrainingConsent 결과
 * @returns {"consented" | "declined" | "error"}
 */
export function trainingSaveOutcome(requested, res) {
  if (!res || res.ok !== true) return "error";
  if (requested) return res.active === true ? "consented" : "error";
  return res.active === false ? "declined" : "error";
}

/**
 * 결과 화면의 운영 정보 한 줄 — 어느 문구를 쓸지.
 *   "recording"   — 기록 중(기본 on 또는 직접 켬) → "…기록됩니다 · 기록 끄기 · 자세히"
 *   "off_default" — 기본 off(접속 나라 규칙 EU/EEA·영국·스위스, 또는 접속 나라를 모름 — 서버 #574
 *                   defaultOpsMetaForRegion(null) = "off") → "…기록하지 않고 있어요 · 켜기"
 *   "off_user"    — 직접 끔 → "…끄셨어요 · 다시 켜기"
 *   null          — 모름(옛 서버·네트워크) → 줄을 그리지 않는다(틀릴 수 있는 사실 문장을 쓰지 않는다)
 * @param {ReturnType<typeof normalizePrivacyPrefs>} prefs
 * @returns {"recording" | "off_default" | "off_user" | null}
 */
export function opsInfoLineVariant(prefs) {
  if (!prefs) return null;
  if (prefs.opsMeta === "on") return "recording";
  return prefs.opsMetaSource === "default" ? "off_default" : "off_user";
}

/**
 * 운영 정보 한 줄의 문구·버튼·버튼이 보낼 값. 문구는 사전(t.privacyPrefs)에서만 온다.
 * @param {"recording" | "off_default" | "off_user" | null} variant
 * @param {{ lineRecording: string, lineOffDefault: string, lineOffUser: string, turnOff: string, turnOn: string, turnOnAgain: string }} p
 * @returns {{ text: string, action: string, next: OpsMeta } | null}
 */
export function opsInfoLineCopy(variant, p) {
  if (variant === "recording") return { text: p.lineRecording, action: p.turnOff, next: "off" };
  if (variant === "off_default") return { text: p.lineOffDefault, action: p.turnOn, next: "on" };
  if (variant === "off_user") return { text: p.lineOffUser, action: p.turnOnAgain, next: "on" };
  return null;
}

/**
 * 설정 화면 두 토글의 상태.
 *   운영 정보: privacy-prefs를 알 때만 켜고 끌 수 있다(모르면 비활성 + 설명).
 *   학습 데이터: privacy-prefs가 있으면 그 상태를, 없으면(옛 서버) 기존 training-consent 경로로.
 *     `offDeletes` — 끄면 저장된 학습 사본을 지우는 서버인가(= privacy-prefs가 있는 Train K 서버).
 *     옛 서버에서는 끄면 새 캡처만 멈춘다 → 문구도 그렇게("지워요"라고 하지 않는다).
 * @param {{ prefs: ReturnType<typeof normalizePrivacyPrefs>, legacy: { ok: boolean, active: boolean } | null }} input
 */
export function privacySettingsState(input) {
  const prefs = input?.prefs ?? null;
  const legacy = input?.legacy ?? null;
  const opsMeta = prefs
    ? { available: true, on: prefs.opsMeta === "on", defaultOff: prefs.opsMeta === "off" && prefs.opsMetaSource === "default" }
    : { available: false, on: false, defaultOff: false };
  const training = prefs
    ? { available: true, on: prefs.training.state === "consented", offDeletes: true }
    : legacy && legacy.ok
      ? { available: true, on: legacy.active === true, offDeletes: false }
      : { available: false, on: false, offDeletes: false };
  return { opsMeta, training };
}
