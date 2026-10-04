"use client";
// B-8 — is this tab visible? Polling screens stop while the tab is hidden and pick up again when
// it comes back (nextBuildPollDelayMs returns null for hidden). SSR-safe: starts as visible.
import { useEffect, useState } from "react";

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}
