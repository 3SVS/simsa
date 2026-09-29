"use client";
// React glue for app-presence.mjs (#559 검증 결함 5): the answer the sidebar
// settled for "does this project's app already exist?" — null until it has.
// Same pattern as use-developer-mode.ts (read on mount, re-read on the event).
import { useEffect, useState } from "react";
import { APP_PRESENCE_EVENT, readAppAddress, readAppPresence } from "./app-presence.mjs";

export function useAppPresence(projectId: string | null): boolean | null {
  const [presence, setPresence] = useState<boolean | null>(null);
  useEffect(() => {
    const sync = () => setPresence(readAppPresence(projectId));
    sync();
    window.addEventListener(APP_PRESENCE_EVENT, sync);
    return () => window.removeEventListener(APP_PRESENCE_EVENT, sync);
  }, [projectId]);
  return presence;
}

// #559 여정 렌즈 결함 4: whether the app's address is connected, as the sidebar
// settled it — null until it has.
export function useAppAddress(projectId: string | null): boolean | null {
  const [hasDeployUrl, setHasDeployUrl] = useState<boolean | null>(null);
  useEffect(() => {
    const sync = () => setHasDeployUrl(readAppAddress(projectId));
    sync();
    window.addEventListener(APP_PRESENCE_EVENT, sync);
    return () => window.removeEventListener(APP_PRESENCE_EVENT, sync);
  }, [projectId]);
  return hasDeployUrl;
}
