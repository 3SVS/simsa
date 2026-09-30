// Type declarations for privacy-prefs.mjs (Train K — 동의·프라이버시, 계약 5).

export type OpsMeta = "on" | "off";
export type OpsMetaSource = "default" | "user";
export type TrainingState = "consented" | "declined" | "undecided";

export type PrivacyPrefs = {
  opsMeta: OpsMeta;
  opsMetaSource: OpsMetaSource;
  region: string | null;
  training: { state: TrainingState; version: string | null; decidedAt: string | null };
};

export type LegacyTrainingConsent = { ok: boolean; active: boolean; storageConfigured: boolean };

export const OPS_META_VALUES: readonly OpsMeta[];
export const OPS_META_SOURCES: readonly OpsMetaSource[];
export const TRAINING_STATES: readonly TrainingState[];
export const TRAINING_CARD_MAX_EXPOSURES: number;
export const TRAINING_CARD_STORAGE_KEY: string;

/** Server response → prefs, or null when unknown (old server, network, off-contract shape). */
export function normalizePrivacyPrefs(raw: unknown): PrivacyPrefs | null;
export function normalizeTrainingConsent(raw: unknown): LegacyTrainingConsent;
export function parseSeenRuns(raw: unknown): string[];
export function trainingCardVisible(input: {
  resultDone: boolean;
  trainingState: TrainingState | null | undefined;
  seenRuns: readonly string[];
  runId: string;
}): boolean;
/** Result-screen entry point: card visibility straight from the (possibly null = unknown) prefs. */
export function cardVisibleFromPrefs(
  prefs: PrivacyPrefs | null | undefined,
  seenRuns: readonly string[],
  runId: string,
  resultDone: boolean,
): boolean;
export function rememberTrainingCardSeen(seenRuns: readonly string[], runId: string): string[];
export function trainingSaveOutcome(
  requested: boolean,
  res: { ok: boolean; active: boolean },
): "consented" | "declined" | "error";
export type TrainingCardChoice = "ask" | "consented" | "declined" | "withdrawn";
/** Card state after a save: withdraw from "consented" → "withdrawn"; a save that did not stick → "error". */
export function trainingCardNextChoice(
  prev: TrainingCardChoice,
  allow: boolean,
  res: { ok: boolean; active: boolean },
): Exclude<TrainingCardChoice, "ask"> | "error";
/** Result-screen "sharing training data · withdraw" line: consented per server, and the card is not showing. */
export function trainingWithdrawLineVisible(prefs: PrivacyPrefs | null | undefined, cardShown: boolean): boolean;
export type OpsInfoLineVariant = "recording" | "off_default" | "off_user";
export function opsInfoLineVariant(prefs: PrivacyPrefs | null): OpsInfoLineVariant | null;
export function opsInfoLineCopy(
  variant: OpsInfoLineVariant | null,
  p: {
    lineRecording: string;
    lineOffDefault: string;
    lineOffUser: string;
    turnOff: string;
    turnOn: string;
    turnOnAgain: string;
  },
): { text: string; action: string; next: OpsMeta } | null;
/** Settings training switch: message after saving — only what the server actually did. */
export function trainingToggleSavedCopy(
  training: { on: boolean; offDeletes: boolean },
  s: { savedOn: string; savedOffDeletes: string; savedOffStops: string },
): string;
/** Settings training switch while on: what turning it off will do (null when off). */
export function trainingOffNoteCopy(
  training: { on: boolean; offDeletes: boolean },
  s: { offNoteDeletes: string; offNoteStops: string },
): string | null;
export function privacySettingsState(input: {
  prefs: PrivacyPrefs | null;
  legacy: { ok: boolean; active: boolean } | null;
}): {
  opsMeta: { available: boolean; on: boolean; defaultOff: boolean };
  training: { available: boolean; on: boolean; offDeletes: boolean };
};
