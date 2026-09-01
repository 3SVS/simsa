"use client";

/**
 * StepNextButton — 모든 프로젝트 화면 하단의 **다음 한 걸음** 안내 (2026-09-01 개편).
 *
 * ## 왜 고쳤나
 *
 * Bae: *"유저들이 쉽게 따라오고 확인할 수 있도록 심플해야 하고 구성의 연결이
 * 이어지도록 유도하는 기능이 필요해. 플로우를 아무리 강조해도 부족해."*
 *
 * 실측(2026-09-01): 프로젝트 하위 화면 **15개 중 이 버튼이 붙은 곳은 4개**
 * (idea·spec·items·settings)뿐이었다. 화면마다 손으로 `<StepNextButton />`을
 * 붙이는 구조여서, 나중에 만든 화면 — 하필 **검수·결과·고칠 것** 전부 — 이
 * 빠졌다. 즉 이번에 만든 순환의 어느 지점에도 다음 안내가 없었다: 검수를 돌린
 * 사용자는 사이드바로 돌아가 직접 찾아야 했다.
 *
 * 그래서 두 가지를 바꿨다.
 *
 * 1. **레이아웃에 한 번만 단다**(`projects/[id]/layout.tsx`). 화면을 새로 만들
 *    때 붙이는 걸 기억해야 하는 구조를 없앤다 — 기억에 의존하는 배선은 반드시
 *    빠진다(이번이 그 증거다).
 * 2. **결과를 보고 다음을 정한다**(`nextStepFromHere`). 고정 순서는 "문제가
 *    있었는가"를 구분하지 못해 순환을 닫을 수 없다.
 *
 * ## 왜 이유를 같이 쓰나
 *
 * "다음 →"만으로는 유도가 안 된다. **왜 그게 다음인지** 한 줄이 붙어야 따라온다.
 * 특히 `afterFix` — "고쳤으면 다시 돌려봐야 안다" — 는 이 제품의 핵심 주장이라
 * 화면에서 말해야 한다.
 *
 * ## 언제 아무것도 안 보이나
 *
 * 다음이 없으면 렌더하지 않는다. 할 일이 없는데 다음을 주는 것이 바로 사용자가
 * 지치는 "무한 행진"이다.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { nextStepFromHere } from "@/lib/project-steps.mjs";
import { loadExtendedProjectData } from "@/lib/workflow-store";

export function StepNextButton() {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] !== "projects" || !seg[1] || seg[1] === "new") return null;
  const projectId = seg[1];
  const slug = seg[2] ?? "";

  // 검수 결과 상세(`visual-checks/<runId>`)도 검수 화면으로 취급한다 — 결과를
  // 방금 본 사람에게 다음을 말해주는 자리가 정확히 여기다.
  const here = slug === "visual-checks" ? "visual-checks" : slug;

  const data = loadExtendedProjectData(projectId);
  const next = nextStepFromHere(here, {
    entryPath: data?.entryPath ?? null,
    summary: data?.checkResults?.summary ?? null,
    hasCheckRun: Boolean(data?.checkResults),
    hasFixes: Object.keys(data?.fixSuggestions ?? {}).length > 0,
    // 화면 검수 결과는 `checkResults`에 없다 — 어느 쪽을 볼지는 순수 함수가 고른다.
    visual: data?.visualCheck ? { findingCount: data.visualCheck.findingCount } : null,
  });
  if (!next) return null;

  const labels: Record<string, string> = {
    idea: t.nav.idea,
    spec: t.nav.spec,
    items: t.nav.items,
    settings: t.nav.settings,
    github: t.nav.github,
    export: t.nav.export,
    checks: t.nav.checks,
    fixes: t.nav.fixes,
    "visual-checks": t.nav.visualChecks,
  };
  const why: Record<string, string> = {
    seeProblems: t.stepsNav.whySeeProblems,
    afterFix: t.stepsNav.whyAfterFix,
    allClear: t.stepsNav.whyAllClear,
    continue: t.stepsNav.whyContinue,
  };

  // 고칠 것이 기다리거나 재검수가 필요한 순간에만 채운 버튼(primary)을 쓴다 —
  // 그때는 이게 화면에서 가장 중요한 행동이 맞다. 그 외에는 화면 자체의 주
  // 행동과 경쟁하지 않도록 물러선다(UIUX #5).
  const urgent = next.reason === "seeProblems" || next.reason === "afterFix";

  return (
    <div className="mt-10 border-t border-gray-100 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">{why[next.reason]}</p>
        <Link
          href={`/projects/${projectId}/${next.slug}`}
          className={`btn btn-md flex-shrink-0 ${urgent ? "btn-primary" : "btn-secondary"}`}
        >
          {t.stepsNav.next}: {labels[next.slug] ?? next.slug} →
        </Link>
      </div>
    </div>
  );
}
