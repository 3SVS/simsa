/**
 * entitlements.ts — D-24 플랜 티어 단일 표 (docs/simsa-plan-tiers-design-2026-10-03.md).
 *
 * D-24.1 [LOCKED]: 플랜별 차등(기능·횟수)은 **이 표에서만** 나온다. 라우트에
 * `plan === "paid"` 같은 분기를 새로 쓰지 않고 `entitlementsFor(tier)`를 읽는다.
 * 자격 조회 실패는 무료로 fail-safe(막지도, 올려주지도 않는다 — RC-4와 같은 원칙).
 *
 * D-24.4 [PILOT]: 수치는 실측 전 조정 가능. 이 파일에는 **배선된 항목만** 둔다 —
 * 아직 집행하지 않는 수치(검수·수리·지시서 티어 상한)는 Train T-4에서 배선과 함께
 * 들어온다(배선 없는 수치는 표와 실제가 어긋나는 거짓 문서가 된다).
 *
 * `staff`는 고객 티어가 아니다: 감시·검증 장비(스모크·여정 감사·프로브)가 매 실행
 * 새 프로젝트를 만들므로, plan_grants로 지정한 장비 키만 생성 상한을 넘을 수 있다.
 * 서버·네트워크 비용 천장(Train W)은 그대로 적용된다.
 */

export type Tier = "free" | "basic" | "pro" | "staff";

export const TIERS: readonly Tier[] = ["free", "basic", "pro", "staff"] as const;

export type Entitlements = {
  /** D-24.2: 새 프로젝트 생성 — 계정(또는 익명 키) 기준 하루 상한. */
  projectCreatesPerDay: number;
  /**
   * D-24.2: 같은 네트워크에서 하루 상한. null = 네트워크 상한 없음(결제로 신원이
   * 확인된 프로, 장비). 익명과 로그인은 버킷이 다르다(아래 두 값).
   */
  projectCreatesPerDayPerNetworkAnonymous: number | null;
  projectCreatesPerDayPerNetworkAccount: number | null;
  /** D-24.4: 협의체 검수(3벤더). RC-4의 `paid` 전용 기능을 프로로 옮긴 것. */
  councilReview: boolean;
};

export const ENTITLEMENTS: Readonly<Record<Tier, Entitlements>> = {
  free: {
    projectCreatesPerDay: 1,
    // 익명은 네트워크로만 센다(키를 새로 받으면 초기화되므로).
    projectCreatesPerDayPerNetworkAnonymous: 1,
    // 공용 와이파이·사무실을 위해 로그인 사용자의 네트워크 몫은 계정 몫보다 크다.
    projectCreatesPerDayPerNetworkAccount: 3,
    councilReview: false,
  },
  basic: {
    projectCreatesPerDay: 1,
    projectCreatesPerDayPerNetworkAnonymous: 1,
    projectCreatesPerDayPerNetworkAccount: 3,
    councilReview: false,
  },
  pro: {
    projectCreatesPerDay: 10,
    projectCreatesPerDayPerNetworkAnonymous: null,
    projectCreatesPerDayPerNetworkAccount: null,
    councilReview: true,
  },
  staff: {
    projectCreatesPerDay: 200,
    projectCreatesPerDayPerNetworkAnonymous: null,
    projectCreatesPerDayPerNetworkAccount: null,
    councilReview: true,
  },
};

export function entitlementsFor(tier: Tier): Entitlements {
  return ENTITLEMENTS[tier];
}

/** plan_grants.plan 값 → 티어. 레거시 `paid`(RC-4)는 프로로 읽는다. 모르는 값 = 무료. */
export function tierFromGrantPlan(plan: string | null | undefined): Tier {
  switch (plan) {
    case "basic":
      return "basic";
    case "pro":
    case "paid":
      return "pro";
    case "staff":
      return "staff";
    default:
      return "free";
  }
}

/** POST /admin/plan-grants가 받는 값. `paid`는 하위 호환으로만 받는다. */
export function isGrantablePlan(v: unknown): v is "basic" | "pro" | "staff" | "paid" {
  return v === "basic" || v === "pro" || v === "staff" || v === "paid";
}
