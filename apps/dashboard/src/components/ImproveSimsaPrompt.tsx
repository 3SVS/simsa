"use client";

// D ("Simsa 개선 참여" popup): surfaces the EXISTING training-data consent as a
// one-time, opt-in invitation instead of leaving it buried in Settings. Honest
// by design — off is the default, the two choices are symmetrical, dismissing is
// one click, and it never reappears once decided (server) or dismissed (browser).
//
// Shows ONLY when the user has never decided (server consentVersion === null)
// AND hasn't dismissed the invite in this browser. A previous "no" (version set)
// is respected — we never nag.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getUserKey } from "@/lib/workflow-store";
import { fetchTrainingConsent, saveTrainingConsent } from "@/lib/workspace-training-consent-api";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/components/Toast";

const DISMISS_KEY = "simsa:improve-prompt-dismissed";

export function ImproveSimsaPrompt() {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pathname = usePathname();
  // Flow-audit B-3 (2026-07-17) banned it from the creation wizard; the
  // journey-audit P2 (2026-07-20) showed it still floated over the project
  // overview and checks screens — exactly where a fresh user is orienting.
  // The invite now shows ONLY on the project list (nothing critical to
  // cover there); Settings keeps the permanent consent UI for everyone else.
  const onProjectList = pathname === "/projects";

  useEffect(() => {
    let cancelled = false;
    // Never re-invite once dismissed in this browser.
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* storage unavailable — fall through, the server check still gates it */
    }
    (async () => {
      const res = await fetchTrainingConsent(getUserKey());
      // Only invite when the user has never decided (version null). A prior
      // yes/no (version set) or a failed fetch → stay silent.
      if (!cancelled && res.ok && res.consentVersion === null && !res.active) {
        // Small delay so it doesn't jar on first paint.
        setTimeout(() => {
          if (!cancelled) setOpen(true);
        }, 1500);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  async function join() {
    setSaving(true);
    const res = await saveTrainingConsent(getUserKey(), true);
    setSaving(false);
    if (res.ok && res.active) {
      toast.success(t.trainingConsent.savedOn);
      dismiss();
    } else {
      toast.error(t.trainingConsent.saveError);
    }
  }

  if (!open || !onProjectList) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="card border border-gray-200 bg-white p-5 shadow-lg">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">{t.trainingConsent.title}</h2>
          <button
            onClick={dismiss}
            aria-label={t.common.dismiss}
            className="-mt-1 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-600">{t.trainingConsent.desc}</p>
        <ul className="mb-4 space-y-1 text-xs text-gray-500">
          <li>• {t.trainingConsent.point1}</li>
          <li>• {t.trainingConsent.point2}</li>
          <li>• {t.trainingConsent.point3}</li>
        </ul>
        <div className="flex items-center gap-2">
          <button onClick={join} disabled={saving} className="btn btn-sm btn-primary">
            {t.trainingConsent.joinCta}
          </button>
          <button onClick={dismiss} disabled={saving} className="btn btn-sm btn-ghost">
            {t.trainingConsent.laterCta}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-gray-400">
          <Link href="/settings" className="underline hover:text-gray-600">
            {t.trainingConsent.manageInSettings}
          </Link>
        </p>
      </div>
    </div>
  );
}
