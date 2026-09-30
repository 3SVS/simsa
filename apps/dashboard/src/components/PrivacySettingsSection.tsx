"use client";

// Train K — 계약 5 (동의 계획 §4): 설정 화면의 두 토글.
//   ⓐ 운영 정보 기록 — GET/POST /workspace/privacy-prefs. 서버를 모르면(옛 서버·네트워크) 비활성 + 설명.
//   ⓑ 학습 데이터 제공 — POST /workspace/training-consent(옛 서버에도 있는 경로). 상태는 privacy-prefs의
//      training.state를 우선, 없으면 옛 경로의 active.
//      끄기 안내는 서버가 실제로 하는 일만: Train K 서버(privacy-prefs 있음)는 끄면 저장된 학습 사본을
//      지운다 → "지워요"(+ 삭제 기능 전 사본 예외). 옛 서버는 새 캡처만 멈춘다 → "보관하지 않아요".
// 두 토글은 같은 모양(체크박스 + 라벨)이고 어느 쪽도 강조하지 않는다.

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPrivacyPrefs, savePrivacyPrefs } from "@/lib/workspace-privacy-prefs-api";
import { fetchTrainingConsent, saveTrainingConsent } from "@/lib/workspace-training-consent-api";
import {
  privacySettingsState,
  trainingSaveOutcome,
  type LegacyTrainingConsent,
  type PrivacyPrefs,
} from "@/lib/privacy-prefs.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";

type SavePhase = "idle" | "saving" | "saved" | "error";

export function PrivacySettingsSection({ userKey, t }: { userKey: string; t: Dictionary }) {
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<PrivacyPrefs | null>(null);
  const [legacy, setLegacy] = useState<LegacyTrainingConsent | null>(null);
  const [opsPhase, setOpsPhase] = useState<SavePhase>("idle");
  const [trainPhase, setTrainPhase] = useState<SavePhase>("idle");

  useEffect(() => {
    let cancelled = false;
    if (!userKey) return;
    void (async () => {
      const [p, l] = await Promise.all([fetchPrivacyPrefs(userKey), fetchTrainingConsent(userKey)]);
      if (cancelled) return;
      setPrefs(p);
      setLegacy(l);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userKey]);

  const state = privacySettingsState({ prefs, legacy });

  async function toggleOps(next: boolean) {
    const want = next ? "on" : "off";
    setOpsPhase("saving");
    const saved = await savePrivacyPrefs(userKey, want);
    if (saved && saved.opsMeta === want) {
      setPrefs(saved);
      setOpsPhase("saved");
    } else {
      setOpsPhase("error");
    }
  }

  async function toggleTraining(next: boolean) {
    setTrainPhase("saving");
    const res = await saveTrainingConsent(userKey, next);
    const outcome = trainingSaveOutcome(next, res);
    if (outcome === "error") {
      setTrainPhase("error");
      return;
    }
    // POST does not echo storageConfigured — keep what GET said.
    setLegacy((prev) => ({ ok: true, active: res.active, storageConfigured: prev?.storageConfigured ?? false }));
    setPrefs((prev) => (prev ? { ...prev, training: { ...prev.training, state: outcome } } : prev));
    setTrainPhase("saved");
  }

  const p = t.privacyPrefs;
  const s = t.trainingConsent;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">{p.sectionTitle}</h2>
      <p className="mb-4 mt-1 text-sm text-gray-500">{p.sectionDesc}</p>

      <div className="space-y-4">
        {/* ⓐ 운영 정보(비식별) 기록 */}
        <div className="card space-y-3 p-5">
          <h3 className="section-title">{p.opsTitle}</h3>
          <p className="text-xs leading-relaxed text-gray-500">{p.opsDesc}</p>
          <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
            <input
              id="ops-meta"
              type="checkbox"
              checked={state.opsMeta.on}
              onChange={(e) => void toggleOps(e.target.checked)}
              disabled={!state.opsMeta.available || opsPhase === "saving"}
              className="h-4 w-4"
            />
            <label htmlFor="ops-meta" className="text-sm text-gray-700">
              {p.opsToggle}
            </label>
          </div>
          {loaded && !state.opsMeta.available && <p className="text-xs text-gray-500">{p.unavailable}</p>}
          {state.opsMeta.defaultOff && <p className="text-xs text-gray-500">{p.opsDefaultOffNote}</p>}
          {state.opsMeta.available && <p className="text-xs leading-relaxed text-gray-500">{p.opsKeepNote}</p>}
          {opsPhase === "saved" && (
            <p role="status" className="text-xs text-gray-600">
              {state.opsMeta.on ? p.opsSavedOn : p.opsSavedOff}
            </p>
          )}
          {opsPhase === "error" && <p className="text-xs text-red-600">{p.saveError}</p>}
          <Link href="/legal/privacy#ops-info" className="inline-block text-xs text-gray-500 underline hover:text-gray-700">
            {p.learnMore}
          </Link>
        </div>

        {/* ⓑ 학습 데이터 제공(동의만) */}
        <div className="card space-y-3 p-5">
          <h3 className="section-title">{s.title}</h3>
          <p className="text-xs leading-relaxed text-gray-500">{s.settingsDesc}</p>
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-gray-500">
            <li>{s.pointWhat}</li>
            <li>{s.pointHow}</li>
          </ul>
          <p className="text-xs text-gray-500">{s.equalNote}</p>
          <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
            <input
              id="train-consent"
              type="checkbox"
              checked={state.training.on}
              onChange={(e) => void toggleTraining(e.target.checked)}
              disabled={!state.training.available || trainPhase === "saving"}
              className="h-4 w-4"
            />
            <label htmlFor="train-consent" className="text-sm text-gray-700">
              {s.enable}
            </label>
          </div>
          <p className="text-[11px] text-gray-500">{s.ageNote}</p>
          {loaded && !state.training.available && <p className="text-xs text-gray-500">{s.unavailable}</p>}
          {state.training.available && state.training.on && (
            <p className="text-xs leading-relaxed text-gray-500">
              {state.training.offDeletes ? s.offNoteDeletes : s.offNoteStops}
            </p>
          )}
          {legacy?.ok && !legacy.storageConfigured && <p className="text-xs text-gray-500">{s.storageNote}</p>}
          {trainPhase === "saved" && (
            <p role="status" className="text-xs text-gray-600">
              {state.training.on ? s.savedOn : state.training.offDeletes ? s.savedOffDeletes : s.savedOffStops}
            </p>
          )}
          {trainPhase === "error" && <p className="text-xs text-red-600">{s.saveError}</p>}
          <Link href="/legal/privacy#training-data" className="inline-block text-xs text-gray-500 underline hover:text-gray-700">
            {s.learnMore}
          </Link>
        </div>
      </div>
    </div>
  );
}
