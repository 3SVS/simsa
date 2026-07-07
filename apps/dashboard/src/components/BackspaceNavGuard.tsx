"use client";

// Backspace pressed OUTSIDE a text field navigates the browser back in some
// setups (older engines, certain keyboards/extensions), silently discarding
// everything typed on the current screen — e.g. a half-written idea in the new
// project wizard (Bae's report: "백스페이스 누르면 입력된 게 다 사라진 채로 처음으로").
// Backspace has no legitimate action outside an editable element, so we block it
// there and let it delete characters normally inside inputs. App-wide, mounted
// once in the root layout.

import { useEffect } from "react";

export function BackspaceNavGuard() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Backspace") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el?.isContentEditable ?? false);
      if (!editable) e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
