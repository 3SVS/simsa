// Type declarations for beta-onboarding.mjs (Stage 120).

export const ONBOARDING_HEADING: string;
export const ONBOARDING_INTRO: string;
export const ONBOARDING_STEPS: string[];
export const ONBOARDING_SAFETY_LINE: string;

export type PreviewLanguageItem = { term: string; meaning: string };
export const PREVIEW_LANGUAGE_ITEMS: PreviewLanguageItem[];

export const BETA_SAFETY_NOTES: {
  beforeInput: string;
  savedScope: string;
  savedRetention: string;
  feedback: string;
};

export const EMPTY_STATES: {
  beforeInput: string;
  noSavedRecords: string;
  noOpenedRecord: string;
};

export type BetaOnboardingCopy = {
  heading: string;
  intro: string;
  steps: string[];
  safetyLine: string;
  previewLanguageItems: PreviewLanguageItem[];
  safetyNotes: {
    beforeInput: string;
    savedScope: string;
    savedRetention: string;
    feedback: string;
  };
  emptyStates: {
    beforeInput: string;
    noSavedRecords: string;
    noOpenedRecord: string;
  };
};

export const BETA_ONBOARDING_COPY: Record<"en" | "ko", BetaOnboardingCopy>;
export function getBetaOnboardingCopy(locale: string): BetaOnboardingCopy;
