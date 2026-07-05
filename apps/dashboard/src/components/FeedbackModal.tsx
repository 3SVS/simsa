"use client";

/**
 * FeedbackModal — in-app feedback (replaces the broken mailto).
 * Type (bug/question/suggestion) + message + send. Context (route, projectId,
 * userKey) is attached automatically by the caller. No reply promise in the
 * thank-you (can't keep it → erodes trust).
 */
import { useState } from "react";
import { usePathname, useParams } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { getUserKey } from "@/lib/workflow-store";
import { sendFeedback, type FeedbackKind } from "@/lib/feedback-api";

export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const f = t.common.feedback;
  const pathname = usePathname() ?? "";
  const params = useParams();
  const projectId = typeof params?.id === "string" ? params.id : undefined;

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (!open) return null;

  async function submit() {
    if (!message.trim() || phase === "sending") return;
    setPhase("sending");
    const res = await sendFeedback({
      userKey: getUserKey(),
      kind,
      message: message.trim(),
      route: pathname,
      projectId,
    });
    setPhase(res.ok ? "done" : "error");
  }

  function close() {
    setPhase("idle");
    setMessage("");
    setKind("bug");
    onClose();
  }

  const kinds: Array<{ id: FeedbackKind; label: string }> = [
    { id: "bug", label: f.kindBug },
    { id: "question", label: f.kindQuestion },
    { id: "suggestion", label: f.kindSuggestion },
  ];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button aria-label={f.close} onClick={close} className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        {phase === "done" ? (
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900">{f.thanks}</p>
            <button onClick={close} className="btn btn-md btn-primary mt-4">
              {f.done}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-gray-900">{f.title}</h2>
                <p className="mt-0.5 text-xs text-gray-500">{f.subtitle}</p>
              </div>
              <button aria-label={f.close} onClick={close} className="text-gray-400 hover:text-gray-600">×</button>
            </div>

            <div className="mt-4 flex gap-2">
              {kinds.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    kind === k.id
                      ? "border-brand-300 bg-brand-50 text-brand-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder={f.placeholder}
              className="input mt-3"
            />

            <p className="mt-2 text-[11px] text-gray-400">{f.contextNote}</p>

            <div className="mt-4 flex items-center gap-3">
              <button onClick={submit} disabled={!message.trim() || phase === "sending"} className="btn btn-md btn-primary">
                {phase === "sending" ? f.sending : f.send}
              </button>
              <button onClick={close} className="btn btn-md btn-ghost">
                {t.common.cancel}
              </button>
              {phase === "error" && <span className="text-xs text-red-500">{f.error}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
