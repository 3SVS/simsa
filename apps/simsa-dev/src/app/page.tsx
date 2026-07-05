// Stage 94 — minimal developer surface for simsa.dev.
// Static, host-agnostic, separate Vercel project. Intentionally a placeholder:
// no API/SDK/MCP docs are promised (MCP package is not yet published), and the
// "coming soon" item is plain text, not a broken link.
const APP_URL = "https://app.trysimsa.com";
const REPO_URL = "https://github.com/3SVS/simsa"; // public repo
// Real contact mailbox (operator-provided), shared with the trysimsa.com surface.
const CONTACT_EMAIL = "seunghunbae@b2w.kr";
// Stage 97: mailto-based early access — no backend / DB / email provider.
const EARLY_ACCESS_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Simsa early access request",
)}`;

// Simsa seal mark (전각 인장) — solid oxblood square with "심사" carved in
// right-angle seal-script strokes (절곡 인장체: vertical/horizontal only,
// square caps). 심 left / 사 right so it reads 심사 left-to-right. Clean
// (non-textured) copy of the landing brand mark — simsa-dev is a separate app.
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

function StampMark({ size = 48 }: { size?: number }) {
  const strokeW = size <= 28 ? 5 : 4;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
    >
      <rect x="2" y="2" width="60" height="60" rx="7" fill="#8e2c39" />
      <g
        stroke="#faf6ee"
        fill="none"
        strokeWidth={strokeW}
        strokeLinecap="square"
      >
        {SEAL_STROKES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

export default function Home() {
  return (
    <main className="wrap">
      <section className="card">
        <div className="seal">
          <StampMark size={48} />
        </div>
        <p className="wordmark">Simsa for Developers</p>
        <h1 className="tagline">Developer docs are coming soon.</h1>
        <p className="lede">
          Simsa accepts ideas, PRDs, repos, and AI-built apps as input, then
          turns them into staged acceptance workflows — review, compare, and
          decide what to accept, fix, or rerun with evidence.
        </p>
        <div className="actions">
          <a className="cta" href={APP_URL}>
            Open Simsa
          </a>
          <a
            className="cta-secondary"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub
          </a>
          <span className="soon">MCP package — coming soon</span>
        </div>
      </section>
      <footer className="foot">
        <a href={EARLY_ACCESS_MAILTO}>Request early access</a>
        {" · "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <br />
        <a href="https://trysimsa.com/demo">View public demo</a>
        <br />
        <a href="https://trysimsa.com/privacy">Privacy</a>
        {" · "}
        <a href="https://trysimsa.com/terms">Terms</a>
        <br />
        Built for AI-built software acceptance.
      </footer>
    </main>
  );
}
