"use client";

/**
 * Shared "project not in this browser" state.
 *
 * Projects live in localStorage, so a shared URL / fresh browser / cleared
 * storage resolves to null on every /projects/[id]/* route. The old guard
 * rendered a bare three-word "찾을 수 없습니다." with no why and no next
 * action (UX audit P1, systemic across 11 routes). This card explains the
 * why in user language and always offers a way forward.
 */
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";

export function ProjectNotFound() {
  const { t } = useI18n();
  return (
    <div className="empty-state max-w-xl">
      <p className="text-base font-semibold text-gray-800">{t.nf.title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">{t.nf.body}</p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href="/projects" className="btn btn-md btn-primary">
          {t.nf.allProjects}
        </Link>
        <Link href="/projects/new" className="btn btn-md btn-secondary">
          {t.nf.newProject}
        </Link>
      </div>
    </div>
  );
}
