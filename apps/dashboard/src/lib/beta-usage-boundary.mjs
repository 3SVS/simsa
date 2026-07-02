// Stage 122 — beta usage / cost boundary copy.
//
// Honest, conservative copy that makes the beta usage boundary clear: the intake
// preview chain is deterministic and low-cost, saving stores a lightweight
// snapshot, and NO agent/benchmark/LLM execution (and no billing) happens. Pure
// data — no enforcement, no billing, no backend.

export const BETA_USAGE_BOUNDARY_HEADING = "Beta usage boundary";

/** What is happening now + the boundary, as bullet copy. */
export const BETA_USAGE_BOUNDARY_ITEMS = [
  "This flow generates deterministic previews in your browser/app experience.",
  "Saving a workflow stores a lightweight workflow snapshot.",
  "This beta flow does not execute agents, run benchmarks, upload evidence, or make final decisions.",
  "Future AI/agent execution features will need explicit usage limits before beta expansion.",
];

/** Explicit "no billing" line. */
export const BETA_USAGE_NOT_ACTIVE_COPY =
  "No billing or paid usage is active for this beta preview.";

/** Saved workflow section boundary note. */
export const SAVED_WORKFLOW_USAGE_NOTE =
  "Saved workflow plans are stored snapshots for reopening the preview chain. They are not completed agent runs or benchmark results.";

/** Admin console boundary note. */
export const ADMIN_USAGE_BOUNDARY_NOTE =
  "This admin view shows saved workflow record summaries only. It does not show usage charges, billing, agent execution, or benchmark execution.";

/** Admin counts framing. */
export const ADMIN_COUNTS_SIGNAL_NOTE =
  "Use record counts as beta activity signals, not billing metrics.";

// Localized user-facing subset (admin notes stay EN — operator surface).
// The EN constants above remain the canonical source; KO mirrors them.
const EN_COPY = {
  heading: BETA_USAGE_BOUNDARY_HEADING,
  items: BETA_USAGE_BOUNDARY_ITEMS,
  notActive: BETA_USAGE_NOT_ACTIVE_COPY,
  savedWorkflowNote: SAVED_WORKFLOW_USAGE_NOTE,
};

const KO_COPY = {
  heading: "베타 사용 범위",
  items: [
    "이 흐름은 브라우저/앱 안에서 항상 같은 결과가 나오는 미리보기를 생성합니다.",
    "워크플로우를 저장하면 가벼운 스냅샷만 저장됩니다.",
    "이 베타 흐름은 에이전트 실행, 벤치마크 실행, 증거 업로드, 최종 결정을 하지 않습니다.",
    "향후 AI/에이전트 실행 기능은 베타 확장 전에 명시적인 사용 한도를 먼저 갖추게 됩니다.",
  ],
  notActive: "이 베타 미리보기에서는 어떤 결제나 유료 사용도 발생하지 않습니다.",
  savedWorkflowNote:
    "저장된 워크플로우 플랜은 미리보기 체인을 다시 열기 위한 스냅샷입니다. 완료된 에이전트 실행이나 벤치마크 결과가 아닙니다.",
};

export const BETA_USAGE_BOUNDARY_COPY = { en: EN_COPY, ko: KO_COPY };

/** Locale-aware accessor (falls back to English for unknown locales). */
export function getBetaUsageBoundaryCopy(locale) {
  return BETA_USAGE_BOUNDARY_COPY[locale] ?? EN_COPY;
}
