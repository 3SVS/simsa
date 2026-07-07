// Stage 174 — Simsa review-stamp ("심사 도장") thinking/loading component.
//
// Motion metaphor: a reviewer pressing a review stamp after checking evidence — prepare,
// short satisfying press/impact, an "S" review imprint, a subtle ink spread that settles,
// and evidence checkpoints aligning around the mark. This is a review TRACE, NOT an
// "approved"/"certified"/"production-ready" stamp. Ink-red uses the existing Tailwind
// `brand` (oxblood) tokens — no new color system, no destructive/alert red. CSS/HTML only
// (no image asset, no animation library); motion lives in globals.css and is disabled
// under prefers-reduced-motion. Render config comes from the pure, tested
// lib/stamp-thinking.mjs. (Supersedes the Stage 160~166 wax-seal component.)
import { resolveStampThinking } from "@/lib/stamp-thinking.mjs";
import type { StampThinkingVariant } from "@/lib/stamp-thinking.d.mts";
import { StampMark } from "@/components/brand/StampMark";

export type SimsaStampThinkingVariant = StampThinkingVariant;

export interface SimsaStampThinkingProps {
  variant?: SimsaStampThinkingVariant;
  label?: string;
  stepLabels?: string[];
  className?: string;
  /** Optional reassurance shown under the label in the panel variant — e.g.
   *  "usually 20–30 seconds" so a non-dev doesn't think a slow generation died. */
  hint?: string;
}

export function SimsaStampThinking({ variant, label, stepLabels, className, hint }: SimsaStampThinkingProps) {
  const cfg = resolveStampThinking({ variant, label, stepLabels });
  const isPanel = cfg.variant === "panel";

  const stampPx = isPanel ? 40 : 20;
  const dotSize = isPanel ? "h-1.5 w-1.5" : "h-1 w-1";

  // Root is a <span> (not <div>) so the compact variant is valid phrasing content
  // inside a <button> (Stage 164), while Tailwind flex utilities still apply.
  return (
    <span
      role={cfg.a11y.role}
      aria-live={cfg.a11y.ariaLive}
      aria-busy={cfg.a11y.ariaBusy}
      className={[
        isPanel
          ? "flex flex-col items-center gap-3 rounded-lg border border-gray-100 bg-white/60 px-6 py-5 text-center"
          : "inline-flex items-center gap-2 align-middle",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      {/* Review stamp: the Simsa 심사 seal (the app's brand mark, shared with the
          sidebar/landing) pressed at a slight angle for a hand-stamped review
          trace — a review TRACE, not an "approved" mark. Replaces the earlier
          plain "S" glyph so the loading motion uses the same icon as the rest of
          the product. */}
      <span aria-hidden="true" className="relative inline-grid place-items-center">
        {/* Ink spread / settle — panel only (kept out of compact so it never overflows a
            button). Blooms on the press impact, then is absorbed. */}
        {isPanel && <span className="simsa-stamp-ink pointer-events-none absolute inset-0 rounded-full bg-brand-500" />}
        <span className="simsa-stamp-motion relative inline-grid place-items-center">
          <StampMark size={stampPx} className="rounded-md shadow-[0_1px_2px_rgba(43,8,13,0.28)]" />
        </span>
      </span>

      {/* Evidence checkpoints — checklist-style marks that align/pulse, not wax droplets. */}
      <span aria-hidden="true" className={isPanel ? "flex items-center gap-1.5" : "flex items-center gap-1"}>
        {cfg.dots.map((d) => (
          <span
            key={d.index}
            className={`simsa-evidence-mark ${dotSize} rounded-[2px] bg-brand-500`}
            style={{ animationDelay: `${d.delayMs}ms` }}
          />
        ))}
      </span>

      {/* Status label — visible for panel, screen-reader-only for compact */}
      <span className={isPanel ? "text-sm text-gray-600" : "sr-only"}>{cfg.label}</span>

      {/* Wait reassurance — panel only. Keeps a non-dev from bailing on a slow
          (20–30s) generation thinking it hung. */}
      {isPanel && hint && <span className="text-xs text-gray-400">{hint}</span>}
    </span>
  );
}

export default SimsaStampThinking;
