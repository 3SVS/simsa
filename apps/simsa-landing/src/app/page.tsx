// Simsa marketing entry for trysimsa.com.
// Stage 93 hero · 95 trust/contact · 96 staged-acceptance positioning ·
// PR B open-beta framing: the early-access gate became an open-beta invite —
// free while in beta, community tone, no launch hype.
// Static, host-agnostic, no new dependencies.
import Link from "next/link";

const APP_URL = "https://app.trysimsa.com";
// Real contact mailbox (operator-provided). No trysimsa.com mailbox is wired
// yet — do not invent hi@trysimsa.com until it exists.
const CONTACT_EMAIL = "seunghunbae@b2w.kr";

// Feedback channel for beta members — mailto only, no backend / DB / provider.
const FEEDBACK_SUBJECT = "Simsa beta feedback";
const FEEDBACK_BODY = `Hi Simsa team,

What I'm building:

What worked / what didn't:

What I wish Simsa did:
`;
const FEEDBACK_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  FEEDBACK_SUBJECT,
)}&body=${encodeURIComponent(FEEDBACK_BODY)}`;

const INPUTS = [
  "Idea",
  "PRD / spec",
  "Product URL",
  "GitHub repo",
  "Pull request",
  "AI-built app",
];

const OUTPUTS = [
  "Product understanding",
  "Acceptance items",
  "Stage plan",
  "Review evidence",
  "Accept / fix / rerun decisions",
  "Release readiness",
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="container">
          <p className="wordmark">Simsa</p>
          <h1 className="tagline">The acceptance layer for AI-built software.</h1>
          <p className="subline">From fast AI-built drafts to accepted product work.</p>
          <p className="lede">
            AI coding agents can create a first draft fast. Simsa helps teams
            review, compare, and decide what to accept, fix, or rerun — with
            evidence.
          </p>
          <p className="beta-note">
            Simsa is in open beta — everything is free while we build it out.
            You&apos;d be one of the early members, and what you run shapes what
            it becomes.
          </p>
          <div className="hero-actions">
            <a className="cta" href={APP_URL}>
              Start free — open beta
            </a>
            <Link className="cta-secondary" href="/demo">
              View demo
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Start from anything</h2>
          <p>
            Bring an idea, a PRD, a product URL, a GitHub repo, a pull request,
            or an AI-built app. Simsa turns it into a staged acceptance workflow.
          </p>
          <div className="chips">
            {INPUTS.map((input) => (
              <span className="chip" key={input}>
                {input}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>What Simsa creates</h2>
          <p>
            Raw AI-built output becomes reviewable, comparable, acceptance-ready
            product work.
          </p>
          <ul className="outputs">
            {OUTPUTS.map((output) => (
              <li key={output}>{output}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>How the workflow runs</h2>
          <ol className="steps">
            <li>
              Understand what exists.{" "}
              <span>Idea, spec, repo, or AI-built draft.</span>
            </li>
            <li>
              Turn it into acceptance items.{" "}
              <span>The criteria a change has to meet.</span>
            </li>
            <li>
              Review builds and agent outputs.{" "}
              <span>Against those criteria, with evidence.</span>
            </li>
            <li>
              Decide what to accept, fix, or rerun.{" "}
              <span>Compare runs and choose.</span>
            </li>
            <li>
              Keep evidence and release history.{" "}
              <span>So decisions stay reviewable.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>For teams building with AI coding agents</h2>
          <p className="note">
            Built for founders, product teams, and agencies. Simsa runs the
            acceptance process on top of fast AI-built drafts — staged review,
            evidence, and release decisions — so you can tell what is actually
            ready to accept, fix, or rerun.
          </p>
          <p>For partnership inquiries, contact the team.</p>
          <a className="contact-link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Join the open beta</h2>
          <p>
            No waitlist, no invite code — bring an idea, a PRD, a GitHub repo,
            or an AI-built app and start checking it today. Everything is free
            during the beta.
          </p>
          <p>
            Being early matters here: the reviews beta members run are what
            teach Simsa which failures actually happen in AI-built software.
            If something feels off or missing, tell us — we read every note.
          </p>
          <div className="hero-actions">
            <a className="cta" href={APP_URL}>
              Start free — open beta
            </a>
            <a className="cta-secondary" href={FEEDBACK_MAILTO}>
              Send beta feedback
            </a>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="container">
          <nav className="foot-links">
            <Link href="/demo">Demo</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          </nav>
          <p className="foot-tag">Built for AI-built software acceptance.</p>
        </div>
      </footer>
    </main>
  );
}
