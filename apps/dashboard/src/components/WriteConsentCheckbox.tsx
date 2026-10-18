"use client";

/**
 * WriteConsentCheckbox — 오픈 베타 S2-min(2026-10-05): 정밀 검사가 앱에 시험 데이터를 만들어도 되는지 묻는다.
 * 체크하지 않으면 서버가 **읽기 전용**으로 돈다(입력·제출 없음 — 그런 기준은 "확인 못 함"과 그 이유로 남는다).
 * 문장은 central-plane WRITE_CONSENT_COPY와 같아야 한다(테스트 고정).
 */
export const WRITE_CONSENT_TEXT = {
  ko: "이 앱은 제 것이고, 확인을 위해 시험 데이터(이름 '심사테스트')를 만들어도 괜찮아요",
  en: "This app is mine, and it's OK to create test data (name '심사테스트') to check it",
} as const;

const HINT = {
  ko: "체크하지 않으면 보기만 하고 입력·제출은 하지 않아요. 그러면 '예약이 실제로 되는지' 같은 기준은 확인하지 못해요.",
  en: "If unchecked we only look — no typing or submitting — so criteria like 'a booking actually goes through' can't be checked.",
} as const;

export function WriteConsentCheckbox({ checked, onChange, locale }: { checked: boolean; onChange: (v: boolean) => void; locale: "ko" | "en" }) {
  const L = locale === "en" ? "en" : "ko";
  return (
    <label className="mt-3 flex items-start gap-2 text-sm" data-testid="write-consent">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-gray-700">
        {WRITE_CONSENT_TEXT[L]}
        <span className="mt-0.5 block text-xs text-gray-500">{HINT[L]}</span>
      </span>
    </label>
  );
}
