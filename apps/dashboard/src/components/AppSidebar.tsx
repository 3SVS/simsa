"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { loadLocalProjects, loadExtendedProjectData, getUserKey, setActiveAccountNamespace, clearActiveAccount, PROJECTS_CHANGED_EVENT } from "@/lib/workflow-store";
import { MOCK_PROJECTS, type Project } from "@/lib/mock-data";
import { FeedbackModal } from "@/components/FeedbackModal";
import { StampMark } from "@/components/brand/StampMark";
import { Tooltip } from "@/components/Tooltip";
import { getAuthSession, signOutAuth } from "@/lib/auth-client.mjs";
import { computeProjectSteps } from "@/lib/project-steps.mjs";
import { fetchProjectRepo, listProjectReviewHistory } from "@/lib/workspace-github-api";
import { fetchProjectRepoSettled, repoConnectedFact } from "@/lib/repo-settle.mjs";
import { SIMSA_REPO_URL } from "@/lib/simsa-share.mjs";

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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Signed-in identity for the bottom profile block (null = signed out/unknown).
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Progress-map facts. null = unknown (loading/failed) — the state machine
  // fails OPEN on null: it never locks on an unconfirmed fact.
  const [hasRepo, setHasRepo] = useState<boolean | null>(null);
  const [hasReviewRun, setHasReviewRun] = useState<boolean | null>(null);

  // Fetch the session, reconcile local storage to that identity, then (re)load
  // the project list from the now-correct account bucket. Called on mount and
  // whenever a "simsa:auth-changed" event fires (sign-in/out elsewhere), so the
  // sidebar never shows a stale signed-in identity or another account's projects.
  const syncSession = useCallback(async () => {
    const sess = await getAuthSession().catch(() => null);
    const email = (sess as { user?: { email?: string } } | null)?.user?.email;
    const resolved = typeof email === "string" ? email : null;
    setActiveAccountNamespace(resolved);
    setAuthEmail(resolved);
    setProjects([...loadLocalProjects(), ...MOCK_PROJECTS]);
  }, []);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
    // Optimistic first paint from whatever bucket is active; syncSession then
    // reconciles to the confirmed identity and reloads.
    setProjects([...loadLocalProjects(), ...MOCK_PROJECTS]);
    void syncSession();
    const onAuthChanged = () => void syncSession();
    window.addEventListener("simsa:auth-changed", onAuthChanged);
    return () => window.removeEventListener("simsa:auth-changed", onAuthChanged);
  }, [syncSession]);

  // A project created on /projects/new must appear in this list without a full
  // page reload — client-side navigation never remounts the layout sidebar, so
  // re-read the local bucket on every route change (localStorage is sync/cheap).
  // Live finding 2026-07-10: idea-branch users landed on their new project with
  // the sidebar still not showing it.
  useEffect(() => {
    setProjects([...loadLocalProjects(), ...MOCK_PROJECTS]);
  }, [pathname]);

  // Mutations on the SAME route (e.g. deleting a card on /projects) never
  // change pathname — the store fires this event so the list updates in place.
  // Live finding 2026-07-15: a deleted project's sidebar entry survived until
  // the next navigation.
  useEffect(() => {
    const onProjectsChanged = () => setProjects([...loadLocalProjects(), ...MOCK_PROJECTS]);
    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
  }, []);

  // Close the account menu on outside click / Escape.
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAccountMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountMenuOpen]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await signOutAuth().catch(() => false);
    clearActiveAccount();
    setAccountMenuOpen(false);
    setSigningOut(false);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("simsa:auth-changed"));
    router.push("/projects");
  }, [router]);

  // Observe repo-link + review-run facts for the progress map (best-effort;
  // errors leave the fact unknown → fail-open, no false locks).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setHasRepo(null);
    setHasReviewRun(null);
    const uk = getUserKey();
    fetchProjectRepoSettled(fetchProjectRepo, projectId, uk)
      .then((res) => { if (!cancelled) setHasRepo(repoConnectedFact(res)); })
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

  // Any FeedbackLink anywhere in the app opens the single shared modal.
  useEffect(() => {
    const open = () => setFeedbackOpen(true);
    window.addEventListener("simsa:open-feedback", open);
    return () => window.removeEventListener("simsa:open-feedback", open);
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

  // Active items carry a 2px brand left-stripe (not background-only) so the
  // current location reads at a glance. border-l is always present (transparent
  // when inactive) so text never shifts on selection.
  const itemClass = (active: boolean) =>
    `block truncate rounded-md border-l-2 px-2.5 py-1.5 text-[13px] transition-colors ${
      active
        ? "border-brand-500 bg-gray-100 font-medium text-gray-900"
        : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900"
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
      // 검수·준비 단계: 빌더팩이 기본. "코드 변경"(GitHub) 탭은 코드 갈래이거나
      // repo가 실제로 연결된 뒤에만 보인다 — 아이디어 갈래 유저에게 repo는 아직
      // 존재하지도, 알 필요도 없는 개념이다 (배님 2026-07-10 라이브 워크스루).
      items:
        entryPath === "code" || hasRepo === true
          ? [["github", t.nav.github], ["export", t.nav.export]]
          : [["export", t.nav.export]],
    },
    results: {
      label: t.stepsNav.results,
      // 결과·수정: 사전확인/검수 결과. 수정지시서(fixes)는 빌더팩에 포함되어 중복이라
      // 여기서 제거(설계 2026-07-06). /fixes 라우트 자체는 유지(직접 접근·이력용).
      items: [["checks", t.nav.checks], ["visual-checks", t.nav.visualChecks]],
    },
  };
  const lockHint = (reason: "need_items" | "need_code" | "need_build" | null) =>
    reason === "need_code"
      ? t.stepsNav.lockNeedCode
      : reason === "need_build"
        ? t.stepsNav.lockNeedBuild
        : reason === "need_items"
          ? t.stepsNav.lockNeedItems
          : "";
  const statusGlyph = (status: string) =>
    status === "done" ? "✓" : status === "current" ? "●" : "○";
  const advancedItems = [["experiment", t.nav.experiment], ["benchmark", t.nav.benchmark]] as const;

  // ── Expanded body (shared by the desktop aside and the mobile drawer) ──────
  const expandedBody = (
    <>
      {/* Brand + collapse */}
      <div className="flex items-center justify-between px-3 pb-2 pt-4">
        <Link href="/projects" className="group flex items-center gap-2.5 px-1.5">
          <StampMark size={24} className="transition-transform group-hover:scale-105" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">{t.brand.wordmark}</span>
        </Link>
        <Tooltip content="Collapse sidebar" placement="bottom">
          <button onClick={toggleCollapse} aria-label="Collapse sidebar" className="grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700">«</button>
        </Tooltip>
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
          className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300"
        >
          <span className="text-gray-500">＋</span>
          {t.nav.newProject}
        </Link>
      </div>

      {/* Nav body: project sections when inside a project, else searchable project list */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {project ? (
          <>
            <div className="-mx-1 mb-3 border-b border-gray-100 pb-2">
              <Link href="/projects" className="mb-1.5 flex items-center gap-1 px-2.5 text-xs text-gray-500 hover:text-gray-700">
                ← {t.nav.allProjects}
              </Link>
              <p className="truncate px-2.5 text-[13px] font-semibold text-gray-900">{project.name}</p>
            </div>

            {/* Overview = the command center, above the steps */}
            <ul className="mb-3">
              <li>
                <Link href={base} className={itemClass(pathname === base)}>{t.nav.overview}</Link>
              </li>
            </ul>

            {/* 3-step progress map — each step is a visually distinct SECTION
                (boxed group + numbered badge + bolder header), so step headers
                never read as just another nav item. Header was 11px vs 13px
                items before — an inverted hierarchy users couldn't parse. */}
            {steps.map((step, i) => {
              const meta = stepMeta[step.key]!;
              const locked = step.status === "locked";
              const current = step.status === "current";
              return (
                <div
                  key={step.key}
                  className={`mb-2 rounded-lg border p-1.5 ${
                    current ? "border-brand-200 bg-brand-50/40" : "border-gray-100 bg-gray-50/60"
                  } ${locked ? "opacity-70" : ""}`}
                >
                  <p
                    className={`flex items-center gap-2 px-1 pb-1 text-xs font-semibold ${
                      locked ? "text-gray-500" : "text-gray-900"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-md border text-[10px] font-bold ${
                        step.status === "done"
                          ? "border-green-200 bg-green-50 text-green-700"
                          : current
                            ? "border-brand-300 bg-brand-600 text-white"
                            : "border-gray-200 bg-white text-gray-500"
                      }`}
                    >
                      {step.status === "done" ? "✓" : i + 1}
                    </span>
                    {meta.label}
                    {step.optional && (
                      <span className="rounded-full border border-gray-200 bg-white px-1.5 py-px text-[9px] font-medium text-gray-500">
                        {t.stepsNav.optionalTag}
                      </span>
                    )}
                  </p>
                  {locked ? (
                    <p className="px-1 pb-1 pl-8 text-[11px] text-gray-500">{lockHint(step.lockReason)}</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {meta.items.map(([slug, label]) => {
                        const href = `${base}/${slug}`;
                        const active = pathname === href;
                        return (
                          <li key={slug}>
                            <Link
                              href={href}
                              className={`block truncate rounded-md py-1.5 pl-8 pr-2.5 text-[13px] transition-colors ${
                                active
                                  ? "border border-gray-200 bg-white font-medium text-gray-900 shadow-sm"
                                  : "text-gray-600 hover:bg-white/70 hover:text-gray-900"
                              }`}
                            >
                              {label}
                            </Link>
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
            {/* Always available — not a step: connection/notification settings + sources */}
            <div className="mt-2 border-t border-gray-100 pt-2">
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t.nav.groupAnytime}</p>
              <Link href={`${base}/settings`} className={itemClass(pathname === `${base}/settings`)}>{t.nav.settings}</Link>
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
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="mb-1 block w-full rounded-md px-2.5 py-1.5 text-left text-[12px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
        >
          {t.nav.feedback}
        </button>
        <a
          href={SIMSA_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-shrink-0" fill="currentColor">
            <path d="M8 .25l2.06 4.17 4.6.67-3.33 3.24.79 4.58L8 10.94l-4.12 2.17.79-4.58L1.34 5.09l4.6-.67L8 .25z" />
          </svg>
          {t.share.starGithub}
        </a>
        {/* G9 — 법적 문서 링크 (약관·개인정보·환불) */}
        <div className="mb-1 flex flex-wrap gap-x-2 px-2.5 py-1 text-[11px] text-gray-400">
          <Link href="/legal/terms" className="hover:text-gray-600 hover:underline">{t.nav.legalTerms}</Link>
          <Link href="/legal/privacy" className="hover:text-gray-600 hover:underline">{t.nav.legalPrivacy}</Link>
          <Link href="/legal/refunds" className="hover:text-gray-600 hover:underline">{t.nav.legalRefunds}</Link>
        </div>
        <div ref={accountMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setAccountMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label={t.account.openLabel}
            className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-gray-50"
          >
            <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {(authEmail?.[0] ?? initial).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              {authEmail ? (
                <>
                  <span className="block truncate text-[13px] font-medium text-gray-900">{authEmail}</span>
                  <span className="block truncate text-[11px] text-gray-500">{t.account.plan}</span>
                </>
              ) : (
                <>
                  <span className="block truncate text-[13px] font-medium text-gray-900">{t.account.workspace}</span>
                  <span className="block truncate text-[11px] text-brand-700">{t.account.auth.signIn} →</span>
                </>
              )}
            </span>
            <span aria-hidden className="text-gray-400">{accountMenuOpen ? "⌄" : "⌃"}</span>
          </button>

          {accountMenuOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            >
              <Link
                href="/account"
                role="menuitem"
                onClick={() => setAccountMenuOpen(false)}
                className="block px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
              >
                {t.account.menu.settings}
              </Link>
              {authEmail ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="block w-full px-3 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {signingOut ? t.account.menu.signingOut : t.account.menu.signOut}
                </button>
              ) : (
                <Link
                  href="/login?next=/projects"
                  role="menuitem"
                  onClick={() => setAccountMenuOpen(false)}
                  className="block px-3 py-1.5 text-[13px] text-brand-700 hover:bg-gray-50"
                >
                  {t.account.menu.signIn}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  // ── Mobile chrome: fixed top bar + overlay drawer (always <md only) ────────
  const mobileChrome = (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b border-gray-200 bg-white px-3 md:hidden">
        <Tooltip content={t.nav.openMenu} placement="bottom">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={t.nav.openMenu}
            className="grid h-9 w-9 place-items-center rounded-md text-lg text-gray-700 hover:bg-gray-100"
          >
            <span aria-hidden>☰</span>
          </button>
        </Tooltip>
        <Link href="/projects" className="flex items-center gap-2">
          <StampMark size={24} />
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
          <Tooltip content="Expand sidebar" placement="right">
            <button onClick={toggleCollapse} aria-label="Expand sidebar" className="mb-4 grid h-8 w-8 place-items-center rounded-md hover:bg-gray-100">
              <StampMark size={24} />
            </button>
          </Tooltip>
          <Tooltip content={t.nav.newProject} placement="right">
            <Link href="/projects/new" aria-label={t.nav.newProject} className="mb-2 grid h-8 w-8 place-items-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300">＋</Link>
          </Tooltip>
          <Tooltip content={t.nav.allProjects} placement="right">
            <Link href="/projects" aria-label={t.nav.allProjects} className="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-50">▦</Link>
          </Tooltip>
          <Tooltip content={t.account.openLabel} placement="right">
            <Link href="/account" aria-label={t.account.openLabel} className="mt-auto grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white hover:bg-brand-700">{initial}</Link>
          </Tooltip>
        </aside>
        <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
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
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
