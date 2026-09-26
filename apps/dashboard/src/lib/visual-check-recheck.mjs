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

/**
 * @param {{ id?: unknown, intent?: unknown } | null | undefined} check the run being re-checked
 * @param {string} userKey
 * @param {"ko" | "en"} locale report prose language (must travel with the run — see VisualCheckRunInput.locale)
 * @returns {{ userKey: string, locale: "ko" | "en", intent?: string, sourceCheckId?: string }}
 */
export function buildRecheckBody(check, userKey, locale) {
  /** @type {{ userKey: string, locale: "ko" | "en", intent?: string, sourceCheckId?: string }} */
  const body = { userKey, locale };
  const intent = typeof check?.intent === "string" ? check.intent.trim() : "";
  // 빈 intent는 보내지 않는다 — 서버가 sourceCheckId의 intent, 그다음 프로젝트의 확정
  // 의도(productSpec.oneLine), 마지막에야 기본 문장을 쓴다(계약 1).
  if (intent) body.intent = intent;
  if (typeof check?.id === "string" && check.id) body.sourceCheckId = check.id;
  return body;
}
