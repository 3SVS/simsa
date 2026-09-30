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
};

/** '다시 확인한 증거' — 고친 뒤 실제 앱을 다시 연 별도 확인의 판정만. */
export type ReceiptRecheck =
  | { state: "none" }
  | { state: "active"; runId: string }
  | { state: "failed"; runId: string }
  | { state: "linked"; runId: string; resolved: boolean | null }
  | { state: "done"; runId: string; works: boolean | null; decision: string; at: string; via: "afterFix" | "sourceCheck" };

export type ReceiptNextAction =
  | { kind: "viewRecheck"; runId: string }
  | { kind: "recheckAfterFix" | "viewRepair" | "fix" | "tellUs" | "backToProject" };

export type ReceiptReadyView = {
  state: "ready";
  runId: string;
  checked: { targetUrl: string; intent: string; at: string };
  verdict: { works: boolean | null; decision: string };
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

export function notSeenText(n: ReceiptNotSeen, r: { notSeen: Record<string, string> }): string;

export function receiptPlainText(
  view: ReceiptView,
  t: Dictionary,
  formatDate: (iso: string) => string,
  opts?: { partial?: boolean },
): string;
