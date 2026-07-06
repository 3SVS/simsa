"use client";

/**
 * StepNextButton — the bottom-of-screen "다음 →" that walks the user along the
 * canonical flow (idea → spec → items → settings → github → checks → fixes) so
 * finishing one screen never means scanning the sidebar for what's next.
 * Renders nothing on screens without an obvious next (or outside a project).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { nextScreenSlug } from "@/lib/project-steps.mjs";

export function StepNextButton() {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] !== "projects" || !seg[1] || seg[1] === "new") return null;
  const slug = seg[2] ?? "";
  const next = nextScreenSlug(slug);
  if (!next) return null;

  const labels: Record<string, string> = {
    idea: t.nav.idea,
    spec: t.nav.spec,
    items: t.nav.items,
    settings: t.nav.settings,
    github: t.nav.github,
    checks: t.nav.checks,
    fixes: t.nav.fixes,
  };

  // Secondary weight on purpose: this is the flow "next" nav, not the screen's
  // hero action. Each step screen's own key action (connect repo, generate
  // items, run review, …) is the single filled primary; "다음 →" recedes so it
  // never competes with — or outshouts — that primary (UIUX #5).
  return (
    <div className="mt-10 flex justify-end border-t border-gray-100 pt-4">
      <Link
        href={`/projects/${seg[1]}/${next}`}
        className="btn btn-md btn-secondary"
      >
        {t.stepsNav.next}: {labels[next] ?? next} →
      </Link>
    </div>
  );
}
