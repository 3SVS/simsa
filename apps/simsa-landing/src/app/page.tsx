"use client";

// Simsa marketing entry — served on simsa.dev (trysimsa.com redirects here).
// Open-beta framing (PR B) + EN/KO with browser-language detection and a
// manual toggle (persisted). Copy uses the dashboard's non-developer language
// (확인 / 코드 저장소 / 기획서 / 코드 변경(PR)) — see src/lib/dictionary.mjs.
// SSR renders EN deterministically; a hydration effect switches to the stored
// or browser-detected language (same pattern as the dashboard I18nProvider).
import Link from "next/link";
import { useEffect, useState } from "react";
import { LANDING_DICT, LANG_STORAGE_KEY, resolveInitialLang } from "../lib/dictionary.mjs";

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

type Lang = "en" | "ko";

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

  return (
    <main>
      <section className="hero">
        <div className="container">
          <div className="lang-toggle-row">
            <button type="button" className="lang-toggle" onClick={toggleLang}>
              {t.langToggle}
            </button>
          </div>
          <p className="wordmark">{t.hero.wordmark}</p>
          <h1 className="tagline">{t.hero.headline}</h1>
          <p className="subline">{t.hero.subline}</p>
          <p className="lede">{t.hero.lede}</p>
          <p className="beta-note">{t.hero.betaNote}</p>
          <div className="hero-actions">
            <a className="cta" href={APP_URL}>
              {t.hero.ctaStart}
            </a>
            <Link className="cta-secondary" href="/demo">
              {t.hero.ctaDemo}
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t.startAnything.title}</h2>
          <p>{t.startAnything.body}</p>
          <div className="chips">
            {t.startAnything.chips.map((input) => (
              <span className="chip" key={input}>
                {input}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t.creates.title}</h2>
          <p>{t.creates.body}</p>
          <ul className="outputs">
            {t.creates.outputs.map((output) => (
              <li key={output}>{output}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t.workflow.title}</h2>
          <ol className="steps">
            {t.workflow.steps.map((step) => (
              <li key={step.title}>
                {step.title} <span>{step.sub}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t.forWhom.title}</h2>
          <p className="note">{t.forWhom.body}</p>
          <p>{t.forWhom.contactLead}</p>
          <a className="contact-link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </div>
      </section>

      <section className="section">
        <div className="container">
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
      </section>

      <footer className="foot">
        <div className="container">
          <nav className="foot-links">
            <Link href="/demo">{t.footer.demo}</Link>
            <Link href="/privacy">{t.footer.privacy}</Link>
            <Link href="/terms">{t.footer.terms}</Link>
            <a href={`mailto:${CONTACT_EMAIL}`}>{t.footer.contact}</a>
          </nav>
          <p className="foot-tag">{t.footer.tag}</p>
        </div>
      </footer>
    </main>
  );
}
