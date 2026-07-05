/**
 * Toast store reducer (pure, deterministic).
 *
 * The shared <Toast/> system keeps its queue in a reducer so the add/dismiss
 * logic is testable without React. A toast has an id, variant ("success" |
 * "error"), a message, and an optional action (e.g. Undo — the action's
 * callback lives in the React layer, only its label is stored here).
 */

export const MAX_TOASTS = 4;

/** Initial reducer state. */
export function initialToastState() {
  return { toasts: [] };
}

/**
 * Reducer. Actions:
 *  - { type: "push", toast }   append a toast (auto-trims to MAX_TOASTS, FIFO)
 *  - { type: "dismiss", id }   remove one toast by id
 *  - { type: "clear" }         remove all
 */
export function toastReducer(state, action) {
  switch (action?.type) {
    case "push": {
      const toast = normalizeToast(action.toast);
      if (!toast) return state;
      const next = [...state.toasts, toast];
      // Keep the newest MAX_TOASTS; drop oldest first.
      const trimmed = next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      return { toasts: trimmed };
    }
    case "dismiss":
      return { toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "clear":
      return { toasts: [] };
    default:
      return state;
  }
}

/** Coerce/validate a toast payload; returns null when unusable. */
export function normalizeToast(raw) {
  if (!raw || typeof raw !== "object") return null;
  const message = typeof raw.message === "string" ? raw.message : "";
  if (!message) return null;
  const variant = raw.variant === "error" ? "error" : "success";
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : makeToastId(),
    variant,
    message,
    actionLabel: typeof raw.actionLabel === "string" ? raw.actionLabel : undefined,
    duration: Number.isFinite(raw.duration) ? Number(raw.duration) : 3000,
  };
}

let __seq = 0;
/** Monotonic id (no crypto dependency; fine for ephemeral UI toasts). */
export function makeToastId() {
  __seq += 1;
  return `toast_${Date.now().toString(36)}_${__seq}`;
}
