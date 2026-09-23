export type DevSpecViewModel = {
  what: string;
  screenCount: number;
  entityCount: number;
  excluded: string[];
  mustFeatureTitles: string[];
  counts: { features: number; acceptance: number; screens: number; entities: number; apis: number; wbs: number; tests: number; openQuestions: number };
  source: "generated" | "inferred" | "manual";
  humanOnlyCount: number;
};
export declare function devSpecView(devSpec: unknown): DevSpecViewModel | null;
export declare function generateButtonState(f: { hasSpec: boolean; hasItems: boolean; hasDevSpec: boolean; phase: "idle" | "loading" }): {
  enabled: boolean;
  labelKey: "make" | "remake" | "making";
  hintKey: null | "needSpec" | "needItems";
};
export declare function generateErrorKey(err: { error: string; stage?: string; issueCount?: number; retryAfterSeconds?: number }): "errLlm" | "errInvalid" | "errRateLimited" | "errNotSynced" | "errNetwork" | "errServer";
