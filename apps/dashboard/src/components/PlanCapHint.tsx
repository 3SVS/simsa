"use client";

/**
 * D-24.3 — 하루·한 달 상한이나 플랜 전용 기능에 막혔을 때 알림 아래에 붙는 한 줄:
 * "하루·한 달 횟수는 플랜에 따라 달라요. 플랜 보기" — 상한이 막다른 길이 되지 않게 한다.
 * 일시 중지(킬스위치)에는 붙이지 않는다 — 플랜으로 풀리는 일이 아니다(isPlanCapKey).
 */
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";

export function PlanCapHint() {
  const { t } = useI18n();
  return (
    <span className="mt-1 block text-xs" data-testid="plan-cap-hint">
      {t.quota.capPlanHint}{" "}
      <Link href="/pricing" className="font-medium underline underline-offset-2">
        {t.quota.seePlans}
      </Link>
    </span>
  );
}
