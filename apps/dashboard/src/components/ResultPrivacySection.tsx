"use client";

// Train K — 계약 5 (동의 계획 §4): 완료된 확인 결과 화면 맨 아래, '이번 결과, 어떠셨어요?' 다음.
//
//  ⓑ 학습 데이터 카드(TrainingConsentCard) — 서버가 "아직 정하지 않음"이라고 말하고, 이 브라우저에서
//     결정 없이 카드를 본 결과가 상한 미만일 때만(첫 완료 결과 + 다음 완료 결과 1회).
//  ⓐ 운영 정보 한 줄 — 회색 1줄 고지 + 끄기/켜기 + 자세히. 설정 화면 토글과 같은 API.
//
// 서버를 모르면(옛 서버·네트워크 — fetchPrivacyPrefs가 null) 둘 다 그리지 않는다: 틀릴 수 있는 사실
// 문장("기록됩니다"/"기록하지 않고 있어요")을 추측으로 쓰지 않고, 삭제를 약속하는 카드도 띄우지 않는다.
// 모두 인라인 — 모달·오버레이·팝업 없음.

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPrivacyPrefs, savePrivacyPrefs } from "@/lib/workspace-privacy-prefs-api";
import {
  TRAINING_CARD_STORAGE_KEY,
  opsInfoLineCopy,
  opsInfoLineVariant,
  parseSeenRuns,
  rememberTrainingCardSeen,
  trainingCardVisible,
  type OpsMeta,
  type PrivacyPrefs,
} from "@/lib/privacy-prefs.mjs";
import { TrainingConsentCard } from "@/components/TrainingConsentCard";
import type { Dictionary } from "@/i18n/dictionary.mjs";

// localStorage가 막힌 브라우저(시크릿 창·사이트 데이터 차단)에서는 이 탭 동안만 기억한다 —
// 저장소가 막혔다고 "한 번만 더"가 "결과마다"로 바뀌지 않게.
let memorySeenRuns: string[] = [];

function readSeenRuns(): string[] {
  try {
    const stored = parseSeenRuns(window.localStorage.getItem(TRAINING_CARD_STORAGE_KEY));
    return stored.length >= memorySeenRuns.length ? stored : memorySeenRuns;
  } catch {
    return memorySeenRuns;
  }
}

function writeSeenRuns(next: string[]) {
  memorySeenRuns = next;
  try {
    window.localStorage.setItem(TRAINING_CARD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 저장소 없음 — 이 탭 기억만 쓴다 */
  }
}

export function ResultPrivacySection({
  runId,
  resultDone,
  userKey,
  t,
}: {
  runId: string;
  resultDone: boolean;
  userKey: string;
  t: Dictionary;
}) {
  const [prefs, setPrefs] = useState<PrivacyPrefs | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [opsPhase, setOpsPhase] = useState<"idle" | "saving" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setShowCard(false);
    setOpsPhase("idle");
    if (!resultDone || !userKey) return;
    void (async () => {
      const loaded = await fetchPrivacyPrefs(userKey);
      if (cancelled) return;
      setPrefs(loaded);
      const seen = readSeenRuns();
      if (trainingCardVisible({ resultDone, trainingState: loaded?.training.state ?? null, seenRuns: seen, runId })) {
        writeSeenRuns(rememberTrainingCardSeen(seen, runId));
        setShowCard(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, resultDone, userKey]);

  async function setOpsMeta(next: OpsMeta) {
    if (opsPhase === "saving") return;
    setOpsPhase("saving");
    const saved = await savePrivacyPrefs(userKey, next);
    if (saved && saved.opsMeta === next) {
      setPrefs(saved);
      setOpsPhase("idle");
    } else {
      setOpsPhase("error");
    }
  }

  const p = t.privacyPrefs;
  const line = opsInfoLineCopy(opsInfoLineVariant(prefs), p);

  return (
    <>
      {showCard && (
        <TrainingConsentCard
          userKey={userKey}
          t={t}
          onDecided={(state) =>
            setPrefs((prev) => (prev ? { ...prev, training: { ...prev.training, state } } : prev))
          }
        />
      )}
      {line && (
        <p className="text-xs leading-relaxed text-gray-500">
          {line.text}
          {" · "}
          <button
            type="button"
            onClick={() => void setOpsMeta(line.next)}
            disabled={opsPhase === "saving"}
            className="underline hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {line.action}
          </button>
          {" · "}
          <Link href="/legal/privacy#ops-info" className="underline hover:text-gray-700">
            {p.learnMore}
          </Link>
          {opsPhase === "error" && <span className="ml-2 text-red-600">{p.saveError}</span>}
        </p>
      )}
    </>
  );
}
