// StampMark — the Simsa seal brand mark (심사 = "review", squared hangul strokes
// in an oxblood seal). Shared with the marketing landing (apps/simsa-landing);
// this is the dashboard's copy of the same SVG so the two surfaces can't drift.
// Pure, deterministic SVG — no hooks, safe in server or client components.

const SEAL_STROKES = [
  // 심: ㅅ (squared Y)
  "M17 8 V16 M12 16 H22 M12 16 V27 M22 16 V27",
  // 심: ㅣ
  "M28 8 V27",
  // 심: ㅁ
  "M12 35 H28 V55 M12 35 V55 M12 55 H28",
  // 사: ㅅ (tall squared Y)
  "M41 8 V21 M36 21 H46 M36 21 V41 M46 21 V41 M36 41 V55 M46 41 V55",
  // 사: ㅏ
  "M53 8 V55 M53 29 H57",
];

export function StampMark({
  size = 24,
  id = "s",
  className,
}: {
  size?: number;
  id?: string;
  className?: string;
}) {
  const strokeW = size <= 28 ? 5 : 4;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect x="2" y="2" width="60" height="60" rx="7" fill="#8e2c39" />
      <g stroke="#faf6ee" fill="none" strokeWidth={strokeW} strokeLinecap="square">
        {SEAL_STROKES.map((d) => (
          <path key={`${id}-${d}`} d={d} />
        ))}
      </g>
    </svg>
  );
}
