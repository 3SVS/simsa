/**
 * write-consent.mjs — 오픈 베타 S2-min: 읽기 전용으로 돈 런인가(시험 데이터 동의가 없어 입력·제출을 못 한 기준이 있다).
 * 그 런의 결과 화면은 "시험 데이터 허용하고 다시 확인" 한 번 누르기를 보여 준다.
 */
export function reportNeedsWriteConsent(report) {
  if (!report || typeof report !== "object" || report.engine !== "agent" || !Array.isArray(report.acTable)) return false;
  return report.acTable.some((r) => r && r.status === "not_verified" && r.reasonCode === "write_not_allowed");
}

export const RECHECK_WITH_CONSENT = {
  ko: { lead: "시험 데이터를 만들어도 된다는 동의가 없어서, 입력·제출이 필요한 기준은 확인하지 못했어요.", button: "시험 데이터 허용하고 다시 확인" },
  en: { lead: "Without permission to create test data, criteria that need typing or submitting couldn't be checked.", button: "Allow test data and check again" },
};
