"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  initialToastState,
  toastReducer,
  makeToastId,
} from "@/lib/toast-store.mjs";
import type { ToastInput } from "@/lib/toast-store.mjs";
import { useI18n } from "@/i18n/I18nProvider";

type ToastContextValue = {
  /** Push a toast. Returns its id (so an Undo handler can reference it). */
  push: (t: ToastInput & { onAction?: () => void }) => string;
  success: (message: string, opts?: Partial<ToastInput> & { onAction?: () => void }) => string;
  error: (message: string, opts?: Partial<ToastInput> & { onAction?: () => void }) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Bottom-right toast system. One shared queue (reducer-backed), success + error
 * variants, ~3s auto-dismiss, optional single action (e.g. Undo). Action results
 * that were previously invisible (save/send/copy/connect success, and
 * server-sync-failed-saved-on-device) surface here. Inline callouts stay for
 * form validation only.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(toastReducer, undefined, initialToastState);
  // Keep the action callbacks out of reducer state (not serialisable).
  const actions = useRef<Map<string, () => void>>(new Map());

  const dismiss = useCallback((id: string) => {
    actions.current.delete(id);
    dispatch({ type: "dismiss", id });
  }, []);

  const push = useCallback<ToastContextValue["push"]>((input) => {
    const id = input.id ?? makeToastId();
    if (input.onAction) actions.current.set(id, input.onAction);
    dispatch({ type: "push", toast: { ...input, id } });
    return id;
  }, []);

  const success = useCallback<ToastContextValue["success"]>(
    (message, opts) => push({ ...opts, message, variant: "success" }),
    [push]
  );
  const error = useCallback<ToastContextValue["error"]>(
    (message, opts) => push({ ...opts, message, variant: "error" }),
    [push]
  );

  return (
    <ToastContext.Provider value={{ push, success, error, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {state.toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            dismissLabel={t.interaction.dismiss}
            onDismiss={() => dismiss(toast.id)}
            onAction={() => {
              const fn = actions.current.get(toast.id);
              if (fn) fn();
              dismiss(toast.id);
            }}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  dismissLabel,
  onDismiss,
  onAction,
}: {
  toast: { id: string; variant: "success" | "error"; message: string; actionLabel?: string; duration: number };
  dismissLabel: string;
  onDismiss: () => void;
  onAction: () => void;
}) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
    // onDismiss identity is stable per toast id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.duration]);

  const tone =
    toast.variant === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-green-200 bg-green-50 text-green-800";
  const dotTone = toast.variant === "error" ? "bg-red-500" : "bg-green-500";

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-[0_4px_12px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.06)] ${tone}`}
      role={toast.variant === "error" ? "alert" : "status"}
    >
      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dotTone}`} aria-hidden />
      <span className="min-w-0 flex-1 leading-relaxed">{toast.message}</span>
      {toast.actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="flex-shrink-0 font-medium underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100"
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="-mr-1 flex-shrink-0 rounded px-1 text-xs opacity-50 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

/** Access the toast API. Safe no-op outside a provider (keeps leaves resilient). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  const noop = () => "";
  return { push: noop, success: noop, error: noop, dismiss: () => {} };
}
