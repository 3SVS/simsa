"use client";

/**
 * intent-ruler.ts — C-A7 (재정렬 D-2 amend · D-1 amend): 유저가 확인한 의도를 **판정의 자**로.
 *
 * 문 (c) "만들었는데 생각과 달라요"에서 자(尺)는 역추론 지시서(`source: inferred`)다. 그 지시서의
 * must는 유저가 확인한 항목에서만 나온다(D-2 amend). 흐름은 한 줄이다:
 *
 *   로컬 저장(정본) → D1 미러(검수·지시서가 읽는 곳) → 역추론 지시서 생성(확인 id 동봉)
 *
 * 순서가 중요하다: 서버는 D1의 items를 읽으므로 미러가 **끝난 뒤** 생성한다. 확인된 항목이
 * 없으면 생성하지 않는다 — must 0짜리 자는 새로 잡아낼 것이 없고, 비용만 든다.
 * 유저에게 문서 단계를 강요하지 않는다(D-1 amend "내부 생성"): 실패는 조용히 돌려준다.
 */
import { mirrorLocalProjectToDb } from "./project-mirror";
import { generateDevSpecApi } from "./dev-spec-api";
import { getUserKey } from "./workflow-store";

export type IntentRulerOutcome = "built" | "skipped_no_confirmed" | "mirror_failed" | "generate_failed";

export async function mirrorThenBuildIntentRuler(
  projectId: string,
  locale: "ko" | "en",
  confirmedItemIds: readonly string[],
): Promise<IntentRulerOutcome> {
  const mirrored = await mirrorLocalProjectToDb(projectId).catch(() => false);
  if (!mirrored) return "mirror_failed";
  if (confirmedItemIds.length === 0) return "skipped_no_confirmed";
  const r = await generateDevSpecApi(projectId, getUserKey(), locale, { confirmedItemIds });
  return r.ok ? "built" : "generate_failed";
}
