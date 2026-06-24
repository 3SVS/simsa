// Stage 161 — Simsa wax-seal thinking/loading component (foundation).
//
// Brand burgundy wax-seal "S" pulse + sequential evidence dots + calm status text.
// CSS/HTML only (no image asset, no animation library); motion lives in globals.css
// and is disabled under prefers-reduced-motion. Render config comes from the pure,
// tested lib/seal-thinking.mjs. Not yet integrated into dashboard surfaces (Stage 163+).
import { resolveSealThinking } from "@/lib/seal-thinking.mjs";
import type { SealThinkingVariant } from "@/lib/seal-thinking.d.mts";

export type SimsaSealThinkingVariant = SealThinkingVariant;

export interface SimsaSealThinkingProps {
  variant?: SimsaSealThinkingVariant;
  label?: string;
  stepLabels?: string[];
  className?: string;
}

export function SimsaSealThinking({ variant, label, stepLabels, className }: SimsaSealThinkingProps) {
  const cfg = resolveSealThinking({ variant, label, stepLabels });
  const isPanel = cfg.variant === "panel";

  const sealSize = isPanel ? "h-10 w-10 text-base" : "h-5 w-5 text-[10px]";
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
      {/* Wax seal */}
      <span
        aria-hidden="true"
        className={`simsa-seal-motion relative grid ${sealSize} place-items-center rounded-full bg-brand-700 font-semibold text-brand-100 shadow-[inset_0_1px_2px_rgba(255,255,255,0.18),0_1px_2px_rgba(43,8,13,0.45)] ring-1 ring-inset ring-brand-500/40`}
      >
        {/* organic rim highlight sweep */}
        <span className="simsa-seal-rim pointer-events-none absolute inset-0 rounded-full" />
        <span className="relative leading-none tracking-tight">S</span>
      </span>

      {/* Evidence dots */}
      <span aria-hidden="true" className={isPanel ? "flex items-center gap-1.5" : "flex items-center gap-1"}>
        {cfg.dots.map((d) => (
          <span
            key={d.index}
            className={`simsa-evidence-dot ${dotSize} rounded-full bg-brand-400`}
            style={{ animationDelay: `${d.delayMs}ms` }}
          />
        ))}
      </span>

      {/* Status label — visible for panel, screen-reader-only for compact */}
      <span className={isPanel ? "text-sm text-gray-600" : "sr-only"}>{cfg.label}</span>
    </span>
  );
}

export default SimsaSealThinking;
