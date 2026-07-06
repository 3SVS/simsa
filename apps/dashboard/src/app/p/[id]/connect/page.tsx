"use client";

/**
 * D1-b — project-scoped re-entry deep link: /p/{id}/connect
 *
 * The builder pack (central-plane) instructs the user's building agent to send
 * the user here with their deployed app URL, so the idea-only loop closes
 * without waiting for the user to drift back. This page:
 *   - restores project context from the route id (the source of truth), showing
 *     the project name when it is resolvable in this browser;
 *   - auto-focuses a deploy-URL input, soft-validates http(s);
 *   - connects the URL as a website source via the existing sources API, then
 *     routes to the project's visual checks so a live review can run;
 *   - degrades gracefully for the not-signed-in / cross-device case (the page
 *     still works with the anonymous userKey; a device-scoped note is shown when
 *     the project is not stored in this browser).
 *
 * Reuses existing endpoints only — no new backend surface.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import { getProject } from "@/lib/mock-data";
import { connectProjectSource } from "@/lib/workspace-sources-api";
import { normalizeDeployUrl } from "@/lib/connect-url.mjs";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n/I18nProvider";

export default function ConnectReentryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  // localStorage / userKey are client-only; resolve after mount so the first
  // paint is deterministic (no hydration mismatch) and the device-note is honest.
  const [mounted, setMounted] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [knownHere, setKnownHere] = useState(false);

  const [url, setUrl] = useState("");
  const [error, setError] = useState<"invalid" | "connect" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
    const project = getLocalProject(id) ?? getProject(id);
    setKnownHere(Boolean(project));
    setProjectName(project?.name ?? null);
  }, [id]);

  useEffect(() => {
    if (mounted) inputRef.current?.focus();
  }, [mounted]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const normalized = normalizeDeployUrl(url);
    if (!normalized.ok) {
      setError("invalid");
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setSubmitting(true);
    const res = await connectProjectSource(id, {
      userKey: getUserKey(),
      type: "website",
      reference: normalized.url,
    });

    if (res.ok) {
      toast.success(t.connectReentry.success);
      // Route to the live visual check; the user runs the inspection there.
      router.push(`/projects/${id}/visual-checks`);
      return;
    }

    setSubmitting(false);
    setError("connect");
    toast.error(t.connectReentry.errConnectFailed);
  }

  const c = t.connectReentry;

  return (
    <div className="mx-auto max-w-xl px-4 py-10 md:py-16">
      <div className="mb-6">
        <h1 className="page-title">{c.title}</h1>
        <p className="page-subtitle">{c.subtitle}</p>
      </div>

      <section className="card p-5 md:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {c.projectLabel}
        </p>
        <p className="mt-1 text-sm font-medium text-gray-800">
          {mounted && projectName ? projectName : id}
        </p>

        {mounted && !knownHere && (
          <div className="callout callout-info mt-4">
            <p className="font-medium">{c.deviceNoteTitle}</p>
            <p className="mt-1 leading-relaxed">{c.deviceNoteBody}</p>
            <Link href="/login" className="btn btn-secondary btn-sm mt-3">
              {t.nav.backToProjects}
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5">
          <label htmlFor="deploy-url" className="text-xs font-medium text-gray-500">
            {c.urlLabel}
          </label>
          <input
            id="deploy-url"
            ref={inputRef}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder={c.urlPlaceholder}
            autoComplete="url"
            className="input mt-1"
          />
          <p className="mt-1.5 text-xs text-gray-400">{c.urlHint}</p>

          {error === "invalid" && (
            <div className="callout callout-error mt-3">{c.errInvalidUrl}</div>
          )}
          {error === "connect" && (
            <div className="callout callout-error mt-3">{c.errConnectFailed}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-loading={submitting ? "true" : undefined}
            className="btn btn-primary btn-md mt-4 w-full"
          >
            {submitting ? (
              <>
                <Spinner />
                {c.submitting}
              </>
            ) : error === "connect" ? (
              c.retry
            ) : (
              c.submit
            )}
          </button>
        </form>

        {/* Return hub: the deep link now also routes to repo connect + code
            re-check, not just the website URL — so "come back and connect it"
            covers both halves of what the user built. */}
        <div className="mt-6 border-t border-gray-100 pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{c.orLabel}</p>
          <p className="mt-2 text-sm font-medium text-gray-800">{c.repoTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{c.repoBody}</p>
          <Link href={`/projects/${id}/github`} className="btn btn-secondary btn-sm mt-3">
            {c.repoLink}
          </Link>
        </div>
      </section>
    </div>
  );
}
