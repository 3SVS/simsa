"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

// Stage 262 — Sources (연결). Connect a project's inputs: website URL,
// GitHub repo (owner/repo) and PRD-style documents (md/txt/pdf, ≤10MB).
// Client component (localStorage userKey); ownership enforced server-side.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  listProjectSources,
  connectProjectSource,
  uploadProjectDocument,
  deleteProjectSource,
  buildSourceFileUrl,
  type ProjectSource,
} from "@/lib/workspace-sources-api";
import {
  validateSourceInput,
  validateDocumentFile,
  sourceTypeLabel,
  formatBytes,
} from "@/lib/project-sources.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

function formatDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return iso; }
}

/** Map local-validation / server error codes to a localized message. */
function errorMessage(t: Dictionary, code: string): string {
  const known = t.sources.errors as Record<string, string>;
  return known[code] ?? t.sources.errors.generic;
}

const TYPE_CLASS: Record<string, string> = {
  website: "bg-green-50 text-green-700 border-green-200",
  github_repo: "bg-slate-50 text-slate-600 border-slate-200",
  document: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function SourcesPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [websiteError, setWebsiteError] = useState<string | null>(null);

  const [repoFullName, setRepoFullName] = useState("");
  const [repoBusy, setRepoBusy] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  const [docLabel, setDocLabel] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await listProjectSources(id, userKey);
    if (res.ok) {
      setSources(res.sources);
      setPhase("done");
    } else if (res.error === "project_not_found") {
      // Local-only project: nothing on the server yet — show the empty panel.
      setSources([]);
      setPhase("done");
    } else {
      setPhase("error");
    }
  }, [id, userKey]);

  useEffect(() => {
    setPhase("loading");
    void load();
  }, [load]);

  if (!project) return <ProjectNotFound />;

  async function handleConnect(type: "website" | "github_repo") {
    const reference = (type === "website" ? websiteUrl : repoFullName).trim();
    const setBusy = type === "website" ? setWebsiteBusy : setRepoBusy;
    const setError = type === "website" ? setWebsiteError : setRepoError;

    setError(null);
    const valid = validateSourceInput(type, reference);
    if (!valid.ok) {
      setError(errorMessage(t, valid.error));
      return;
    }
    setBusy(true);
    const res = await connectProjectSource(id, { userKey, type, reference });
    setBusy(false);
    if (res.ok) {
      if (type === "website") setWebsiteUrl("");
      else setRepoFullName("");
      await load();
    } else {
      setError(errorMessage(t, res.error));
    }
  }

  async function handleUpload() {
    const file = fileInput.current?.files?.[0];
    setDocError(null);
    if (!file) return;
    const valid = validateDocumentFile(file.name, file.size);
    if (!valid.ok) {
      setDocError(errorMessage(t, valid.error));
      return;
    }
    setDocBusy(true);
    const res = await uploadProjectDocument(id, userKey, file, docLabel.trim() || undefined);
    setDocBusy(false);
    if (res.ok) {
      setDocLabel("");
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } else {
      setDocError(errorMessage(t, res.error));
    }
  }

  async function handleDisconnect(sourceId: string) {
    if (!window.confirm(t.sources.confirmDisconnect)) return;
    setDisconnectError(null);
    const res = await deleteProjectSource(id, sourceId, userKey);
    if (res.ok) await load();
    // A swallowed failure leaves the source in the list with no signal that the
    // disconnect didn't take — tell the user and keep the row so they can retry.
    else setDisconnectError(t.sources.errors.disconnectFailed);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t.sources.title}</h2>
        <p className="page-subtitle">{t.sources.subtitle}</p>
      </div>

      {/* Connect: website */}
      <section className="card p-5">
        <h3 className="section-title">{t.sources.websiteTitle}</h3>
        <p className="section-desc">{t.sources.websiteHint}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder={t.sources.websitePlaceholder}
            className="input flex-1"
            inputMode="url"
          />
          <button
            onClick={() => handleConnect("website")}
            disabled={websiteBusy || !websiteUrl.trim()}
            className="btn btn-primary btn-md flex-shrink-0"
          >
            {websiteBusy ? t.sources.connecting : t.sources.connect}
          </button>
        </div>
        {websiteError && <p className="mt-2 text-xs text-red-600">{websiteError}</p>}
      </section>

      {/* Connect: GitHub repo */}
      <section className="card p-5">
        <h3 className="section-title">{t.sources.githubTitle}</h3>
        <p className="section-desc">{t.sources.githubHint}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={repoFullName}
            onChange={(e) => setRepoFullName(e.target.value)}
            placeholder={t.sources.githubPlaceholder}
            className="input flex-1 font-mono"
          />
          <button
            onClick={() => handleConnect("github_repo")}
            disabled={repoBusy || !repoFullName.trim()}
            className="btn btn-primary btn-md flex-shrink-0"
          >
            {repoBusy ? t.sources.connecting : t.sources.connect}
          </button>
        </div>
        {repoError && <p className="mt-2 text-xs text-red-600">{repoError}</p>}
      </section>

      {/* Connect: document upload */}
      <section className="card p-5">
        <h3 className="section-title">{t.sources.documentTitle}</h3>
        <p className="section-desc">{t.sources.documentHint}</p>
        <div className="mt-3 space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept=".md,.txt,.pdf"
            className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-50"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={docLabel}
              onChange={(e) => setDocLabel(e.target.value)}
              placeholder={t.sources.labelPlaceholder}
              aria-label={t.sources.labelLabel}
              maxLength={120}
              className="input flex-1"
            />
            <button
              onClick={handleUpload}
              disabled={docBusy}
              className="btn btn-secondary btn-md flex-shrink-0"
            >
              {docBusy ? t.sources.uploading : t.sources.upload}
            </button>
          </div>
        </div>
        {docError && <p className="mt-2 text-xs text-red-600">{docError}</p>}
      </section>

      {/* Connected sources */}
      <section className="space-y-3">
        <h3 className="section-title">{t.sources.connectedTitle}</h3>

        {phase === "loading" && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
            {t.sources.loading}
          </div>
        )}

        {phase === "error" && (
          <div className="callout callout-error flex items-center justify-between gap-3">
            <span>{t.sources.errors.loadFailed}</span>
            <button
              type="button"
              onClick={() => { setPhase("loading"); void load(); }}
              className="btn btn-sm btn-secondary flex-shrink-0"
            >
              {t.common.retry}
            </button>
          </div>
        )}

        {disconnectError && (
          <div className="callout callout-error">{disconnectError}</div>
        )}

        {phase === "done" && sources.length === 0 && (
          <div className="empty-state">
            <p className="text-xs text-gray-500">{t.sources.empty}</p>
          </div>
        )}

        {phase === "done" && sources.length > 0 && (
          <ul className="space-y-2">
            {sources.map((source) => (
              <li key={source.id} className="card flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_CLASS[source.type] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
                    {sourceTypeLabel(source.type, t)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">
                      {source.type === "document" ? (source.label ?? source.reference) : source.reference}
                    </p>
                    <p className="truncate text-[11px] text-gray-500">
                      {formatDate(source.createdAt, locale)}
                      {source.type === "document" && source.sizeBytes != null && ` · ${formatBytes(source.sizeBytes)}`}
                      {source.type !== "document" && source.label && ` · ${source.label}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {/* Stage 267 — document → spec draft entry point */}
                  {source.type === "document" && (
                    <Link
                      href={`/projects/${id}/sources/${source.id}/draft`}
                      className="btn btn-primary btn-sm"
                    >
                      {t.sources.draft.cta}
                    </Link>
                  )}
                  {source.type === "document" && (
                    <a
                      href={buildSourceFileUrl(id, source.id, userKey)}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm"
                    >
                      {t.sources.download}
                    </a>
                  )}
                  <button
                    onClick={() => handleDisconnect(source.id)}
                    className="btn btn-ghost btn-sm"
                  >
                    {t.sources.disconnect}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
