"use client";

// Simsa marketing entry — served on simsa.dev (trysimsa.com redirects here).
// Luma-quiet chrome + Discord-style continuous canvas with floating panels and
// scroll-reveal motion. Copy/i18n unchanged (src/lib/dictionary.mjs).
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { LANDING_DICT, LANG_STORAGE_KEY, resolveInitialLang } from "../lib/dictionary.mjs";
import { StampMark } from "../components/StampMark";

const APP_URL = "https://app.trysimsa.com";
// Partnership / contact mailbox — 3SVS (operator's company). No trysimsa.com
// mailbox is wired yet — do not invent hi@trysimsa.com until it exists.
const CONTACT_EMAIL = "seunghunbae@3svs.com";

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

type Lang = "en" | "ko";

// Inline line-glyphs for the "start from anything" cards (decorative, aria-hidden).
const GLYPHS = [
  // idea — bulb
  <svg key="g0" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8a4.3 4.3 0 0 1 2.5 7.8c-.4.3-.6.5-.6.8v.6H6.1v-.6c0-.3-.2-.5-.6-.8A4.3 4.3 0 0 1 8 1.8Z" /><path d="M6.6 13.2h2.8" /></svg>,
  // PRD — document
  <svg key="g1" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3.2" y="2" width="9.6" height="12" rx="1.5" /><path d="M5.8 6h4.4M5.8 9h4.4" /></svg>,
  // product URL — chain link
  <svg key="g2" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6.4 9.6l3.2-3.2" /><path d="M5.2 7.6 4 8.8a2.55 2.55 0 0 0 3.6 3.6l1.2-1.2" /><path d="M10.8 8.4 12 7.2a2.55 2.55 0 0 0-3.6-3.6L7.2 4.8" /></svg>,
  // repo — branch
  <svg key="g3" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="4.2" cy="3.8" r="1.5" /><circle cx="4.2" cy="12.2" r="1.5" /><circle cx="11.8" cy="5.8" r="1.5" /><path d="M4.2 5.3v5.4M11.8 7.3c0 2.4-2.6 2.6-5.4 3.6" /></svg>,
  // PR — swap arrows
  <svg key="g4" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13V4M5 4 3.2 5.8M5 4l1.8 1.8" /><path d="M11 3v9M11 12l-1.8-1.8M11 12l1.8-1.8" /></svg>,
  // AI-built app — sparkle
  <svg key="g5" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M8 2.2l1.3 3.6 3.5 1.2-3.5 1.2L8 11.8 6.7 8.2 3.2 7l3.5-1.2Z" /></svg>,
];

