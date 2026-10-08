export type BuilderReport = {
  intent: string;
  users?: string[];
  mustFlows: string[];
  claims: Array<{ id: string; kind: string; text: string }>;
  access: { loginMethod: string; testAccountHow: string };
};
export declare const BUILDER_SELF_REPORT_PROMPT: { ko: string; en: string };
export declare function saveBuilderReport(projectId: string, report: BuilderReport): void;
export declare function loadBuilderReport(projectId: string): BuilderReport | null;
type Copy = {
  title: string;
  intro: string;
  copy: string;
  copied: string;
  answerLabel: string;
  parse: string;
  parsing: string;
  removed: (n: number) => string;
  failed: string;
  empty: string;
  understood: string;
  claims: (n: number) => string;
  flowsLabel: string;
};
export declare const BSR_COPY: { ko: Copy; en: Copy };
