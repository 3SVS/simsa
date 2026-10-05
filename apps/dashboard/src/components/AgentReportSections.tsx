"use client";

/**
 * AgentReportSections — agent 엔진(수용 기준 실행기) 리포트의 두 절 (2026-10-05).
 *
 *   ① "이렇게 이해하고 검사했어요" — 기준(AC)마다 통과 / 안 됨 / 확인 못 함 + 이유 + 화면에서 본 근거 + 해 본 순서
 *   ② "화면·버튼 점검" — 열어 본 화면 수, 눌러 본 버튼 수, 고장 난 화면·오류 버튼·반응 없는 버튼
 *
 * 리포트가 agent 엔진이 아니면(report.engine !== "agent") 아무것도 그리지 않는다 — 종전 리포트는 그대로.
 * 서버 응답을 믿지 않고 모양을 하나씩 확인해 읽는다(옛 서버·깨진 행에서도 화면이 죽지 않게).
 */
import { useState } from "react";

type Row = {
  id: string;
  title: string;
  priority: string;
  confirmed: boolean;
  then: string;
  status: "pass" | "fail" | "not_verified";
  reason: string;
  evidence: string[];
  actions: string[];
};

type SweepProblem = { kind: "screen" | "button"; where: string; label?: string; problem: string; detail?: string };

const COPY = {
  ko: {
    title: "이렇게 이해하고 검사했어요",
    basis: "기준의 출처",
    status: { pass: "통과", fail: "안 됨", not_verified: "확인 못 함" },
    must: "꼭 되어야 함",
    should: "되면 좋음",
    unconfirmed: "확인 전 기준",
    expected: "이렇게 되어야 해요",
    observed: "실제로 해 보니",
    seen: "화면에서 본 것",
    steps: "해 본 순서",
    showSteps: "순서 보기",
    sweepTitle: "화면·버튼 점검",
    sweepSummary: (s: number, b: number) => `화면 ${s}개를 열어 보고, 버튼 ${b}개를 한 번씩 눌러 봤어요.`,
    sweepOk: "열리지 않는 화면이나 오류가 나는 버튼은 없었어요.",
    skipped: (n: number) => `결제·삭제·발송처럼 되돌릴 수 없는 버튼 ${n}개는 누르지 않았어요.`,
    truncated: "화면이 많아 일부만 점검했어요.",
    problem: {
      http_error: "열리지 않음",
      blank: "빈 화면",
      error_text: "오류 문구가 보임",
      crash: "화면 코드 오류",
      error: "누르면 오류",
      no_reaction: "눌러도 반응 없음",
    } as Record<string, string>,
  },
  en: {
    title: "How we understood and checked it",
    basis: "Where the criteria came from",
    status: { pass: "Passed", fail: "Doesn't work", not_verified: "Couldn't check" },
    must: "Must work",
    should: "Nice to have",
    unconfirmed: "Not yet confirmed",
    expected: "It should",
    observed: "When we tried it",
    seen: "Seen on screen",
    steps: "What we did",
    showSteps: "Show steps",
    sweepTitle: "Screens & buttons check",
    sweepSummary: (s: number, b: number) => `We opened ${s} screens and pressed ${b} buttons once each.`,
    sweepOk: "No screen failed to open and no button threw an error.",
    skipped: (n: number) => `${n} buttons that can't be undone (payment, delete, send) were not pressed.`,
    truncated: "There were many screens, so only some were checked.",
    problem: {
      http_error: "Doesn't open",
      blank: "Blank screen",
      error_text: "Shows an error",
      crash: "Screen code error",
      error: "Error when pressed",
      no_reaction: "Nothing happens",
    } as Record<string, string>,
  },
} as const;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseAgentReport(report: unknown): {
  rows: Row[];
  basisLabel: string;
  sweep: { screens: number; buttons: number; skipped: number; truncated: boolean; problems: SweepProblem[] } | null;
} | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  if (r["engine"] !== "agent" || !Array.isArray(r["acTable"])) return null;
  const rows: Row[] = (r["acTable"] as unknown[])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: str(x["id"]),
      title: str(x["title"]),
      priority: str(x["priority"]),
      confirmed: x["confirmed"] === true,
      then: str(x["then"]),
      status: x["status"] === "pass" || x["status"] === "fail" ? x["status"] : "not_verified",
      reason: str(x["reason"]),
      evidence: Array.isArray(x["evidence"]) ? (x["evidence"] as unknown[]).map(str).filter(Boolean) : [],
      actions: Array.isArray(x["actions"]) ? (x["actions"] as unknown[]).map(str).filter(Boolean) : [],
    }));
  const agent = (r["agent"] && typeof r["agent"] === "object" ? r["agent"] : {}) as Record<string, unknown>;
  const s = r["sweep"] && typeof r["sweep"] === "object" ? (r["sweep"] as Record<string, unknown>) : null;
  const truncated = s && s["truncated"] && typeof s["truncated"] === "object" ? (s["truncated"] as Record<string, unknown>) : {};
  return {
    rows,
    basisLabel: str(agent["acSourceLabel"]),
    sweep: s
      ? {
          screens: Number(s["screensChecked"]) || 0,
          buttons: Number(s["buttonsChecked"]) || 0,
          skipped: Number(s["buttonsSkippedUnsafe"]) || 0,
          truncated: truncated["screens"] === true || truncated["buttons"] === true || truncated["time"] === true,
          problems: Array.isArray(s["problems"])
            ? (s["problems"] as unknown[])
                .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
                .map((p) => ({
                  kind: p["kind"] === "button" ? "button" : "screen",
                  where: str(p["where"]),
                  ...(str(p["label"]) ? { label: str(p["label"]) } : {}),
                  problem: str(p["problem"]),
                  ...(str(p["detail"]) ? { detail: str(p["detail"]) } : {}),
                }))
            : [],
        }
      : null,
  };
}

