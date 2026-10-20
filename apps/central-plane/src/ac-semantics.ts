/**
 * ac-semantics.ts — 수용 기준(AC) 문장의 선행 조건 읽기 (결정론·KO/EN). 단일 출처.
 *
 * 2026-10-21: v2 계획(v2-plan.ts, S3)과 v1 실행기의 given 셋업(PR #609, agent-inspection.ts)이 같은 판단을 쓴다. #609가 아직
 * 머지 전이라 v2가 그 함수를 복사해 두 벌을 만드는 대신 여기 하나로 먼저 둔다 — #609는 머지할 때 이 모듈을 가져다 쓴다(복사 금지).
 * 정규식·필드 뜻은 #609(`cf06a37` 기준)의 classifyPrecondition과 같다. 의존성 0(검사 컨테이너에서도 컴파일).
 */

/** v1 실행기의 핵심 결과 기준 id(agent-inspection.ts CORE_OUTCOME_AC_ID와 같은 값) — 셋업 대상이 아니다. */
const CORE_OUTCOME_AC_ID = "CORE-1";

export interface AcPrecondition {
  /** given이 "기록(예약 등)이 이미 있다"를 전제한다 — 실행기가 먼저 만들어야 한다. */
  needsRecord: boolean;
  /** 다른 손님·새 브라우저에서 본다. */
  otherSession: boolean;
  /** 관리 화면·사장님 화면에 들어간다. */
  adminScreen: boolean;
  /** 취소·삭제한다(내 기록만). */
  cancels: boolean;
  /** "오늘"의 기록이어야 한다 — 야간엔 당일 슬롯이 없을 수 있다. */
  needsToday: boolean;
  /** when이 새로고침·다시 열기 — 만든 쪽 브라우저에서 시작한다(새 브라우저 확인은 에이전트가 new_session으로). */
  sameSession: boolean;
}

const RE_NEEDS_RECORD = /예약(이|을|은)? ?(하나|1건|한 ?건|이미|있|마쳤|되어 ?있|해 ?둔)|1건 이상|기록이 ?있|이미 예약|a booking (has been |was |is )?(made|exists|placed)|there is (a|an|one) (booking|record|reservation)|an existing (booking|record)|one booking/i;
const RE_OTHER_SESSION = /새 브라우저|다른 (손님|방문자|사람|기기)|another (customer|visitor|person|device)|new browser|different (customer|visitor)/i;
const RE_ADMIN = /관리 화면|관리자|사장님|운영자|admin|owner('s)? (screen|page|view)|dashboard/i;
const RE_CANCELS = /취소|삭제|cancel|delete|remove/i;
const RE_TODAY = /오늘|today/i;
const RE_SAME_SESSION = /새로고침|다시 열|reload|refresh|reopen/i;

export function classifyPrecondition(ac: { id: string; given?: string; when?: string; then?: string }): AcPrecondition {
  const given = ac.given ?? "";
  const when = ac.when ?? "";
  const all = `${given} ${when} ${ac.then ?? ""}`;
  return {
    needsRecord: ac.id !== CORE_OUTCOME_AC_ID && RE_NEEDS_RECORD.test(given),
    otherSession: RE_OTHER_SESSION.test(when) || RE_OTHER_SESSION.test(given),
    adminScreen: RE_ADMIN.test(all),
    cancels: RE_CANCELS.test(when),
    needsToday: RE_TODAY.test(given) || RE_TODAY.test(ac.then ?? ""),
    sameSession: RE_SAME_SESSION.test(when),
  };
}
