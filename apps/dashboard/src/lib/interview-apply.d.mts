export type InterviewAnswer = {
  intent: string | null;
  must: string[];
  notNeeded: string[];
  differentNow: string[];
  unread?: string[];
};

export function normalizeTitle(s: unknown): string;

export function applyInterviewAnswer(input: {
  answer: InterviewAnswer;
  current: {
    oneLine?: string | null;
    requirements: Array<{ id: string; title: string }>;
    productSpec?: Record<string, unknown> | null;
    confirmedItemIds?: string[] | null;
  };
  locale: "ko" | "en";
}): {
  oneLine: string;
  productSpec: Record<string, unknown> & { oneLine: string; excluded: string[]; decisions: string[] };
  newRequirements: Array<{ id: string; title: string }>;
  confirmedItemIds: string[];
  changed: { intent: boolean; mustAdded: number; mustMatched: number; notNeeded: number; differentNow: number };
};
