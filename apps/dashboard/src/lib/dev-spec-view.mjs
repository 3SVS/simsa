// dev-spec-view.mjs — 개발 지시서 화면의 순수 로직 (SI 티어 A4 · D-17).
//
// 화면은 두 층이다: 초보자 4줄(무엇을 만들지 · 화면 N개 · 저장하는 것 N가지 · 이번엔 안
// 만드는 것)과, 접힌 "개발자용 보기". 여기서는 서버가 준 DevSpec을 화면이 바로 그릴 수
// 있는 모양으로만 바꾼다. 점수·등급을 만들지 않는다(PRD §5.1).

/**
 * 서버 DevSpec(unknown) → 초보자 4줄 + 개발자용 섹션 개수.
 * 입력이 DevSpec 모양이 아니면 null — 화면은 "아직 없어요"로 그린다.
 * @param {unknown} devSpec
 * @returns {null | {
 *   what: string,
 *   screenCount: number,
 *   entityCount: number,
 *   excluded: string[],
 *   mustFeatureTitles: string[],
 *   counts: { features: number, acceptance: number, screens: number, entities: number, apis: number, wbs: number, tests: number, openQuestions: number },
 *   source: "generated"|"inferred"|"manual",
 *   humanOnlyCount: number,
 * }}
 */
export function devSpecView(devSpec) {
  if (!devSpec || typeof devSpec !== "object") return null;
  const d = /** @type {Record<string, any>} */ (devSpec);
  const arr = (k) => (Array.isArray(d[k]) ? d[k] : []);
  const brief = d.brief && typeof d.brief === "object" ? d.brief : {};
  const features = arr("features");
  const acceptance = arr("acceptance");
  if (features.length === 0 || acceptance.length === 0) return null;
  const source = d.meta && typeof d.meta === "object" && ["generated", "inferred", "manual"].includes(d.meta.source) ? d.meta.source : "generated";
  return {
    what: typeof brief.oneLine === "string" && brief.oneLine ? brief.oneLine : String(brief.productName ?? ""),
    screenCount: arr("screens").length,
    entityCount: arr("dataModel").length,
    excluded: Array.isArray(brief.excluded) ? brief.excluded.filter((x) => typeof x === "string") : [],
    mustFeatureTitles: features.filter((f) => f && f.priority === "must" && typeof f.title === "string").map((f) => f.title),
    counts: {
      features: features.length,
      acceptance: acceptance.length,
      screens: arr("screens").length,
      entities: arr("dataModel").length,
      apis: arr("apis").length,
      wbs: arr("workBreakdown").length,
      tests: arr("testPlan").length,
      openQuestions: arr("openQuestions").length,
    },
    source,
    // 사람만 판단할 수 있는 수용 기준 — 이건 기계가 "완료"라 말할 수 없는 부분이다(D-9).
    humanOnlyCount: acceptance.filter((a) => a && a.verifiedBy === "human").length,
  };
}

/**
 * 생성 버튼의 상태와 문구 키. 프로젝트에 설명서·항목이 없으면 생성 불가(T0는 브리프 위에 선다).
 * @param {{ hasSpec: boolean, hasItems: boolean, hasDevSpec: boolean, phase: "idle"|"loading" }} f
 * @returns {{ enabled: boolean, labelKey: "make"|"remake"|"making", hintKey: null|"needSpec"|"needItems" }}
 */
export function generateButtonState(f) {
  if (f.phase === "loading") return { enabled: false, labelKey: "making", hintKey: null };
  if (!f.hasSpec) return { enabled: false, labelKey: "make", hintKey: "needSpec" };
  if (!f.hasItems) return { enabled: false, labelKey: "make", hintKey: "needItems" };
  return { enabled: true, labelKey: f.hasDevSpec ? "remake" : "make", hintKey: null };
}

/**
 * 실패를 초보자 말로 — 종류별 문구 키. 예시로 대체하지 않고 이유를 말한다.
 * @param {{ error: string, stage?: string, issueCount?: number, retryAfterSeconds?: number }} err
 * @returns {"errLlm"|"errInvalid"|"errRateLimited"|"errNotSynced"|"errNetwork"|"errServer"}
 */
export function generateErrorKey(err) {
  switch (err.error) {
    case "llm_unavailable": return "errLlm";
    case "dev_spec_invalid": return "errInvalid";
    case "rate_limited": return "errRateLimited";
    case "not_found": return "errNotSynced";
    case "network": return "errNetwork";
    default: return "errServer";
  }
}
