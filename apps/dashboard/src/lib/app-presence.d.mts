// Types for app-presence.mjs (#559 검증 결함 5).

export const APP_PRESENCE_EVENT: "simsa:app-presence";

export function publishAppPresence(
  projectId: string,
  hasApp: boolean | null | undefined,
  target?: { dispatchEvent?: (e: Event) => unknown } | null,
): void;

export function readAppPresence(projectId: string | null | undefined): boolean | null;
