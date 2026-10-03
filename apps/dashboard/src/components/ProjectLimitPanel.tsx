"use client";

/**
 * D-24.3 — 새 프로젝트 하루 상한에 닿았을 때의 화면. 막다른 길이 아니라 세 갈래를 준다:
 * ① 기존 프로젝트로 계속 ② 다시 만들 수 있는 시각 ③ 플랜 안내(같은 네트워크 때문에 막힌
 * 익명 사용자에게는 로그인 — 로그인하면 내 몫이 따로 생긴다).
 */
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { projectLimitText, type ProjectLimitInfo } from "@/lib/project-quota.mjs";

export function ProjectLimitPanel({ info }: { info: ProjectLimitInfo }) {
  const { t } = useI18n();
  const text = projectLimitText(info, t.quota, t.visualChecks.resetWhen);
  return (
    <section role="status" className="card p-6" data-testid="project-limit-panel">
      <h2 className="text-base font-semibold text-gray-900">{text.title}</h2>
      <p className="mt-2 text-sm text-gray-600">{text.body}</p>
      <p className="mt-1 text-sm text-gray-600">{text.reset}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/projects" className="btn btn-md btn-primary">
          {t.quota.continueExisting}
        </Link>
        {text.showSignIn ? (
          <Link href="/login" className="btn btn-md btn-secondary">
            {t.quota.signIn}
          </Link>
        ) : null}
        <Link href="/pricing" className="btn btn-md btn-secondary">
          {t.quota.seePlans}
        </Link>
      </div>
    </section>
  );
}
