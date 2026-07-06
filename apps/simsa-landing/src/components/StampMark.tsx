// Shared Simsa seal mark (전각 인장) — solid oxblood square with "심사" carved in
// right-angle seal-script strokes (절곡 인장체: vertical/horizontal only,
// maze-like, square caps). 심 left / 사 right so it reads 심사 left-to-right.
// `rough` adds an 인주(ink-pad) texture for large hero/footer sizes.
//
// Pure presentational SVG (no hooks) so it works in both server and client
// components. Used by the landing page and the /demo, /privacy, /terms subpages
// so the brand mark is defined exactly once.
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
  rough = false,
  id = "s",
  className,
}: {
  size?: number;
  rough?: boolean;
  id?: string;
  className?: string;
}) {
  const fid = `seal-ink-${id}`;
  const strokeW = size <= 28 ? 5 : 4;
  const body = (
    <>
      <rect x="2" y="2" width="60" height="60" rx="7" fill="#8e2c39" />
      <g stroke="#faf6ee" fill="none" strokeWidth={strokeW} strokeLinecap="square">
        {SEAL_STROKES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      focusable="false"
    >
      {rough ? (
        <>
          <defs>
            <filter id={fid} x="-6%" y="-6%" width="112%" height="112%">
              <feTurbulence type="fractalNoise" baseFrequency="0.35 0.4" numOctaves="2" seed="5" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" />
            </filter>
          </defs>
          <g filter={`url(#${fid})`}>{body}</g>
        </>
      ) : (
        body
      )}
    </svg>
  );
}
