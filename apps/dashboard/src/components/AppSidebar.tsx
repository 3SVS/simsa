"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadLocalProjects, getUserKey } from "@/lib/workflow-store";
import { MOCK_PROJECTS, type Project } from "@/lib/mock-data";
import { buildBetaFeedbackMailto } from "@/lib/beta-feedback.mjs";

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
  const projectId = useProjectId(pathname);

  const [collapsed, setCollapsed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
    setProjects([...loadLocalProjects(), ...MOCK_PROJECTS]);
  }, []);

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

  // "Code repository" (settings) leads the Review group — it is the entry point
  // of the review loop. Operator screens live under a collapsed Advanced group.
  const groups = [
    { label: t.nav.groupPlan, items: [["", t.nav.overview], ["idea", t.nav.idea], ["spec", t.nav.spec], ["items", t.nav.items]] },
    { label: t.nav.groupReview, items: [["settings", t.nav.settings], ["github", t.nav.github], ["checks", t.nav.checks], ["visual-checks", t.nav.visualChecks]] },
    { label: t.nav.groupDeliver, items: [["fixes", t.nav.fixes], ["export", t.nav.export]] },
  ] as const;
  const advancedItems = [["experiment", t.nav.experiment], ["benchmark", t.nav.benchmark]] as const;

  // ── Collapsed rail ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="sticky top-0 flex h-screen w-14 flex-shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4">
        <button onClick={toggleCollapse} aria-label="Expand sidebar" className="mb-4 grid h-8 w-8 place-items-center rounded-md hover:bg-gray-100">
          <span aria-hidden className="h-3 w-3 rounded-full border-[1.5px] border-gold-500" />
        </button>
        <Link href="/projects/new" aria-label={t.nav.newProject} className="mb-2 grid h-8 w-8 place-items-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">＋</Link>
        <Link href="/projects" aria-label={t.nav.allProjects} className="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-50">▦</Link>
        <Link href="/account" aria-label={t.account.openLabel} className="mt-auto grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white hover:bg-brand-700">{initial}</Link>
      </aside>
    );
  }

  // ── Expanded sidebar ────────────────────────────────────────────────────────
  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* Brand + collapse */}
      <div className="flex items-center justify-between px-3 pb-2 pt-4">
        <Link href="/projects" className="group flex items-center gap-2.5 px-1.5">
          <span aria-hidden className="h-3 w-3 rounded-full border-[1.5px] border-gold-500 transition-colors group-hover:bg-gold-500" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">{t.brand.wordmark}</span>
        </Link>
        <button onClick={toggleCollapse} aria-label="Collapse sidebar" className="grid h-7 w-7 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">«</button>
      </div>

      <div className="px-3 py-1.5">
        <Link href="/projects/new" className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50">
          <span className="text-gray-400">＋</span>
          {t.nav.newProject}
        </Link>
      </div>

      {/* Nav body: project sections when inside a project, else searchable project list */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {project ? (
          <>
            <Link href="/projects" className="mb-2 flex items-center gap-1 px-1.5 text-xs text-gray-400 hover:text-gray-700">
              ← {t.nav.allProjects}
            </Link>
            <p className="truncate px-1.5 pb-2 text-xs font-medium text-gray-700">{project.name}</p>
            {groups.map((g) => (
              <div key={g.label} className="mb-4">
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300">{g.label}</p>
                <ul className="space-y-0.5">
                  {g.items.map(([slug, label]) => {
                    const href = slug ? `${base}/${slug}` : base;
                    return (
                      <li key={slug || "overview"}>
                        <Link href={href} className={itemClass(pathname === href)}>{label}</Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300 hover:text-gray-500"
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.nav.searchProjects}
              className="mb-2 w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] placeholder:text-gray-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300">{t.nav.allProjects}</p>
            <ul className="space-y-0.5">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className={itemClass(pathname.startsWith(`/projects/${p.id}`))}>
                    {p.name}
                    {MOCK_IDS.has(p.id) && (
                      <span className="ml-1.5 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-px text-[9px] font-medium text-gray-400">
                        {t.projects.exampleBadge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-gray-400">{t.nav.noProjects}</li>}
            </ul>
          </>
        )}
      </nav>

      {/* Profile + plan (bottom) — links to local account settings */}
      <div className="border-t border-gray-100 p-2">
        <a
          href={buildBetaFeedbackMailto({ route: pathname, section: "Dashboard" })}
          className="mb-1 block rounded-md px-2.5 py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
        >
          {t.nav.feedback}
        </a>
        <Link href="/account" aria-label={t.account.openLabel} className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-gray-50">
          <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-gray-900">{t.account.workspace}</span>
            <span className="block truncate text-[11px] text-gray-400">{t.account.plan}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
