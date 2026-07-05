export declare const LANG_STORAGE_KEY: string;

export declare function resolveInitialLang(input: {
  stored?: string | null;
  navigatorLanguage?: string | null;
}): "en" | "ko";

export interface LandingDict {
  langToggle: string;
  hero: {
    wordmark: string;
    headline: string;
    subline: string;
    lede: string;
    betaNote: string;
    ctaStart: string;
    ctaDemo: string;
  };
  startAnything: { title: string; body: string; chips: string[] };
  creates: { title: string; body: string; outputs: string[] };
  workflow: { title: string; steps: { title: string; sub: string }[] };
  forWhom: { title: string; body: string; contactLead: string };
  joinBeta: { title: string; p1: string; p2: string; ctaStart: string; ctaFeedback: string };
  faq: { title: string; items: { q: string; a: string }[] };
  footer: { demo: string; privacy: string; terms: string; contact: string; partnership: string; tag: string };
}

export declare const LANDING_DICT: { en: LandingDict; ko: LandingDict };
