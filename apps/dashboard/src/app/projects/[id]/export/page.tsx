"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import {
  getLocalProject,
  loadExtendedProjectData,
  saveOutcome,
  loadOutcomes,
  generateOutcomeId,
  getUserKey,
  type BuilderPackOutcome,
  type OutcomeStatus,
} from "@/lib/workflow-store";
import {
  callExportBuilderPackApi,
  callSaveOutcomeApi,
  callListOutcomesApi,
  type ExportBuilderPackResponse,
  type ExportFile,
  type ExportTarget,
  type RemoteOutcome,
} from "@/lib/workspace-export-api";
import { downloadBuildPackZip } from "@/lib/zip-utils";
import { StatusBadge } from "@/components/StatusBadge";
import type { ItemStatus } from "@/lib/labels";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";

// ─── Types ────────────────────────────────────────────────────────────────────

type SelectableItem = {
  id: string;
  title: string;
  checkStatus: ItemStatus;
};

type StatusFilter = "all" | "failed" | "inconclusive" | "needs_decision" | "passed" | "not_started";

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_VALUES: ExportTarget[] = ["claude_code", "codex", "both"];

const OUTCOME_OPTIONS: { value: OutcomeStatus; activeColor: string }[] = [
  { value: "worked", activeColor: "bg-green-600 text-white border-transparent" },
  { value: "partial", activeColor: "bg-amber-500 text-white border-transparent" },
  { value: "failed", activeColor: "bg-red-600 text-white border-transparent" },
  { value: "not_checked", activeColor: "bg-gray-500 text-white border-transparent" },
];

const STATUS_FILTER_VALUES: StatusFilter[] = [
  "all", "failed", "inconclusive", "needs_decision", "passed", "not_started",
];

// Display names; brand product names are not translated.
const TARGET_LABEL: Record<ExportTarget, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  both: "Claude Code + Codex",
};

function targetOptionLabel(t: Dictionary, v: ExportTarget): string {
  if (v === "claude_code") return t.exportPage.targetClaude;
  if (v === "codex") return t.exportPage.targetCodex;
  return t.exportPage.targetBoth;
}

function outcomeLabel(t: Dictionary, v: OutcomeStatus): string {
  if (v === "worked") return t.exportPage.outcomeWorked;
  if (v === "partial") return t.exportPage.outcomePartial;
  if (v === "failed") return t.exportPage.outcomeFailed;
  return t.exportPage.outcomeNotChecked;
}

