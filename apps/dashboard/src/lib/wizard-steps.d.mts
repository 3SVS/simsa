export type WizardStepId = "idea" | "understand" | "questions" | "done";
export type WizardStepState = "done" | "current" | "upcoming";

export type WizardStep = {
  id: WizardStepId;
  index: number;
  label: string;
  state: WizardStepState;
  isCurrent: boolean;
  isDone: boolean;
};

export const WIZARD_STEP_IDS: WizardStepId[];
export function clampStep(step: number, count?: number): number;
export function buildStepper(current: number, labels?: string[]): WizardStep[];
export function stepperPercent(current: number, count?: number): number;
export function rotatingWaitLine(phrases: string[], tick: number): string;