export default function Home() {
  // Deterministic SSR default (en) — the effect below re-resolves after
  // hydration so there is no server/client markup mismatch.
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    } catch {
      /* storage blocked — fall through to browser detection */
    }
    setLang(resolveInitialLang({ stored, navigatorLanguage: navigator.language }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Scroll reveal — sections rise in as they enter the viewport (Discord/Linear).
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const toggleLang = () => {
    const next: Lang = lang === "en" ? "ko" : "en";
    setLang(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* non-fatal */
    }
  };

  const t = LANDING_DICT[lang];

  // Hero mock — an in-product screen (browser frame + sidebar + verdict bar),
  // built from real dictionary content so it localizes for free.
  const mockSteps = t.workflow.steps.slice(0, 4);
  const mockStatus = ["pass", "pass", "run", "todo"] as const;
  const mockIcon = { pass: "✓", run: "●", todo: "○" } as const;

  return (
    <main>
      <header className="nav">
        <div className="container nav-inner">
          <Link className="nav-brand" href="/">
            <StampMark size={26} id="nav" />
            {t.hero.wordmark}
          </Link>
          <div className="nav-actions">
            <button type="button" className="lang-toggle" onClick={toggleLang}>
              {t.langToggle}
            </button>
            <a className="nav-cta" href={APP_URL}>
              {t.hero.ctaStart}
            </a>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="container">
          <h1 className="tagline rise rise-1">{t.hero.headline}</h1>
          <p className="subline rise rise-2">{t.hero.subline}</p>
          <p className="lede rise rise-2">{t.hero.lede}</p>
          <p className="beta-note rise rise-3">{t.hero.betaNote}</p>
          <div className="hero-actions rise rise-3">
            <a className="cta" href={APP_URL}>
              {t.hero.ctaStart}
            </a>
            <Link className="cta-secondary" href="/demo">
              {t.hero.ctaDemo}
            </Link>
          </div>

          {/* In-product screen + review-stamp motion (think → press → imprint) */}
          <div className="mock-wrap" aria-hidden>
            <span className="stamp-hero">
              <StampMark size={84} rough id="hero" />
            </span>
            <span className="ink-ring" />
            <div className="mock">
            <div className="mock-bar">
              <span className="mb-dot" />
              <span className="mb-dot" />
              <span className="mb-dot" />
              <span className="mock-url">app.trysimsa.com</span>
            </div>
            <div className="mock-body">
              <div className="mock-side">
                <span className="ms-logo" />
                <span className="ms-item on" />
                <span className="ms-item" />
                <span className="ms-item" />
                <span className="ms-item" />
              </div>
              <div className="mock-main">
                <div className="mock-verdictbar">
                  <span className="mv-check">✓</span>
                  <span className="mv-track">
                    <span className="mv-fill" />
                  </span>
                  <span className="mock-verdict">3 / 4</span>
                </div>
                {mockSteps.map((step, i) => (
                  <div className="mock-row" key={step.title}>
                    <span className={`mock-status ${mockStatus[i] ?? "todo"}`}>
                      {mockIcon[mockStatus[i] ?? "todo"]}
                    </span>
                    <span className="mr-label">{step.title}</span>
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-tint">
        <div className="container">
          <div className="panel reveal">
            <h2>{t.startAnything.title}</h2>
            <p>{t.startAnything.body}</p>
            <div className="start-grid">
              {t.startAnything.chips.map((label, i) => (
                <div className="start-card" key={label}>
                  <span className={`glyph g${i % 6}`} aria-hidden>
                    {GLYPHS[i % 6]}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container reveal">
          <h2>{t.creates.title}</h2>
          <p>{t.creates.body}</p>
          <div className="bento">
            {t.creates.outputs.map((output, i) => (
              <Link className="feat" href="/demo" key={output}>
                <div className="feat-head">
                  <h3>{output}</h3>
                  <span className="feat-arrow" aria-hidden>→</span>
                </div>
                {/* Real product screenshots (example project — fictional data),
                    Notion-style: tinted band with a bottom-bleeding shot. */}
                <div className={`feat-media fm-${i % 4}`} aria-hidden>
                  {i % 4 === 0 && (
                    <Image className="feat-shot fs-plan" src="/shots/shot-overview.webp" alt="" width={1800} height={1200} />
                  )}
                  {i % 4 === 1 && (
                    <Image className="feat-shot fs-evidence" src="/shots/shot-items.webp" alt="" width={1800} height={1200} />
                  )}
                  {i % 4 === 2 && (
                    <Image className="feat-shot fs-decision" src="/shots/shot-overview.webp" alt="" width={1800} height={1200} />
                  )}
                  {i % 4 === 3 && (
                    <Image className="feat-shot fs-pack" src="/shots/shot-export.webp" alt="" width={1800} height={1200} />
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-warm">
        <div className="container">
          <div className="panel reveal">
            <h2>{t.workflow.title}</h2>
            <ol className="steps">
              {t.workflow.steps.map((step) => (
                <li key={step.title}>
                  {step.title} <span>{step.sub}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container reveal">
          <h2>{t.forWhom.title}</h2>
          <p className="note">{t.forWhom.body}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="band reveal">
            <h2>{t.joinBeta.title}</h2>
            <p>{t.joinBeta.p1}</p>
            <p>{t.joinBeta.p2}</p>
            <div className="hero-actions">
              <a className="cta" href={APP_URL}>
                {t.joinBeta.ctaStart}
              </a>
              <a className="cta-secondary" href={FEEDBACK_MAILTO}>
                {t.joinBeta.ctaFeedback}
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="panel reveal">
            <h2>{t.faq.title}</h2>
            <dl className="faq">
              {t.faq.items.map((item) => (
                <div className="faq-item" key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="container">
          <div className="foot-mark" aria-hidden>
            <StampMark size={36} rough id="foot" />
          </div>
          <nav className="foot-links">
            <Link href="/demo">{t.footer.demo}</Link>
            <Link href="/privacy">{t.footer.privacy}</Link>
            <Link href="/terms">{t.footer.terms}</Link>
          </nav>
          <p className="foot-contact">
            {t.footer.partnership} · 3SVS ·{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
          <p className="foot-tag">{t.footer.tag}</p>
        </div>
      </footer>
    </main>
  );
}
