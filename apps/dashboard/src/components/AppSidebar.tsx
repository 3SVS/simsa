"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getLocalProject } from "@/lib/workflow-store";
import { getProject } from "@/lib/mock-data";

/** Parse a project id out of /projects/<id>/... (excluding the "new" route). */
function useProjectId(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "projects" && seg[1] && seg[1] !== "new") return seg[1];
  return null;
}

export function AppSidebar() {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const projectId = useProjectId(pathname);
  const project = projectId ? getLocalProject(projectId) ?? getProject(projectId) : null;
  const base = projectId ? `/projects/${projectId}` : "";

  const itemClass = (active: boolean) =>
    `flex items-center rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      active ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
    }`;

  const groups: { label: string; items: { slug: string; label: string }[] }[] = [
    {
      label: t.nav.groupPlan,
      items: [
        { slug: "", label: t.nav.overview },
        { slug: "idea", label: t.nav.idea },
        { slug: "spec", label: t.nav.spec },
        { slug: "items", label: t.nav.items },
      ],
    },
    {
      label: t.nav.groupReview,
      items: [
        { slug: "github", label: t.nav.github },
        { slug: "checks", label: t.nav.checks },
      ],
    },
    {
      label: t.nav.groupDeliver,
      items: [
        { slug: "fixes", label: t.nav.fixes },
        { slug: "export", label: t.nav.export },
      ],
    },
  ];

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* Brand */}
      <div className="px-3 pb-2 pt-4">
        <Link href="/projects" className="group flex items-center gap-2.5 px-1.5">
          <span
            aria-hidden
            className="h-3 w-3 rounded-full border-[1.5px] border-gold-500 transition-colors group-hover:bg-gold-500"
          />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">
            {t.brand.wordmark}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-gray-400">
            beta
          </span>
        </Link>
      </div>

      {/* New project */}
      <div className="px-3 py-2">
        <Link
          href="/projects/new"
          className="flex items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <span className="text-gray-400">＋</span>
          {t.nav.newProject}
        </Link>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {project ? (
          <>
            <p className="truncate px-1.5 pb-2 pt-1 text-xs font-medium text-gray-400">
              {project.name ?? t.common.project}
            </p>
            {groups.map((g) => (
              <div key={g.label} className="mb-4">
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300">
                  {g.label}
                </p>
                <ul className="space-y-0.5">
                  {g.items.map((it) => {
                    const href = it.slug ? `${base}/${it.slug}` : base;
                    return (
                      <li key={it.slug || "overview"}>
                        <Link href={href} className={itemClass(pathname === href)}>
                          {it.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div className="mt-2 border-t border-gray-100 pt-2">
              <Link href={`${base}/settings`} className={itemClass(pathname === `${base}/settings`)}>
                {t.nav.settings}
              </Link>
            </div>
          </>
        ) : (
          <ul className="space-y-0.5">
            <li>
              <Link href="/projects" className={itemClass(pathname === "/projects")}>
                {t.nav.backToProjects}
              </Link>
            </li>
          </ul>
        )}
      </nav>

      {/* Footer: language */}
      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-3">
        <span className="px-1.5 text-[11px] text-gray-400">{t.lang.label}</span>
        <LanguageToggle />
      </div>
    </aside>
  );
}
