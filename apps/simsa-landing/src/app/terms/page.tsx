// Stage 98 — early-access Terms Note. Plain-English, non-lawyerly, static.
// Not a final/lawyer-reviewed agreement; no paid plans or billing terms.
import type { Metadata } from "next";
import Link from "next/link";
import { StampMark } from "../../components/StampMark";

const APP_URL = "https://app.trysimsa.com";
const CONTACT_EMAIL = "seunghunbae@3svs.com";

export const metadata: Metadata = {
  title: "Terms Note — Simsa",
  description: "Early access terms note for Simsa.",
};

export default function Terms() {
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

      <article className="legal container">
        <Link className="back" href="/">
          ← Simsa
        </Link>
        <h1>Terms Note</h1>
        <p className="status">
          Early access note. Simsa is evolving and these terms may be updated.
        </p>

        <h2>Use of Simsa</h2>
        <ul>
          <li>Simsa helps review and organize AI-built software work.</li>
          <li>Simsa provides acceptance workflows, evidence, and recommendations.</li>
          <li>
            Simsa does not guarantee that software is bug-free, secure,
            compliant, or production-ready.
          </li>
        </ul>

        <h2>User responsibility</h2>
        <ul>
          <li>review outputs before relying on them</li>
          <li>do not submit secrets or credentials</li>
          <li>have the right to share the materials you provide</li>
        </ul>

        <h2>Early access</h2>
        <ul>
          <li>access may change while the product is being developed</li>
          <li>features may be incomplete, experimental, or changed over time</li>
        </ul>

        <h2>No professional guarantee</h2>
        <p>
          Simsa is not a substitute for legal, security, compliance, or
          professional engineering review.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this note:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </article>

      <footer className="foot">
        <div className="container">
          <div className="foot-mark" aria-hidden>
            <StampMark size={36} rough id="foot" />
          </div>
          <nav className="foot-links">
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