const STATUS_CLASS = {
  pass: "bg-green-50 text-green-700",
  fail: "bg-red-50 text-red-700",
  not_verified: "bg-gray-100 text-gray-600",
} as const;

function AcRow({ row, c }: { row: Row; c: (typeof COPY)["ko"] | (typeof COPY)["en"] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card space-y-1.5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>{c.status[row.status]}</span>
        <span className="font-medium text-gray-900">{row.title}</span>
        <span className="text-xs text-gray-400">
          {row.priority === "must" ? c.must : c.should}
          {!row.confirmed ? ` · ${c.unconfirmed}` : ""}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {c.expected}: {row.then}
      </p>
      {row.reason && (
        <p className="text-xs text-gray-700">
          {c.observed}: {row.reason}
        </p>
      )}
      {row.evidence.length > 0 && (
        <p className="text-xs text-gray-500">
          {c.seen}: “{row.evidence.join("” / “")}”
        </p>
      )}
      {row.actions.length > 0 && (
        <div>
          <button type="button" className="text-xs text-gray-500 underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {c.showSteps}
          </button>
          {open && <p className="mt-1 text-xs text-gray-500">{c.steps}: {row.actions.join(" → ")}</p>}
        </div>
      )}
    </li>
  );
}

export function AgentReportSections({ report, locale }: { report: unknown; locale: "ko" | "en" }) {
  const parsed = parseAgentReport(report);
  if (!parsed) return null;
  const c = COPY[locale === "en" ? "en" : "ko"];
  const broken = parsed.sweep?.problems.filter((p) => p.problem !== "no_reaction") ?? [];
  const quiet = parsed.sweep?.problems.filter((p) => p.problem === "no_reaction") ?? [];
  return (
    <>
      <section className="space-y-3" data-testid="agent-ac-table">
        <h3 className="section-title">{c.title}</h3>
        {parsed.basisLabel && (
          <p className="text-xs text-gray-500">
            {c.basis}: {parsed.basisLabel}
          </p>
        )}
        <ul className="space-y-2">
          {parsed.rows.map((row) => (
            <AcRow key={row.id} row={row} c={c} />
          ))}
        </ul>
      </section>
      {parsed.sweep && (
        <section className="space-y-2" data-testid="agent-sweep">
          <h3 className="section-title">{c.sweepTitle}</h3>
          <p className="text-xs text-gray-600">{c.sweepSummary(parsed.sweep.screens, parsed.sweep.buttons)}</p>
          {broken.length === 0 && <p className="text-xs text-gray-500">{c.sweepOk}</p>}
          {[...broken, ...quiet].length > 0 && (
            <ul className="space-y-1">
              {[...broken, ...quiet].slice(0, 30).map((p, i) => (
                <li key={i} className="text-xs text-gray-700">
                  <span className={p.problem === "no_reaction" ? "text-gray-500" : "font-medium text-red-700"}>{c.problem[p.problem] ?? p.problem}</span>
                  {" · "}
                  {p.label ? `“${p.label}” · ` : ""}
                  <span className="break-all text-gray-500">{p.where}</span>
                </li>
              ))}
            </ul>
          )}
          {parsed.sweep.skipped > 0 && <p className="text-xs text-gray-500">{c.skipped(parsed.sweep.skipped)}</p>}
          {parsed.sweep.truncated && <p className="text-xs text-gray-500">{c.truncated}</p>}
        </section>
      )}
    </>
  );
}