function filterLabel(t: Dictionary, v: StatusFilter): string {
  return v === "all" ? t.exportPage.filterAll : statusLabel(t, v);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filename(path: string): string {
  return path.split("/").pop() ?? path;
}

function downloadMarkdownBundle(files: ExportFile[], projectTitle: string): void {
  const content = files
    .map((f) => `<!-- FILE: ${f.path} -->\n\n${f.content}`)
    .join("\n\n---\n\n");
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conclave-build-pack-${projectTitle.replace(/[^a-zA-Z0-9가-힣]/g, "-").slice(0, 40)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const project = getLocalProject(id) ?? getProject(id);

  // ── Selection state ──────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [target, setTarget] = useState<ExportTarget>("claude_code");

  // ── Export state ─────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ExportBuilderPackResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);

  // ── Outcome state ────────────────────────────────────────────────────────
  const [outcomes, setOutcomes] = useState<(BuilderPackOutcome | RemoteOutcome)[]>([]);
  const [outcomeStatus, setOutcomeStatus] = useState<OutcomeStatus | null>(null);
  const [outcomeNote, setOutcomeNote] = useState("");
  const [outcomeSavePhase, setOutcomeSavePhase] = useState<"idle" | "saving" | "saved_remote" | "saved_local">("idle");

  // ── Derived ──────────────────────────────────────────────────────────────
  const ext = loadExtendedProjectData(id);
  const checkResultMap = new Map(
    (ext?.checkResults?.results ?? []).map((r) => [r.itemId, r.status as ItemStatus]),
  );

  const allItems: SelectableItem[] = (project?.requirements ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    checkStatus: checkResultMap.get(r.id) ?? (r.status as ItemStatus),
  }));

  const filteredItems =
    statusFilter === "all"
      ? allItems
      : allItems.filter((i) => i.checkStatus === statusFilter);

  const effectiveSelectedIds = selectionMode === "all" ? null : selectedIds;

  const problemItemCount = allItems.filter((i) =>
    ["failed", "inconclusive", "needs_decision"].includes(i.checkStatus),
  ).length;

  // ── Load outcomes on mount (D1 first, localStorage fallback) ─────────────
  useEffect(() => {
    async function loadRemote() {
      const remote = await callListOutcomesApi(id, getUserKey());
      if (remote.ok && remote.outcomes.length > 0) {
        setOutcomes(remote.outcomes);
      } else {
        setOutcomes(loadOutcomes(id));
      }
    }
    loadRemote().catch(() => setOutcomes(loadOutcomes(id)));
  }, [id]);

  // ── Generate pack ────────────────────────────────────────────────────────
  const generate = useCallback(
    async (t: ExportTarget, sel: Set<string> | null) => {
      if (!project) return;
      setPhase("loading");

      const productSpec = ext?.productSpec ?? {
        productName: project.name,
        oneLine: project.description,
        targetUsers: [] as string[],
        problem: project.spec.goal,
        included: project.spec.included,
        excluded: project.spec.excluded,
        userFlow: [] as string[],
        decisions: [] as string[],
        openQuestions: project.spec.openDecisions,
      };

      const items = project.requirements.map((r) => ({
        id: r.id,
        title: r.title,
        status: checkResultMap.get(r.id) ?? r.status,
        criteria: ext?.itemCriteria?.[r.id] ?? [],
      }));

      const fixSuggestions: Record<string, unknown> = {};
      if (ext?.fixSuggestions) {
        for (const [itemId, fs] of Object.entries(ext.fixSuggestions)) {
          fixSuggestions[itemId] = { itemId, suggestion: fs.suggestion };
        }
      }

      const res = await callExportBuilderPackApi({
        project: {
          title: project.name,
          productSpec,
          items,
          checkResults: ext?.checkResults ?? undefined,
          fixSuggestions: Object.keys(fixSuggestions).length > 0 ? fixSuggestions : undefined,
        },
        selectedItemIds: sel && sel.size > 0 ? Array.from(sel) : undefined,
        target: t,
      });

      if (!res.ok) { setPhase("error"); return; }
      setResult(res);
      setPhase("done");
      setSelectedFile(res.bundle.files[0]?.path ?? null);
      setOutcomeSavePhase("idle");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, project],
  );

  useEffect(() => { generate(target, null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function handleTargetChange(t: ExportTarget) {
    setTarget(t);
    generate(t, effectiveSelectedIds);
  }

  function handleGenerate() {
    generate(target, effectiveSelectedIds);
  }

  function handleRecommend() {
    const priority = ["failed", "inconclusive", "needs_decision"];
    const candidates = allItems
      .filter((i) => priority.includes(i.checkStatus))
      .sort((a, b) => priority.indexOf(a.checkStatus) - priority.indexOf(b.checkStatus))
      .slice(0, 3);
    if (candidates.length > 0) {
      setSelectedIds(new Set(candidates.map((i) => i.id)));
      setSelectionMode("selected");
    }
  }

  function toggleItem(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  async function handleCopy(path: string, content: string) {
    await copyText(content);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  }

  async function handleCopyAll() {
    if (!result) return;
    const all = result.bundle.files.map((f) => `<!-- ${f.path} -->\n\n${f.content}`).join("\n\n---\n\n");
    await copyText(all);
    setCopiedPath("__all__");
    setTimeout(() => setCopiedPath(null), 2000);
  }

  async function handleZipDownload() {
    if (!result || isZipping) return;
    setIsZipping(true);
    try {
      await downloadBuildPackZip(result.bundle.files, project?.name ?? "pack");
    } finally {
      setIsZipping(false);
    }
  }

  async function handleSaveOutcome() {
    if (!outcomeStatus) return;
    setOutcomeSavePhase("saving");

    const selectedItemIds =
      effectiveSelectedIds && effectiveSelectedIds.size > 0
        ? Array.from(effectiveSelectedIds)
        : allItems.map((i) => i.id);

    const localOutcome: BuilderPackOutcome = {
      id: generateOutcomeId(),
      projectId: id,
      target,
      selectedItemIds,
      outcome: outcomeStatus,
      note: outcomeNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    // Try D1 first; always save to localStorage as cache
    const remote = await callSaveOutcomeApi({
      projectId: id,
      userKey: getUserKey(),
      target,
      selectedItemIds,
      outcome: outcomeStatus,
      note: outcomeNote.trim() || undefined,
    });

    if (remote.ok) {
      // D1 saved — use the server outcome (has canonical id)
      saveOutcome({ ...localOutcome, id: remote.outcome.id });
      setOutcomes((prev) => [remote.outcome, ...prev]);
      setOutcomeSavePhase("saved_remote");
    } else {
      // Fallback to localStorage only
      saveOutcome(localOutcome);
      setOutcomes((prev) => [localOutcome, ...prev]);
      setOutcomeSavePhase("saved_local");
    }

    setOutcomeNote("");
    setOutcomeStatus(null);
  }

  if (!project) return <ProjectNotFound />;

  const currentFile = result?.bundle.files.find((f) => f.path === selectedFile);

  return (
    <div className="max-w-5xl space-y-5">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">{t.exportPage.title}</h1>
        <p className="text-sm text-gray-500">{t.exportPage.intro}</p>
      </div>

      {/* ── Config: target + selection mode ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.exportPage.chooseAi}</p>
            <div className="flex gap-2">
              {TARGET_VALUES.map((value) => (
                <button key={value} onClick={() => handleTargetChange(value)}
                  disabled={phase === "loading"}
                  className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium transition-all disabled:opacity-50 ${target === value ? "bg-brand-600 text-white border-brand-600" : "bg-white text-gray-700 border-gray-200 hover:border-brand-300"}`}>
                  {targetOptionLabel(t, value)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.exportPage.scope}</p>
            <div className="flex gap-2">
              {(["all", "selected"] as const).map((mode) => (
                <button key={mode} onClick={() => setSelectionMode(mode)}
                  className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium transition-all ${selectionMode === mode ? "bg-brand-600 text-white border-brand-600" : "bg-white text-gray-700 border-gray-200 hover:border-brand-300"}`}>
                  {mode === "all" ? t.exportPage.scopeAll : t.exportPage.scopeSelected}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Item selection ── */}
      {selectionMode === "selected" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-700">
              {t.exportPage.selectTitle}
              <span className="ml-2 text-xs font-normal text-gray-500">
                {t.exportPage.selectedOfTotal
                  .replace("{sel}", String(selectedIds.size))
                  .replace("{total}", String(allItems.length))}
              </span>
            </p>
            <button onClick={handleRecommend} disabled={problemItemCount === 0}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {t.exportPage.recommend.replace("{n}", String(Math.min(problemItemCount, 3)))}
            </button>
          </div>
          {problemItemCount > 0 && (
            <p className="text-xs text-gray-500 mb-3">{t.exportPage.recommendHint}</p>
          )}
          {/* Status filter */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            {STATUS_FILTER_VALUES.map((value) => {
              const count = value === "all" ? allItems.length : allItems.filter((i) => i.checkStatus === value).length;
              if (value !== "all" && count === 0) return null;
              return (
                <button key={value} onClick={() => setStatusFilter(value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter === value ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {filterLabel(t, value)} ({count})
                </button>
              );
            })}
          </div>
          {/* Checkboxes */}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {filteredItems.map((item) => (
              <label key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer group">
                <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleItem(item.id)}
                  className="w-4 h-4 rounded accent-indigo-600 cursor-pointer flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-700">{item.title}</span>
                <StatusBadge status={item.checkStatus} />
              </label>
            ))}
            {filteredItems.length === 0 && (
              <p className="text-xs text-gray-500 py-4 text-center">{t.exportPage.noItemsForStatus}</p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end">
            <button onClick={handleGenerate} disabled={phase === "loading"}
              className="btn btn-md btn-primary">
              {phase === "loading" ? t.exportPage.generating : t.exportPage.generate}
            </button>
          </div>
        </div>
      )}

      {/* ── Loading / Error ── */}
      {phase === "loading" && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">{t.exportPage.generatingPack}</p>
        </div>
      )}
      {phase === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{t.exportPage.generateError}</span>
          <button onClick={handleGenerate} className="text-xs underline ml-4">{t.exportPage.retry}</button>
        </div>
      )}

      {/* ── Result ── */}
      {phase === "done" && result && (
        <>
          {/* Summary bar */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <span className="font-medium text-indigo-900">{t.exportPage.filesGenerated.replace("{n}", String(result.summary.fileCount))}</span>
              <span className="text-xs text-indigo-600">
                {t.exportPage.includedItems.replace("{n}", String(result.summary.selectedItems))}
                {result.summary.selectedItems < result.summary.totalItems
                  ? t.exportPage.ofTotal.replace("{total}", String(result.summary.totalItems))
                  : t.exportPage.ofTotalAll}
              </span>
              {result.bundle.files.some((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md")) && (
                <span className="text-xs bg-white text-indigo-600 border border-indigo-200 rounded-full px-2 py-0.5">{t.exportPage.claudeInstr}</span>
              )}
              {result.bundle.files.some((f) => f.path.endsWith("CODEX_PROMPT.md")) && (
                <span className="text-xs bg-white text-indigo-600 border border-indigo-200 rounded-full px-2 py-0.5">{t.exportPage.codexInstr}</span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleZipDownload} disabled={isZipping}
                className="btn btn-sm btn-primary">
                {isZipping ? t.exportPage.zipping : t.exportPage.downloadZip}
              </button>
              <button onClick={handleCopyAll}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 transition-colors">
                {copiedPath === "__all__" ? t.exportPage.copiedAll : t.exportPage.copyAll}
              </button>
              <button onClick={() => downloadMarkdownBundle(result.bundle.files, project.name)}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors">
                {t.exportPage.mdBundle}
              </button>
            </div>
          </div>

          {/* Step-by-step guide */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t.exportPage.howToTitle}</p>
            <ol className="space-y-2 text-sm text-gray-600">
              <li className="flex gap-2.5"><span className="text-indigo-500 font-semibold flex-shrink-0">1.</span><span>{t.exportPage.step1}</span></li>
              <li className="flex gap-2.5"><span className="text-indigo-500 font-semibold flex-shrink-0">2.</span><span>{t.exportPage.step2}</span></li>
              <li className="flex gap-2.5"><span className="text-indigo-500 font-semibold flex-shrink-0">3.</span><span>{t.exportPage.step3}</span></li>
              <li className="flex gap-2.5"><span className="text-indigo-500 font-semibold flex-shrink-0">4.</span><span>{t.exportPage.step4}</span></li>
              <li className="flex gap-2.5"><span className="text-indigo-500 font-semibold flex-shrink-0">5.</span><span>{t.exportPage.step5}</span></li>
            </ol>
          </div>

          {/* File browser */}
          <div className="flex gap-4 h-[500px]">
            <div className="w-48 flex-shrink-0 bg-white rounded-xl border border-gray-200 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 border-b border-gray-100">{t.exportPage.fileList}</p>
              <ul className="py-1">
                {result.bundle.files.map((f) => (
                  <li key={f.path}>
                    <button onClick={() => setSelectedFile(f.path)}
                      className={`w-full text-left px-4 py-2 text-xs transition-colors ${selectedFile === f.path ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>
                      {filename(f.path)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
              {currentFile ? (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                    <span className="text-xs font-mono text-gray-500">{currentFile.path}</span>
                    <button onClick={() => handleCopy(currentFile.path, currentFile.content)}
                      className="text-xs px-3 py-1 rounded-lg font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                      {copiedPath === currentFile.path ? t.exportPage.copied : t.exportPage.copy}
                    </button>
                  </div>
                  <pre className="flex-1 overflow-auto p-4 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap">{currentFile.content}</pre>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-gray-500">{t.exportPage.selectFile}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Outcome recording ── */}
          <OutcomeRecorder
            selectedItemCount={result.summary.selectedItems}
            target={target}
            selectedItemTitles={
              selectionMode === "selected" && selectedIds.size > 0
                ? allItems.filter((i) => selectedIds.has(i.id)).map((i) => i.title)
                : allItems.slice(0, 3).map((i) => i.title)
            }
            outcomeStatus={outcomeStatus}
            outcomeNote={outcomeNote}
            savePhase={outcomeSavePhase}
            onStatusChange={setOutcomeStatus}
            onNoteChange={setOutcomeNote}
            onSave={handleSaveOutcome}
          />

          {/* ── Past outcomes ── */}
          {outcomes.length > 0 && <OutcomeHistory outcomes={outcomes} projectId={id} />}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OutcomeRecorder({
  selectedItemCount,
  target,
  selectedItemTitles,
  outcomeStatus,
  outcomeNote,
  savePhase,
  onStatusChange,
  onNoteChange,
  onSave,
}: {
  selectedItemCount: number;
  target: ExportTarget;
  selectedItemTitles: string[];
  outcomeStatus: OutcomeStatus | null;
  outcomeNote: string;
  savePhase: "idle" | "saving" | "saved_remote" | "saved_local";
  onStatusChange: (s: OutcomeStatus) => void;
  onNoteChange: (n: string) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const isSaved = savePhase === "saved_remote" || savePhase === "saved_local";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-1">{t.exportPage.recordTitle}</h2>
      <div className="flex items-start gap-4 mb-4 text-xs text-gray-500">
        <span>{t.exportPage.target} <strong>{TARGET_LABEL[target]}</strong></span>
        <span><strong>{t.exportPage.outcomeItems.replace("{n}", String(selectedItemCount))}</strong></span>
        {selectedItemTitles.length > 0 && (
          <span className="truncate hidden sm:inline">
            ({selectedItemTitles.slice(0, 2).join(", ")}{selectedItemTitles.length > 2 ? t.exportPage.andMore : ""})
          </span>
        )}
      </div>

      {isSaved ? (
        <p className={`text-sm rounded-lg px-4 py-3 border ${savePhase === "saved_remote" ? "text-green-700 bg-green-50 border-green-200" : "text-amber-700 bg-amber-50 border-amber-200"}`}>
          {savePhase === "saved_remote"
            ? t.exportPage.savedRemote
            : t.exportPage.savedLocal}
        </p>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-4">
            {OUTCOME_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => onStatusChange(opt.value)}
                className={`text-sm px-4 py-2 rounded-lg border font-medium transition-all ${outcomeStatus === opt.value ? opt.activeColor : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                {outcomeLabel(t, opt.value)}
              </button>
            ))}
          </div>
          <textarea
            value={outcomeNote}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t.exportPage.notePlaceholder}
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
          />
          <button onClick={onSave} disabled={!outcomeStatus || savePhase === "saving"}
            className="btn btn-md btn-secondary">
            {savePhase === "saving" ? t.exportPage.saving : t.exportPage.save}
          </button>
        </>
      )}
    </div>
  );
}

function OutcomeHistory({
  outcomes,
  projectId,
}: {
  outcomes: (BuilderPackOutcome | RemoteOutcome)[];
  projectId: string;
}) {
  const { t } = useI18n();
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-3">{t.exportPage.historyTitle}</h2>
      <div className="space-y-2">
        {outcomes.slice(0, 10).map((oc) => (
          <div key={oc.id} className="flex items-start gap-3 text-xs text-gray-600 py-2 border-b border-gray-50 last:border-0">
            <span className="text-gray-500 flex-shrink-0 w-32">{formatDate(oc.createdAt)}</span>
            <span className="flex-shrink-0">{TARGET_LABEL[oc.target]}</span>
            <span className="flex-shrink-0 text-gray-500">{t.exportPage.itemsCount.replace("{n}", String(oc.selectedItemIds.length))}</span>
            <span className={`flex-shrink-0 font-medium ${oc.outcome === "worked" ? "text-green-600" : oc.outcome === "partial" ? "text-amber-600" : oc.outcome === "failed" ? "text-red-600" : "text-gray-500"}`}>
              {outcomeLabel(t, oc.outcome)}
            </span>
            {oc.note && <span className="text-gray-500 truncate flex-1">{oc.note}</span>}
            <Link
              href={`/projects/${projectId}/checks`}
              title={t.exportPage.recheckTooltip}
              className="flex-shrink-0 text-indigo-500 hover:text-indigo-700 font-medium"
            >
              {t.exportPage.recheck}
            </Link>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-3">{t.exportPage.historyNote}</p>
    </div>
  );
}
