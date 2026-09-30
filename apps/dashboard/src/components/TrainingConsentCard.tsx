"use client";

// Train K — K-2 (동의 계획 §4 ⓑ · 계약 5): 학습 데이터 동의 카드. 첫 완료된 확인 결과 화면의
// '이번 결과, 어떠셨어요?' 아래에 **인라인**으로만 뜬다(모달·오버레이·팝업 금지).
//
//  - 두 버튼은 **같은 클래스 하나**(CONSENT_CHOICE_CLASS) — 같은 크기·같은 모양·색 강조 없음.
//    순서는 [허용하지 않기] [허용하기]. 사전 선택 없음. 닫기(X) 없음 — 떠나면 미결정으로 남고,
//    다음 완료 결과에서 한 번만 다시 보인다(노출 조건은 lib/privacy-prefs.mjs trainingCardVisible).
//  - 거절도 진짜 답이다: Train K 서버는 거절을 현재 조항 버전과 함께 저장해 다시 묻지 않는다.
//  - 저장이 요청대로 되지 않았으면 "저장됨"이라고 말하지 않는다(trainingSaveOutcome).
//  - 카피는 사전 t.trainingConsent.* — 없는 기능을 약속하지 않는다(삭제 약속은 Train K 서버의
//    색인 기반 삭제가 있을 때만 이 카드가 뜬다: 카드는 privacy-prefs가 있는 서버에서만 보인다).

import { useState } from "react";
import Link from "next/link";
import { saveTrainingConsent } from "@/lib/workspace-training-consent-api";
import { trainingSaveOutcome } from "@/lib/privacy-prefs.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";

/** 두 선택 버튼이 함께 쓰는 단 하나의 클래스 — 같은 크기·같은 스타일, 색 강조 없음. */
const CONSENT_CHOICE_CLASS = "btn btn-sm btn-secondary min-w-[9rem] justify-center";

export function TrainingConsentCard({
  userKey,
  t,
  onDecided,
}: {
  userKey: string;
  t: Dictionary;
  onDecided?: (state: "consented" | "declined") => void;
}) {
  const s = t.trainingConsent;
  const [phase, setPhase] = useState<"ask" | "saving" | "consented" | "declined" | "error">("ask");

  async function choose(allow: boolean) {
    if (phase === "saving") return;
    setPhase("saving");
    const res = await saveTrainingConsent(userKey, allow);
    const outcome = trainingSaveOutcome(allow, res);
    setPhase(outcome);
    if (outcome !== "error") onDecided?.(outcome);
  }

  const decided = phase === "consented" || phase === "declined";

  return (
    <section aria-labelledby="training-consent-card-title" className="card p-5">
      <h3 id="training-consent-card-title" className="section-title">{s.title}</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-gray-600">
        <li>{s.pointWhat}</li>
        <li>{s.pointHow}</li>
        <li>{s.pointControl}</li>
      </ul>
      <p className="mt-3 text-xs text-gray-600">{s.equalNote}</p>
      {decided ? (
        <p role="status" className="mt-3 text-xs text-gray-600">
          {phase === "consented" ? s.savedAllowed : s.savedDeclined}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void choose(false)} disabled={phase === "saving"} className={CONSENT_CHOICE_CLASS}>
            {s.decline}
          </button>
          <button type="button" onClick={() => void choose(true)} disabled={phase === "saving"} className={CONSENT_CHOICE_CLASS}>
            {s.allow}
          </button>
        </div>
      )}
      {phase === "saving" && <p className="mt-2 text-xs text-gray-500">{s.saving}</p>}
      {phase === "error" && <p className="mt-2 text-xs text-red-600">{s.saveError}</p>}
      <p className="mt-3 text-[11px] text-gray-500">
        {s.ageNote}{" "}
        <Link href="/legal/privacy#training-data" className="underline hover:text-gray-700">
          {s.learnMore}
        </Link>
      </p>
    </section>
  );
}
