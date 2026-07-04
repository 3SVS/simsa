"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadLocalProjects, loadExtendedProjectData, getUserKey } from "@/lib/workflow-store";
import { MOCK_PROJECTS, type Project } from "@/lib/mock-data";
import { buildBetaFeedbackMailto } from "@/lib/beta-feedback.mjs";
import { computeProjectSteps } from "@/lib/project-steps.mjs";
import { fetchProjectRepo, listProjectReviewHistory } from "@/lib/workspace-github-api";

const MOCK_IDS = new Set(MOCK_PROJECTS.map((p) => p.id));

const COLLAPSE_KEY = "conclave:sidebar-collapsed";

function useProjectId(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "projects" && seg[1] && seg[1] !== "new") return seg[1];
  return null;
}

export function AppSidebar() {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const projectId = useProjectId(pathname);

  const [collapsed, setCollapsed] = useState(false);
  // Mobile (<md): the sidebar is hidden and replaced by a fixed top bar with a
  // menu button that opens the SAME expanded body as an overlay drawer. Without
  // this the fixed w-60 rail left ~120px of content on a 360px phone.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Progress-map facts. null = unknown (loading/failed) — the state machine
  // fails OPEN on null: it never locks on an unconfirmed fact.
  const [hasRepo, setHasRepo] = useState<boolean | null>(null);
  const [hasReviewRun, setHasReviewRun] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
    setProjects([...loadLocalProjects(), ...MOCK_PROJECTS]);
  }, []);

  // Observe repo-link + review-run facts for the progress map (best-effort;
  // errors leave the fact unknown → fail-open, no false locks).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setHasRepo(null);
    setHasReviewRun(null);
    const uk = getUserKey();
    fetchProjectRepo(projectId, uk)
      .then((res) => { if (!cancelled) setHasRepo(res.ok ? Boolean(res.repo) : null); })
      .catch(() => {});
    listProjectReviewHistory(projectId, uk, { limit: 1 })
      .then((res) => { if (!cancelled) setHasReviewRun(res.ok ? res.runs.length > 0 : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, pathname]);

  // Navigating closes the mobile drawer (links inside it change the pathname).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  const project = projectId ? projects.find((p) => p.id === projectId) ?? null : null;
  const base = projectId ? `/projects/${projectId}` : "";
  const userKey = typeof window !== "undefined" ? getUserKey() : "";
  const initial = (userKey.replace(/^uk_/, "")[0] ?? "C").toUpperCase();

  const filtered = query.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : projects;

  const itemClass = (active: boolean) =>
    `block truncate rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      active ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
    }`;

  // The left nav is a PROGRESS MAP, not a flat tab list: three steps
  // (준비 → 검수 → 결과·수정) with derived done/current/locked states. The state
  // machine (project-steps.mjs) locks only on CONFIRMED-unmet preconditions and
  // auto-checks work already done — no wandering, no rework.
  const hasItems = project ? project.requirements.length > 0 : null;
  // The branch this project entered through — the map adapts (code branch:
  // prepare is optional, review never locks on items; skipping idea is normal).
  const entryPath = projectId ? (loadExtendedProjectData(projectId)?.entryPath ?? null) : null;
  const steps = computeProjectSteps({ hasItems, hasRepo, hasReviewRun, entryPath });
  const stepMeta: Record<string, { label: string; items: ReadonlyArray<readonly [string, string]> }> = {
    prepare: {
      label: t.stepsNav.prepare,
      items: [["idea", t.nav.idea], ["spec", t.nav.spec], ["items", t.nav.items]],
    },
    review: {
      label: t.stepsNav.review,
      items: [["settings", t.nav.settings], ["github", t.nav.github]],
    },
    results: {
      label: t.stepsNav.results,
      items: [["checks", t.nav.checks], ["visual-checks", t.nav.visualChecks], ["fixes", t.nav.fixes], ["export", t.nav.export]],
    },
  };
  const lockHint = (reason: "need_items" | "need_code" | null) =>
    reason === "need_code" ? t.stepsNav.lockNeedCode : reason === "need_items" ? t.stepsNav.lockNeedItems : "";
  const statusGlyph = (status: string) =>
    status === "done" ? "✓" : status === "current" ? "●" : "○";
  const advancedItems = [["experiment", t.nav.experiment], ["benchmark", t.nav.benchmark]] as const;

  // ── Expanded body (shared by the desktop aside and the mobile drawer) ──────
  const expandedBody = (
    <>
      {/* Brand + collapse */}
      <div className="flex items-center justify-between px-3 pb-2 pt-4">
        <Link href="/projects" className="group flex items-center gap-2.5 px-1.5">
          <span aria-hidden className="h-3 w-3 rounded-full border-[1.5px] border-gold-500 transition-colors group-hover:bg-gold-500" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">{t.brand.wordmark}</span>
        </Link>
        <button onClick={toggleCollapse} aria-label="Collapse sidebar" className="grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700">«</button>
      </div>

      <div className="px-3 py-1.5">
        <Link
          href="/projects/new"
          onClick={(e) => {
            // Already on the new-project flow: same-href Link is a no-op, so
            // force a full reset instead (?fresh nonce → the flow clears state).
            if (pathname.startsWith("/projects/new")) {
              e.preventDefault();
              router.push(`/projects/new?fresh=${Date.now()}`);
            }
          }}
          className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <span className="text-gray-500">＋</span>
          {t.nav.newProject}
        </Link>
      </div>

      {/* Nav body: project sections when inside a project, else searchable project list */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {project ? (
          <>
            <Link href="/projects" className="mb-2 flex items-center gap-1 px-1.5 text-xs text-gray-500 hover:text-gray-700">
              ← {t.nav.allProjects}
            </Link>
            <p className="truncate px-1.5 pb-2 text-xs font-medium text-gray-700">{project.name}</p>

            {/* Overview = the command center, above the steps */}
            <ul className="mb-3">
              <li>
                <Link href={base} className={itemClass(pathname === base)}>{t.nav.overview}</Link>
              </li>
            </ul>

            {/* 3-step progress map */}
            {steps.map((step, i) => {
              const meta = stepMeta[step.key]!;
              const locked = step.status === "locked";
              return (
                <div key={step.key} className="mb-3">
                  <p
                    className={`flex items-center gap-2 px-2.5 pb-1 text-[11px] font-semibold tracking-wide ${
                      locked ? "text-gray-400" : step.status === "current" ? "text-gray-900" : "text-gray-500"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-block w-3 text-center text-[10px] ${
                        step.status === "done"
                          ? "text-green-600"
                          : step.status === "current"
                            ? "text-brand-600"
                            : "text-gray-400"
                      }`}
                    >
                      {statusGlyph(step.status)}
                    </span>
                    {i + 1} · {meta.label}
                    {step.optional && (
                      <span className="rounded-full border border-gray-200 px-1.5 py-px text-[9px] font-medium text-gray-500">
                        {t.stepsNav.optionalTag}
                      </span>
                    )}
                  </p>
                  {locked ? (
                    <p className="px-2.5 pb-1 pl-[30px] text-[11px] text-gray-500">{lockHint(step.lockReason)}</p>
                  ) : (
                    <ul className="space-y-0.5 pl-[18px]">
                      {meta.items.map(([slug, label]) => {
                        const href = `${base}/${slug}`;
                        return (
                          <li key={slug}>
                            <Link href={href} className={itemClass(pathname === href)}>{label}</Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
              >
                {t.nav.groupAdvanced}
                <span aria-hidden>{showAdvanced ? "−" : "+"}</span>
              </button>
              {showAdvanced && (
                <ul className="space-y-0.5">
                  {advancedItems.map(([slug, label]) => {
                    const href = `${base}/${slug}`;
                    return (
                      <li key={slug}>
                        <Link href={href} className={itemClass(pathname === href)}>{label}</Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-2 border-t border-gray-100 pt-2">
              <Link href={`${base}/sources`} className={itemClass(pathname === `${base}/sources`)}>{t.nav.sources}</Link>
            </div>
          </>
        ) : (
          <>
            <input
              aria-label={t.nav.searchProjects}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.nav.searchProjects}
              className="mb-2 w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] placeholder:text-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t.nav.allProjects}</p>
            <ul className="space-y-0.5">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className={itemClass(pathname.startsWith(`/projects/${p.id}`))}>
                    {p.name}
                    {MOCK_IDS.has(p.id) && (
                      <span className="ml-1.5 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-px text-[9px] font-medium text-gray-500">
                        {t.projects.exampleBadge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-gray-500">{t.nav.noProjects}</li>}
            </ul>
          </>
        )}
      </nav>

      {/* Profile + plan (bottom) — links to local account settings */}
      <div className="border-t border-gray-100 p-2">
        <a
          href={buildBetaFeedbackMailto({ route: pathname, section: "Dashboard" })}
          className="mb-1 block rounded-md px-2.5 py-1.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
        >
          {t.nav.feedback}
        </a>
        <Link href="/account" aria-label={t.account.openLabel} className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-gray-50">
          <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-gray-900">{t.account.workspace}</span>
            <span className="block truncate text-[11px] text-gray-500">{t.account.plan}</span>
          </span>
        </Link>
      </div>
    </>
  );

  // ── Mobile chrome: fixed top bar + overlay drawer (always <md only) ────────
  const mobileChrome = (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b border-gray-200 bg-white px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t.nav.openMenu}
          className="grid h-9 w-9 place-items-center rounded-md text-lg text-gray-700 hover:bg-gray-100"
        >
          <span aria-hidden>☰</span>
        </button>
        <Link href="/projects" className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-3 rounded-full border-[1.5px] border-gold-500" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">{t.brand.wordmark}</span>
        </Link>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label={t.nav.closeMenu}
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl">
            {expandedBody}
          </div>
        </div>
      )}
    </>
  );

  // ── Collapsed rail (desktop only) ───────────────────────────────────────────
  if (collapsed) {
    return (
      <>
        {mobileChrome}
        <aside className="sticky top-0 hidden h-screen w-14 flex-shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4 md:flex">
          <button onClick={toggleCollapse} aria-label="Expand sidebar" className="mb-4 grid h-8 w-8 place-items-center rounded-md hover:bg-gray-100">
            <span aria-hidden className="h-3 w-3 rounded-full border-[1.5px] border-gold-500" />
          </button>
          <Link href="/projects/new" aria-label={t.nav.newProject} className="mb-2 grid h-8 w-8 place-items-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">＋</Link>
          <Link href="/projects" aria-label={t.nav.allProjects} className="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-50">▦</Link>
          <Link href="/account" aria-label={t.account.openLabel} className="mt-auto grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white hover:bg-brand-700">{initial}</Link>
        </aside>
      </>
    );
  }

  // ── Expanded sidebar (desktop) ──────────────────────────────────────────────
  return (
    <>
      {mobileChrome}
      <aside className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        {expandedBody}
      </aside>
    </>
  );
}
