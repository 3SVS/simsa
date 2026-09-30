// Type declarations for visual-check-receipt.mjs (Train C · C-3 확인 영수증).
import type { Dictionary } from "../i18n/dictionary.mjs";
import type { UserVerdict } from "./user-verdict.mjs";

export type ReceiptItemStatus = "pass" | "broken" | "notConfirmed" | "noProblemFound";

export type ReceiptNotSeen =
  | { kind: "loginBehind" }
  | { kind: "notReached"; titles: string[] }
  | { kind: "otherPaths" };

/** '고친 내용' — 고친 쪽(수리 잡)의 사실만. 판정 필드는 없다. */
export type ReceiptFix = {
  status: "done" | "active" | "failed";
  kind: "autoFix" | "briefOnly";
  changesUrl: string | null;
  changedFiles: number | null;
  buildCheck: "passed" | "unverified" | null;
  envCause: boolean;
  /** Code changed but no after-merge re-check is linked — the live app may not have it yet. */
  pendingLive: boolean;
};

/**
 * '다시 확인한 증거' — 실제 앱을 다시 연 별도 확인의 판정만. 수리가 있으면 그 수리가 끝난 뒤에 시작한 확인만.
 * unknown = 최근 목록이 가득 차 그 밖에 재검수가 있을 수 있다(없다고 단정하지 않는다).
 */
export type ReceiptRecheck =
  | { state: "none" }
  | { state: "unknown" }
  | { state: "active"; runId: string }
  | { state: "failed"; runId: string }
  | { state: "linked"; runId: string; resolved: boolean | null }
  | { state: "done"; runId: string; works: boolean | null; decision: string; at: string; via: "afterFix" | "sourceCheck" };

export type ReceiptNextAction =
  | { kind: "viewRecheck" | "viewRecheckProgress"; runId: string }
  | { kind: "recheckAfterFix" | "handOff" | "viewRepair" | "fix" | "tellUs" | "backToProject" };

export type ReceiptReadyView = {
  state: "ready";
  runId: string;
  checked: { targetUrl: string; intent: string; at: string };
  verdict: { works: boolean | null; decision: string };
  /** A record sent in from a check run elsewhere (executor ≠ container) — not a check Simsa opened. */
  uploaded: boolean;
  userVerdict: UserVerdict | null;
  source: { runId: string } | null;
  items: { basis: "acceptance" | "coreFlow"; rows: Array<{ title: string; expected: string | null; status: ReceiptItemStatus }> };
  notSeen: ReceiptNotSeen[];
  fix: ReceiptFix | null;
  recheck: ReceiptRecheck;
  showRecheck: boolean;
  nextAction: ReceiptNextAction;
};

export type ReceiptView =
  | ReceiptReadyView
  | { state: "missing" }
  | { state: "failed" }
  | { state: "notReady"; status: string };

export function buildReceiptView(input: { check: unknown; repair?: unknown; checks?: unknown }): ReceiptView;

export const RECEIPT_LIST_LIMIT: number;

/** Same as verdictLabel, but Conditionally Ready reads as the table does (status.noProblemFound). */
export function receiptVerdictLabel(
  works: boolean | null,
  decision: string,
  t: Dictionary,
): { label: string; tone: "passed" | "failed" | "clear" | "inconclusive" };

/** Title / who-judged line / not-yet line of the re-check section — shared by the page and the text copy. */
export function recheckTexts(
  view: Pick<ReceiptReadyView, "fix" | "recheck">,
  r: Dictionary["visualChecks"]["receipt"],
): { title: string; by: string | null; none: string };

export function notSeenText(n: ReceiptNotSeen, r: { notSeen: Record<string, string> }): string;

export function receiptPlainText(
  view: ReceiptView,
  t: Dictionary,
  formatDate: (iso: string) => string,
  opts?: { partial?: boolean },
): string;
