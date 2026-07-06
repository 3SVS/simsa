// Stage 99 — static, login-free narrative demo. Everything here is a FICTIONAL
// illustrative example (no real customer/project data, no live dashboard, no
// backend). It shows the transformation: AI-built draft -> staged acceptance.
import type { Metadata } from "next";
import Link from "next/link";
import { StampMark } from "../../components/StampMark";

const APP_URL = "https://app.trysimsa.com";
const CONTACT_EMAIL = "seunghunbae@b2w.kr";
const EARLY_ACCESS_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Simsa early access request",
)}`;

export const metadata: Metadata = {
  title: "Public demo — Simsa",
  description:
    "A fictional example of how Simsa turns an AI-built draft into a staged acceptance workflow.",
};

const ACCEPTANCE_ITEMS = [
  "A new user can create a task without errors.",
  "Empty states explain what to do next.",
  "Shared task links do not expose private data.",
  "Failed save actions show a clear recovery path.",
  "Basic mobile layout remains usable.",
  "There is a release checklist before sharing with users.",
];

const STAGES = [
  "Product intent review",
  "Onboarding and empty states",
  "Task creation acceptance check",
  "Sharing and permission review",
  "Error and recovery states",
  "Mobile layout check",
  "Release readiness decision",
];

const OUTPUT = [
  "Acceptance map",
  "Stage plan",
  "Fix instructions",
  "Evidence checklist",
  "Release decision",
];

export default function Demo() {
  return (
    <main>
      <header className="nav">
        <div className="container nav-inner">
          <Link className="nav-brand" href="/">
            <StampMark size={26} id="nav" />
            Simsa
          </Link>
          <div className="nav-actions">
            <a className="nav-cta" href={APP_URL}>
              Open Simsa
            </a>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="container">
          <span className="demo-label">Public demo · Fictional example</span>
          <h1 className="demo-title">
            From AI-built draft to staged acceptance workflow.
          </h1>
          <p className="lede">
            This example shows how Simsa turns an existing draft into acceptance
            items, stages, evidence, and decisions. It is illustrative — not real
            customer data.
          </p>
          <div className="hero-actions">
            <a className="cta" href={APP_URL}>
              Open Simsa
            </a>
            <a className="cta-secondary" href={EARLY_ACCESS_MAILTO}>
              Request early access
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Input artifact</h2>
          <div className="demo-card">
            <dl className="kv">
              <dt>Type</dt>
              <dd>AI-built app</dd>
              <dt>Context</dt>
              <dd>A founder has a task app generated with an AI coding agent.</dd>
              <dt>Goal</dt>
              <dd>Decide whether it is ready for early users.</dd>
              <dt>Current concern</dt>
              <dd>
                It looks complete, but onboarding, permissions, error states, and
                release checks are unclear.
              </dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Product understanding</h2>
          <div className="demo-card">
            <dl className="kv">
              <dt>What it is</dt>
              <dd>
                A lightweight task workspace where users create, organize, and
                share tasks.
              </dd>
              <dt>Primary user</dt>
              <dd>A founder or small-team member managing early product work.</dd>
              <dt>Core risk</dt>
              <dd>
                The app appears usable, but important acceptance conditions are
                not verified.
              </dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Acceptance items</h2>
          <p>The criteria this draft has to meet before sharing with users.</p>
          <ul className="outputs">
            {ACCEPTANCE_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Stage plan</h2>
          <ol className="steps">
            {STAGES.map((stage) => (
              <li key={stage}>{stage}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Evidence &amp; decision</h2>
          <div className="demo-card">
            <div className="ev-group ev-accepted">
              <h3>Accepted</h3>
              <ul>
                <li>Task creation flow works in the happy path.</li>
              </ul>
            </div>
            <div className="ev-group ev-fix">
              <h3>Needs fix</h3>
              <ul>
                <li>Empty state does not guide first-time users.</li>
                <li>Failed save has no visible recovery.</li>
              </ul>
            </div>
            <div className="ev-group ev-unverified">
              <h3>Not verified</h3>
              <ul>
                <li>Shared link privacy.</li>
                <li>Mobile layout on narrow screens.</li>
              </ul>
            </div>
            <div className="decision">
              <strong>Decision (illustrative)</strong>
              Do not release yet. Create a focused fix stage for empty states,
              recovery flows, and sharing-permission checks.
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Simsa output</h2>
          <ul className="outputs">
            {OUTPUT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Bring your own</h2>
          <p>
            Bring your idea, PRD, repo, or AI-built app. Simsa turns it into a
            staged acceptance workflow like the one above.
          </p>
          <a className="cta" href={EARLY_ACCESS_MAILTO}>
            Request early access
          </a>
        </div>
      </section>

      <footer className="foot">
        <div className="container">
          <div className="foot-mark" aria-hidden>
            <StampMark size={36} rough id="foot" />
          </div>
          <nav className="foot-links">
            <Link href="/">Home</Link>
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
