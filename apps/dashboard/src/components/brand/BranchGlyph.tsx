// BranchGlyph — line-glyph icons for the /projects/new entry cards, mirroring
// the landing's "start from anything" glyph set. Replaces the emoji (💡🔗📄)
// that rendered as tofu (□) in the Korean font — the no-emoji rule. Decorative,
// aria-hidden; the card's title carries the accessible meaning.

import type { ReactNode } from "react";

// C-N7: the three first doors add "broken" (door b) and "differs" (door c).
type BranchKey = "idea" | "code" | "spec" | "broken" | "differs";

const PATHS: Record<BranchKey, ReactNode> = {
  // idea — bulb
  idea: (
    <>
      <path d="M8 1.8a4.3 4.3 0 0 1 2.5 7.8c-.4.3-.6.5-.6.8v.6H6.1v-.6c0-.3-.2-.5-.6-.8A4.3 4.3 0 0 1 8 1.8Z" />
      <path d="M6.6 13.2h2.8" />
    </>
  ),
  // code — repo branch
  code: (
    <>
      <circle cx="4.2" cy="3.8" r="1.5" />
      <circle cx="4.2" cy="12.2" r="1.5" />
      <circle cx="11.8" cy="5.8" r="1.5" />
      <path d="M4.2 5.3v5.4M11.8 7.3c0 2.4-2.6 2.6-5.4 3.6" />
    </>
  ),
  // spec — document
  spec: (
    <>
      <rect x="3.2" y="2" width="9.6" height="12" rx="1.5" />
      <path d="M5.8 6h4.4M5.8 9h4.4" />
    </>
  ),
  // broken — circled exclamation ("it doesn't work")
  broken: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.9v3.7M8 11v.1" />
    </>
  ),
  // differs — not-equal ("not how I meant")
  differs: (
    <>
      <path d="M3.5 6.3h9M3.5 9.7h9" />
      <path d="M10.2 3.4 5.8 12.6" />
    </>
  ),
};

export function BranchGlyph({ branch, className }: { branch: BranchKey; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {PATHS[branch]}
    </svg>
  );
}
