/**
 * entitlements.ts — D-24 플랜 티어 단일 표 (docs/simsa-plan-tiers-design-2026-10-03.md).
 *
 * D-24.1 [LOCKED]: 플랜별 차등(기능·횟수)은 **이 표에서만** 나온다. 라우트에
 * `plan === "paid"` 같은 분기를 새로 쓰지 않고 `entitlementsFor(tier)`를 읽는다.
 * 자격 조회 실패는 무료로 fail-safe(막지도, 올려주지도 않는다 — RC-4와 같은 원칙).
 *
 * D-24.4 [PILOT]: 수치는 실측 전 조정 가능. 이 파일에는 **배선된 항목만** 둔다(배선 없는
 * 수치는 표와 실제가 어긋나는 거짓 문서가 된다). T-1~T-3: 새 프로젝트·협의체. T-4: 검수(일)·
 * 수리(월)·지시서(일). T-5: 로그인 뒤 검수(L2). '일일 감시'는 코드에 기능이 없어 표에 없다.
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
  /**
   * D-24.4(2026-10-04 배선): 문 (a) 빌드 시작 — 사용자(익명 키) 하루 상한. 빌드는 잡당 최대 $10(D-7)이라 무료 1.
   * 네트워크·서비스 상한(build-daily-caps.ts)은 원가 천장으로 그대로 함께 적용된다.
   */
  buildsPerDay: number;
  /** D-24.4: 협의체 검수(3벤더). RC-4의 `paid` 전용 기능을 프로로 옮긴 것. */
  councilReview: boolean;
  /**
   * T-4: 검수(화면 확인 컨테이너) 사용자 하루 상한. Train W의 네트워크·서비스 상한(비용 천장)은
   * 그대로 함께 적용된다. env BETA_INSPECTION_DAILY_LIMIT이 설정되면 모든 티어의 **천장**(더 낮은 쪽).
   */
  inspectionsPerDay: number;
  /**
   * T-4: 수리(자동 고침) 사용자 **월** 상한(UTC 달). Train W의 하루 상한(사용자·네트워크·서비스)도
   * 그대로 함께 적용된다 — 월 몫이 남아도 하루 상한에 먼저 닿을 수 있다.
   */
  repairsPerMonth: number;
  /** T-4: 개발 지시서 생성 사용자 하루 상한. 서비스·네트워크 생성 용량(#576)은 그대로. */
  devSpecsPerDay: number;
  /** T-5: 로그인 뒤 검수(일회용 계정으로 가입 후 확인, L2). 무료는 L1(공개 화면)만. */
  loginBehindInspection: boolean;
};

export const ENTITLEMENTS: Readonly<Record<Tier, Entitlements>> = {
  free: {
    buildsPerDay: 1,
    projectCreatesPerDay: 1,
    // 익명은 네트워크로만 센다(키를 새로 받으면 초기화되므로).
    projectCreatesPerDayPerNetworkAnonymous: 1,
    // 공용 와이파이·사무실을 위해 로그인 사용자의 네트워크 몫은 계정 몫보다 크다.
    projectCreatesPerDayPerNetworkAccount: 3,
    councilReview: false,
    inspectionsPerDay: 3,
    repairsPerMonth: 3,
    devSpecsPerDay: 2,
    loginBehindInspection: false,
  },
  basic: {
    buildsPerDay: 3,
    projectCreatesPerDay: 1,
    projectCreatesPerDayPerNetworkAnonymous: 1,
    projectCreatesPerDayPerNetworkAccount: 3,
    councilReview: false,
    inspectionsPerDay: 10,
    repairsPerMonth: 10,
    devSpecsPerDay: 5,
    loginBehindInspection: true,
  },
  pro: {
    buildsPerDay: 10,
    projectCreatesPerDay: 10,
    projectCreatesPerDayPerNetworkAnonymous: null,
    projectCreatesPerDayPerNetworkAccount: null,
    councilReview: true,
    inspectionsPerDay: 50,
    repairsPerMonth: 30,
    devSpecsPerDay: 20,
    loginBehindInspection: true,
  },
  staff: {
    buildsPerDay: 50,
    projectCreatesPerDay: 200,
    projectCreatesPerDayPerNetworkAnonymous: null,
    projectCreatesPerDayPerNetworkAccount: null,
    councilReview: true,
    inspectionsPerDay: 200,
    repairsPerMonth: 200,
    devSpecsPerDay: 200,
    loginBehindInspection: true,
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
