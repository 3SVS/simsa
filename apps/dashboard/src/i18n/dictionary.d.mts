/**
 * Type declarations for dictionary.mjs (Stage 59 i18n).
 */
export type Locale = "en" | "ko";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type StatusKey =
  | "passed"
  | "failed"
  | "inconclusive"
  | "needs_decision"
  | "not_started"
  | "building";

export type StatusEntry = { label: string; desc: string };

export type Dictionary = {
  brand: { wordmark: string; tagline: string };
  lang: { label: string; english: string; korean: string };
  nav: {
    overview: string;
    idea: string;
    spec: string;
    items: string;
    checks: string;
    fixes: string;
    export: string;
    settings: string;
    github: string;
    backToProjects: string;
    newProject: string;
    groupPlan: string;
    groupReview: string;
    groupDeliver: string;
  };
  status: Record<StatusKey, StatusEntry>;
  comparison: {
    improved: string;
    stillOpen: string;
    newIssue: string;
    unchanged: string;
    caption: string;
  };
  projects: {
    homeTitle: string;
    homeSubtitle: string;
    newProject: string;
    emptyTitle: string;
    emptyBody: string;
  };
  actions: {
    startProject: string;
    reviewPR: string;
    reRunReview: string;
    createFixInstructions: string;
    compareRuns: string;
    postComment: string;
    previewBeforePost: string;
  };
  fix: { title: string; subtitle: string };
  common: {
    loading: string;
    save: string;
    cancel: string;
    retry: string;
    notFound: string;
    project: string;
    view: string;
    viewAll: string;
    more: string;
  };
  overview: { specCompleteness: string; resultsSummary: string; mustHaves: string };
  idea: { subtitle: string; yourInput: string; understood: string; excluded: string };
  np: {
    title: string;
    ideaPlaceholder: string;
    examplesLabel: string;
    generateSpec: string;
    reading: string;
    understood: string;
    mainUsers: string;
    mainFlow: string;
    editIdea: string;
    generating: string;
    answered: string;
    decideLater: string;
    recommended: string;
    typeYourOwn: string;
    specReady: string;
    whoFor: string;
    problem: string;
    included: string;
    excluded: string;
    openDecisions: string;
    mustHaves: string;
    saveAndStart: string;
    step1Title: string;
    step1Sub: string;
    freeBeta: string;
    draftTag: string;
    draftNote: string;
    confirmAnswer: string;
    step3Title: string;
    step3Sub: string;
    back: string;
    editQuestions: string;
    saveNote: string;
    customInput: string;
  };
  github: {
    connectTitle: string;
    connectIntro: string;
    connectGithub: string;
    connectHint: string;
    connectedAs: string;
    connected: string;
    selectRepo: string;
    changeRepo: string;
    connectedRepo: string;
    searchPlaceholder: string;
    noMatch: string;
    publicReposCount: string;
    noReposListed: string;
    manualTitle: string;
    manualHint: string;
    manualPlaceholder: string;
    connect: string;
    finding: string;
    linkFailed: string;
    runReview: string;
    reRunRemaining: string;
    createFixInstructions: string;
    viewHistory: string;
    errorNotFound: string;
    errorPrivate: string;
    errorNotConnected: string;
    errorInvalidName: string;
    reposLoadError: string;
  };
  review: { resultsTitle: string; basisNote: string };
  history: {
    title: string;
    desc: string;
    comparisonDesc: string;
    emptyTitle: string;
    emptyBody: string;
  };
  errors: { generic: string; loadFailed: string };
};

export const LOCALES: Locale[];
export const DEFAULT_LOCALE: Locale;
export const LOCALE_STORAGE_KEY: string;
export const DICTIONARIES: Record<Locale, Dictionary>;

export function normalizeLocale(raw: unknown): Locale;
export function getDictionary(locale: unknown): Dictionary;
export function statusLabel(dict: Dictionary, status: string): string;
export function statusDescription(dict: Dictionary, status: string): string;
export function readStoredLocale(storage: StorageLike | null | undefined): Locale;
export function writeStoredLocale(storage: StorageLike | null | undefined, locale: Locale): void;
