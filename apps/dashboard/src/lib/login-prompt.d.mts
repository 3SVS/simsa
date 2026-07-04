export const LOGIN_PROMPT_DISMISS_KEY: string;

export function shouldPromptLogin(input: {
  signedIn: boolean | null;
  hasResult: boolean;
  dismissed: boolean;
}): boolean;

export function isLoginPromptDismissed(storage?: { getItem(k: string): string | null } | null): boolean;
export function dismissLoginPrompt(storage?: { setItem(k: string, v: string): void } | null): void;
