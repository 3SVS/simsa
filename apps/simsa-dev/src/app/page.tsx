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

export default function Home() {
  return (
    <main className="wrap">
      <section className="card">
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
