// Train C — C0 (재정렬 2026-09-27 §1 끊김 #2 · W1-1, 계약 1 클라이언트):
// 재검수 본문. "고친 뒤 다시 확인"은 **원래 검수와 같은 자(尺)**로 재야 한다.
//
// 옛 재검수는 `{ userKey, locale }`만 보냈고, 서버는 기본 문장(DEFAULT_INSPECTION_INTENT)
// 으로 다시 검수했다 — 사용자가 적은 의도가 재검수에서 사라졌다. 이제 원 런의
// intent를 그대로 물려주고, 원 런의 id를 `sourceCheckId`로 보내 서버가 (a) intent가
// 비어 있으면 원 런의 것을, (b) 주소도 원 런의 것을 쓰게 한다. 새 런 행에는
// `source_check_id`가 남아 "어느 검수의 재검수인가"가 데이터로 이어진다(D-8 봉투).
//
// PURE — no network, no storage. The report detail page feeds the result to
// runVisualCheck(). Mirrors the *.mjs pure-helper convention of this folder.
//
// ## 서버 기본 문장은 '의도 없음'이다 (PR #552 검증 결함 #2)
//
// 첫 런은 projects/new가 `{ userKey, locale }`만 보내고, 서버는 DEFAULT_INSPECTION_INTENT
// (아래 SERVER_DEFAULT_INTENT와 같은 글자)를 런 행에 저장해 GET 상세로 그대로 돌려준다.
// 그 문장을 "원 런의 intent"로 보고 명시 전송하면 계약 1의 캐스케이드(body.intent → 원 런
// intent → 프로젝트 확정 oneLine → 기본)가 body.intent에서 멈춰, "맞나요?"에서 확정한
// 의도가 재검수 기준이 되지 못한다. 서버 캐스케이드도 원 런 intent(=기본 문장)를 물려받으므로
// 생략만으로는 확정 oneLine에 닿지 않는다 → 클라이언트가 기본 문장을 '없음'으로 보고, 로컬에
// 확정된 oneLine(loadExtendedProjectData().productSpec.oneLine)을 명시 intent로 보낸다.
// 옛 서버(캐스케이드 없음)에서도 body.intent를 그대로 쓰므로 같은 효과가 난다.

/**
 * Mirror of central-plane `DEFAULT_INSPECTION_INTENT`
 * (apps/central-plane/src/routes/workspace-visual-check-runs.ts). The dashboard
 * cannot import the Worker's module, so the literal is duplicated here and a test
 * reads the server source to catch drift (visual-check-recheck.test.mjs).
 */
export const SERVER_DEFAULT_INTENT =
  "사용자가 앱을 열어 핵심 기능이 실제로 작동하는지 눈으로 확인할 수 있어야 한다";

/**
 * Mirror of central-plane `DEFAULT_INSPECTION_INTENT_EN` (PR #553 — an EN run
 * stores the English placeholder, so an EN user's first run must be recognized
 * as "nobody chose it" too; otherwise the confirmed one-line never reaches the
 * re-check for EN users). Same drift test covers it once #553 is on main.
 */
export const SERVER_DEFAULT_INTENT_EN =
  "A user should be able to open the app and see its core feature actually working";

const SERVER_DEFAULT_INTENTS = new Set([SERVER_DEFAULT_INTENT, SERVER_DEFAULT_INTENT_EN]);

/**
 * True when a run's intent is a server placeholder (KO or EN), i.e. nobody chose it.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isServerDefaultIntent(raw) {
  return typeof raw === "string" && SERVER_DEFAULT_INTENTS.has(raw.trim());
}

/**
 * @param {{ id?: unknown, intent?: unknown } | null | undefined} check the run being re-checked
 * @param {string} userKey
 * @param {"ko" | "en"} locale report prose language (must travel with the run — see VisualCheckRunInput.locale)
 * @param {{ confirmedIntent?: unknown }} [opts] the project's confirmed one-line
 *   ("맞나요?" card → productSpec.oneLine). Used only when the source run has no
 *   intent of its own (blank or the server default sentence).
 * @returns {{ userKey: string, locale: "ko" | "en", intent?: string, sourceCheckId?: string }}
 */
export function buildRecheckBody(check, userKey, locale, opts = {}) {
  /** @type {{ userKey: string, locale: "ko" | "en", intent?: string, sourceCheckId?: string }} */
  const body = { userKey, locale };
  const runIntent = typeof check?.intent === "string" ? check.intent.trim() : "";
  const confirmed = typeof opts?.confirmedIntent === "string" ? opts.confirmedIntent.trim() : "";
  // 계약 1의 순서를 클라이언트가 안다: 그 런에 사람이 적은 의도 → 프로젝트의 확정 의도 →
  // (둘 다 없으면 보내지 않는다 — 서버가 원 런/기본 문장으로 이어간다).
  // 기본 문장은 '적은 의도'가 아니므로 첫 단계에서 걸러진다.
  if (runIntent && !isServerDefaultIntent(runIntent)) body.intent = runIntent;
  else if (confirmed) body.intent = confirmed;
  if (typeof check?.id === "string" && check.id) body.sourceCheckId = check.id;
  return body;
}

/** central-plane MAX_INTENT_CHARS — a longer explicit intent is refused (400 invalid_intent). */
const MAX_INTENT_CHARS = 1000;

/**
 * PR #571 검증 결함 3 (문 (c) "만들었는데 생각과 달라요"): the check the intent card
 * offers right after the user wrote what they MEANT. The line travels as an explicit
 * intent — the D1 mirror of productSpec is fire-and-forget, so leaning on the
 * server's "confirmed one-line" fallback could still measure with the generic
 * sentence if the mirror has not landed yet. No sourceCheckId: this is a new
 * yardstick, not a re-check of an earlier run's. Cut at the server's limit the
 * same way the server cuts a confirmed one-line (confirmedIntentFromProject).
 *
 * @param {unknown} oneLine the confirmed one-line
 * @param {string} userKey
 * @param {"ko" | "en"} locale
 * @returns {{ userKey: string, locale: "ko" | "en", intent?: string }}
 */
export function intentRecheckBody(oneLine, userKey, locale) {
  /** @type {{ userKey: string, locale: "ko" | "en", intent?: string }} */
  const body = { userKey, locale };
  const line = typeof oneLine === "string" ? oneLine.trim() : "";
  if (line) body.intent = line.slice(0, MAX_INTENT_CHARS);
  return body;
}
