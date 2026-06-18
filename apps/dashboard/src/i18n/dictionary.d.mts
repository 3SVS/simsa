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
    searchProjects: string;
    allProjects: string;
    noProjects: string;
  };
  account: { workspace: string; plan: string; settings: string };
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
  spec: {
    title: string;
    reviewNote: string;
    completeness: string;
    goal: string;
    included: string;
    excluded: string;
    openDecisions: string;
  };
  items: {
    title: string;
    subtitle: string;
    criteria: string;
    evidence: string;
    ctaQuestion: string;
    ctaButton: string;
  };
  priority: { must: string; should: string; could: string };
  fixesScreen: {
    title: string;
    reviewFirst: string;
    allPassed: string;
    analyzing: string;
    getDecisionHelp: string;
    createInstructions: string;
    collapse: string;
    expand: string;
    summary: string;
    needsAction: string;
    goToChecks: string;
    exportQuestion: string;
    reanalyze: string;
    draftNote: string;
    tasks: string;
    doneWhen: string;
    doNotDo: string;
  };
  checks: {
    draftTitle: string;
    draftDesc: string;
    prTitle: string;
    prDesc: string;
    reRun: string;
    checking: string;
    errorMsg: string;
    itemsChecked: string;
    draftTag: string;
    emptyTitle: string;
    emptyDesc: string;
    runCheck: string;
    needsAction: string;
    viewRemaining: string;
    prLoading: string;
    noPrReview: string;
    noPrReviewDesc: string;
    connectPr: string;
    reviewedPr: string;
    viewComparison: string;
    toGithub: string;
    nextStep: string;
  };
  runStatus: { error: string; running: string; queued: string };
  telegram: {
    title: string;
    desc: string;
    notConfigured: string;
    chatId: string;
    chatIdHint: string;
    policy: string;
    policyProblems: string;
    policyAlways: string;
    policyDisabled: string;
    enable: string;
    saving: string;
    saved: string;
    saveError: string;
    sendTest: string;
    sending: string;
    testSent: string;
    testError: string;
    historyTitle: string;
    refresh: string;
    noHistory: string;
    sent: string;
    skipped: string;
    failed: string;
    prReviewComplete: string;
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
    checkingConnection: string;
    connectRepoFirst: string;
    goConnectRepo: string;
    loadPulls: string;
    pullsLoadError: string;
    openPulls: string;
    noPulls: string;
    selectItemsForPr: string;
    selected: string;
    saveLink: string;
    linked: string;
    linkSaveError: string;
    linkedPulls: string;
    notReviewedYet: string;
    runReviewBtn: string;
    reviewing: string;
    reviewFailed: string;
  };
  review: { resultsTitle: string; basisNote: string };
  history: {
    title: string;
    desc: string;
    comparisonDesc: string;
    emptyTitle: string;
    emptyBody: string;
    backToPr: string;
    loading: string;
    loadError: string;
    rerunRemaining: string;
    rerunNoItems: string;
    rerunning: string;
    rerunError: string;
    selectInDetail: string;
    fixRemaining: string;
    fixNoItems: string;
    openRunDetails: string;
    items: string;
    runsPerPr: string;
    totalRuns: string;
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
