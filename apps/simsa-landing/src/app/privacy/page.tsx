// Stage 98 — early-access Privacy Note. Plain-English, non-lawyerly, static.
// Not a final/lawyer-reviewed policy; no legal entity invented.
import type { Metadata } from "next";
import Link from "next/link";
import { StampMark } from "../../components/StampMark";

const APP_URL = "https://app.trysimsa.com";
const CONTACT_EMAIL = "seunghunbae@3svs.com";

export const metadata: Metadata = {
  title: "Privacy Note — Simsa",
  description: "Early access privacy note for Simsa.",
};

export default function Privacy() {
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
        <h1>Privacy Note</h1>
        <p className="status">
          Early access note. This page may be updated as Simsa evolves.
        </p>
        <p className="status">
          한국어 정본: <a href={`${APP_URL}/legal/privacy`}>개인정보처리방침</a>
        </p>

        <h2>What you may share</h2>
        <ul>
          <li>
            ideas, PRDs, product URLs, GitHub repo links, pull requests, or
            AI-built app context
          </li>
          <li>early access inquiry details sent by email</li>
          <li>technical metadata needed to review or operate the service</li>
        </ul>

        <h2>How it is used</h2>
        <ul>
          <li>to understand the product or project context</li>
          <li>
            to create acceptance items, stage plans, review notes, and next-step
            recommendations
          </li>
          <li>to respond to early access or partnership inquiries</li>
          <li>to improve the product experience</li>
        </ul>

        <h2>What not to send</h2>
        <ul>
          <li>secrets, API keys, passwords, or production credentials</li>
          <li>sensitive customer data, unless explicitly agreed</li>
        </ul>

        <h2>Third-party services</h2>
        <p>
          Simsa relies on hosting, version control, AI model providers, and
          infrastructure services to operate the product. These may change as
          the product evolves.
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
