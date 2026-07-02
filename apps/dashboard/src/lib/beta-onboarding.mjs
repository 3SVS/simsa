// Stage 120 — preview-only onboarding copy + constants.
//
// Centralizes the beta onboarding / "preview language" / safety copy so it stays
// consistent across the intake route and is unit-testable (no completion claims,
// safety notes present). Pure data — no component, no backend.
//
// Localized for the non-developer copy pass: the EN constants below stay the
// canonical source (safety-language tests assert their phrasing); KO mirrors
// them. UI code should use getBetaOnboardingCopy(locale).

export const ONBOARDING_HEADING = "How this beta preview works";

export const ONBOARDING_INTRO =
  "Paste an idea, a product spec (PRD), a product URL, a code repository or code change (PR) link, or a description of an AI-built app. Simsa turns it into a staged acceptance workflow preview.";

/** The 4-step explanation of the intake preview chain. */
export const ONBOARDING_STEPS = [
  "Understand what you pasted",
  "Draft acceptance items",
  "Plan the review work by role",
  "Save the workflow plan for later review",
];

/** Top-level safety line — what this flow does NOT do. */
export const ONBOARDING_SAFETY_LINE =
  "This beta flow creates plans and previews. It does not execute agents, collect evidence, run benchmarks, or make final decisions.";

/** Legend explaining repeated preview terms across the chain. */
export const PREVIEW_LANGUAGE_ITEMS = [
  { term: "Candidate", meaning: "a suggested item that still needs review" },
  { term: "Expected evidence", meaning: "proof that should be collected later" },
  { term: "Not verified", meaning: "no evidence has been collected yet" },
  { term: "Recommended tool", meaning: "a suggested tool, not an executed action" },
  { term: "Action preview", meaning: "a suggested next action, not a created action pack" },
];

/** Beta data-safety notes shown around input + saved records. */
export const BETA_SAFETY_NOTES = {
  beforeInput:
    "Avoid pasting confidential information such as passwords, secret keys (API tokens), or sensitive customer data.",
  savedScope:
    "Saved workflow plans are tied to this browser and user key only. This is a beta-level separation, not full team authentication.",
  savedRetention:
    "Saved workflow plans may include excerpts and generated workflow snapshots. Archive or delete records you no longer need.",
  feedback:
    "Feedback email opens with safe context only. No pasted content or workflow snapshots are included.",
};

/** Empty-state copy. */
export const EMPTY_STATES = {
  beforeInput:
    "Start with what you already have. You can paste a rough idea, a product spec, a URL, a code repository, a code change (PR), or a description of an AI-built app. Simsa will create a step-by-step acceptance workflow preview from it.",
  noSavedRecords:
    "No saved workflow plans yet. Create a preview above, then save it to reopen the comparison, decision, and action previews later.",
  noOpenedRecord:
    "Open a saved workflow plan to see its comparison, decision/outcome, and next-action previews.",
};

const EN_COPY = {
  heading: ONBOARDING_HEADING,
  intro: ONBOARDING_INTRO,
  steps: ONBOARDING_STEPS,
  safetyLine: ONBOARDING_SAFETY_LINE,
  previewLanguageItems: PREVIEW_LANGUAGE_ITEMS,
  safetyNotes: BETA_SAFETY_NOTES,
  emptyStates: EMPTY_STATES,
};

const KO_COPY = {
  heading: "이 베타 미리보기는 이렇게 동작해요",
  intro:
    "아이디어, 제품 기획서(PRD), 제품 URL, 코드 저장소나 코드 변경(PR) 링크, 또는 AI가 만든 앱 설명을 붙여넣으세요. Simsa가 단계별 검수 워크플로우 미리보기로 만들어 드립니다.",
  steps: [
    "붙여넣은 내용 이해",
    "검수 항목 초안 작성",
    "역할별 확인 작업 계획",
    "나중에 검토할 수 있도록 워크플로우 플랜 저장",
  ],
  safetyLine:
    "이 베타 흐름은 계획과 미리보기만 만듭니다. 에이전트 실행, 증거 수집, 벤치마크 실행, 최종 결정은 하지 않습니다.",
  previewLanguageItems: [
    { term: "후보", meaning: "아직 검토가 필요한 제안 항목" },
    { term: "기대 증거", meaning: "나중에 수집해야 할 증빙" },
    { term: "확인 부족", meaning: "아직 수집된 증거가 없음" },
    { term: "추천 도구", meaning: "제안된 도구일 뿐, 실행된 것은 아님" },
    { term: "액션 미리보기", meaning: "제안된 다음 행동일 뿐, 실제로 만들어진 것은 아님" },
  ],
  safetyNotes: {
    beforeInput:
      "비밀번호, 비밀 키(API 토큰), 민감한 고객 정보 등 기밀 정보는 붙여넣지 마세요.",
    savedScope:
      "저장된 워크플로우 플랜은 이 브라우저와 사용자 키에만 연결됩니다. 베타 수준의 구분이며, 완전한 팀 인증이 아닙니다.",
    savedRetention:
      "저장된 워크플로우 플랜에는 발췌문과 생성된 스냅샷이 포함될 수 있어요. 더 이상 필요 없는 기록은 보관하거나 삭제하세요.",
    feedback:
      "피드백 이메일에는 안전한 컨텍스트만 담깁니다. 붙여넣은 내용이나 워크플로우 스냅샷은 포함되지 않아요.",
  },
  emptyStates: {
    beforeInput:
      "지금 가진 것에서 시작하세요. 대략적인 아이디어, 제품 기획서, URL, 코드 저장소, 코드 변경(PR), 또는 AI가 만든 앱 설명을 붙여넣으면 Simsa가 단계별 검수 워크플로우 미리보기를 만들어 드립니다.",
    noSavedRecords:
      "아직 저장된 워크플로우 플랜이 없어요. 위에서 미리보기를 만들고 저장하면 비교·결정·액션 미리보기를 나중에 다시 열 수 있어요.",
    noOpenedRecord:
      "저장된 워크플로우 플랜을 열면 비교, 결정/결과, 다음 액션 미리보기를 볼 수 있어요.",
  },
};

export const BETA_ONBOARDING_COPY = { en: EN_COPY, ko: KO_COPY };

/** Locale-aware accessor (falls back to English for unknown locales). */
export function getBetaOnboardingCopy(locale) {
  return BETA_ONBOARDING_COPY[locale] ?? EN_COPY;
}
