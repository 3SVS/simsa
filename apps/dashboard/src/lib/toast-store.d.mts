export type ToastVariant = "success" | "error";

export type Toast = {
  id: string;
  variant: ToastVariant;
  message: string;
  actionLabel?: string;
  duration: number;
};

export type ToastInput = {
  id?: string;
  variant?: ToastVariant;
  message: string;
  actionLabel?: string;
  duration?: number;
};

export type ToastState = { toasts: Toast[] };

export type ToastAction =
  | { type: "push"; toast: ToastInput }
  | { type: "dismiss"; id: string }
  | { type: "clear" };

export const MAX_TOASTS: number;
export function initialToastState(): ToastState;
export function toastReducer(state: ToastState, action: ToastAction): ToastState;
export function normalizeToast(raw: ToastInput | null | undefined): Toast | null;
export function makeToastId(): string;
