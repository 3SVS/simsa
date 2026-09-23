"use client";
// Train N — React glue for developer-mode.mjs. Reads localStorage once on
// mount (SSR-safe: default OFF), and re-reads on the custom change event and
// on cross-tab `storage` events so the sidebar and settings stay in sync.
import { useCallback, useEffect, useState } from "react";
import {
  DEVELOPER_MODE_EVENT,
  DEVELOPER_MODE_KEY,
  readDeveloperMode,
  writeDeveloperMode,
} from "./developer-mode.mjs";

export function useDeveloperMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(readDeveloperMode(window.localStorage));
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === DEVELOPER_MODE_KEY) sync();
    };
    window.addEventListener(DEVELOPER_MODE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEVELOPER_MODE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    writeDeveloperMode(window.localStorage, next);
    setOn(next);
    window.dispatchEvent(new Event(DEVELOPER_MODE_EVENT));
  }, []);

  return [on, set];
}
