/**
 * evidence-chain.ts — 검사 엔진 v2 S1: 증거물 저장소 · 판정 스키마 · 기계 검증기 (2026-10-21).
 *
 * 설계: docs/simsa-inspector-v2-design-2026-10-07.md §2.1 (LOCKED V-1~V-3).
 *   V-1 판정은 증거물 인용 필수 — 인용이 없거나 인용 문구가 그 증거물에 실제로 없으면 not_verified로 강등.
 *   V-2 pass는 **상태 변화 증거물**(쓰기 요청 2xx · 저장소 변화 · 조작 전후 차이 · 다른 브라우저에서 관찰)이 있어야 한다.
 *   V-3 fail은 **독립 재실행 증거물**에서 같은 문구가 다시 나와야 한다.
 * 검증기는 LLM을 쓰지 않는다. 통과하지 못한 판정은 리포트에 오르지 않는다(verifyAll).
 *
 * 순수 모듈 — 의존성 0(검사 컨테이너는 Playwright만 깔린다; agent-inspection.ts와 같은 방식으로 dist를 복사해 쓴다).
 * LLM 출력(판정)은 외부 경계라 parseV2Verdict가 엄격히 검사한다(Zod 대신 손 검사 — 컨테이너에 Zod 없음).
 * v1(agent-inspection.ts)의 판정 경로는 건드리지 않는다(V-8: v2는 `engine:"agent_v2"` 장비 키 전용).
 */

export const ARTIFACT_KINDS = ["request", "storage", "source", "screen", "console", "diff", "context"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** 종류별로 검증기가 읽는 사실 — 드라이버가 채운다(S4). 모르는 칸은 비운다. */
export interface ArtifactMeta {
  /** request */
  method?: string;
  status?: number;
  url?: string;
  /** storage · diff: 조작 전과 달라졌는가 */
  changed?: boolean;
  area?: "local" | "session" | "indexeddb" | "cookie";
  /** screen: 같은 브라우저 / 새 브라우저(다른 손님) / 다른 역할(관리자) */
  session?: "same" | "fresh" | "role";
  /** 독립 재실행에서 다시 얻은 증거물이면 원래 증거물 id */
  reproOf?: string;
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  /** 저장소에 들어온 순서(단조 증가) — 시각 대신 순서를 쓴다(테스트 결정론). */
  seq: number;
  summary: string;
  raw: string;
  meta: ArtifactMeta;
}

export interface EvidenceStore {
  /** 증거물을 넣고 id를 돌려준다. 상한을 넘으면 null(넣지 않음). */
  add(kind: ArtifactKind | string, summary: string, raw: string, meta?: ArtifactMeta): string | null;
  get(id: string): Artifact | undefined;
  list(): readonly Artifact[];
  toJSON(): { artifacts: Artifact[]; truncated: boolean };
}

export interface EvidenceStoreOptions {
  /** 원문 상한(글자). 기본 4000. */
  maxRaw?: number;
  /** 증거물 수 상한. 기본 500. */
  maxArtifacts?: number;
  /** 저장 전에 모든 글자를 거치는 가림 함수(비밀·개인정보). */
  redact?: (text: string) => string;
}

const SUMMARY_MAX = 240;

export function createEvidenceStore(opts: EvidenceStoreOptions = {}): EvidenceStore {
  const maxRaw = opts.maxRaw ?? 4000;
  const maxArtifacts = opts.maxArtifacts ?? 500;
  const redact = opts.redact ?? ((t: string) => t);
  const items: Artifact[] = [];
  const byId = new Map<string, Artifact>();
  let truncated = false;
  return {
    add(kind, summary, raw, meta = {}) {
      if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown_artifact_kind:${kind}`);
      if (items.length >= maxArtifacts) {
        truncated = true;
        return null;
      }
      const id = `E${items.length + 1}`;
      const a: Artifact = {
        id,
        kind: kind as ArtifactKind,
        seq: items.length + 1,
        summary: redact(String(summary ?? "")).slice(0, SUMMARY_MAX),
        raw: redact(String(raw ?? "")).slice(0, maxRaw),
        meta: { ...meta },
      };
      items.push(a);
      byId.set(id, a);
      return id;
    },
    get: (id) => byId.get(id),
    list: () => items,
    toJSON: () => ({ artifacts: items.map((a) => ({ ...a, meta: { ...a.meta } })), truncated }),
  };
}

/** V-2: 이 증거물이 "상태가 바뀌었다"를 보여 주는가. */
export function isStateChangeArtifact(a: Artifact | undefined): boolean {
  if (!a) return false;
  const m = a.meta ?? {};
  switch (a.kind) {
    case "request": {
      const method = String(m.method ?? "").toUpperCase();
      const status = Number(m.status);
      return ["POST", "PUT", "PATCH", "DELETE"].includes(method) && status >= 200 && status < 300;
    }
    case "storage":
    case "diff":
      return m.changed === true;
    case "screen":
      // 다른 브라우저(다른 손님)·다른 역할 화면에서 관찰 = 그 기록이 밖에서도 보인다는 증거.
      return m.session === "fresh" || m.session === "role";
    default:
      return false;
  }
}

export const V2_VERDICTS = ["pass", "fail", "not_verified", "mismatch"] as const;
export type V2VerdictKind = (typeof V2_VERDICTS)[number];

export interface V2Verdict {
  acId: string;
  verdict: V2VerdictKind;
  /** 한 문장 주장 */
  claim: string;
  /** 판정 근거 증거물 id */
  artifactIds: string[];
  /** fail의 독립 재실행 증거물 id(V-3) */
  reproArtifactIds?: string[];
  /** 증거물 원문에 그대로 있어야 하는 짧은 인용(핵심 값) — 1개 이상 */
  quotes: string[];
}

const ID_RE = /^E[1-9]\d{0,4}$/;
const MAX_IDS = 20;
const MAX_QUOTES = 6;
const QUOTE_MAX = 200;

/** LLM이 낸 판정 JSON을 엄격히 읽는다. 형식이 하나라도 어긋나면 거절(판정 없음). */
export function parseV2Verdict(raw: unknown): { ok: true; verdict: V2Verdict } | { ok: false; error: string } {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, error: "no_json_object" };
    try {
      obj = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { ok: false, error: "not_object" };
  const o = obj as Record<string, unknown>;
  const acId = typeof o["acId"] === "string" ? o["acId"].trim() : "";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(acId)) return { ok: false, error: "bad_ac_id" };
  const verdict = o["verdict"];
  if (typeof verdict !== "string" || !(V2_VERDICTS as readonly string[]).includes(verdict)) return { ok: false, error: "bad_verdict" };
  const claim = typeof o["claim"] === "string" ? o["claim"].trim().slice(0, 400) : "";
  if (!claim) return { ok: false, error: "missing_claim" };
  const ids = (k: string): string[] | null => {
    const v = o[k];
    if (v === undefined) return k === "reproArtifactIds" ? [] : null;
    if (!Array.isArray(v) || v.length > MAX_IDS || !v.every((x) => typeof x === "string" && ID_RE.test(x))) return null;
    return [...new Set(v as string[])];
  };
  const artifactIds = ids("artifactIds");
  if (artifactIds === null) return { ok: false, error: "bad_artifact_ids" };
  const reproArtifactIds = ids("reproArtifactIds");
  if (reproArtifactIds === null) return { ok: false, error: "bad_repro_artifact_ids" };
  const q = o["quotes"];
  if (!Array.isArray(q) || q.length > MAX_QUOTES || !q.every((x) => typeof x === "string")) return { ok: false, error: "bad_quotes" };
  const quotes = (q as string[]).map((x) => x.trim().slice(0, QUOTE_MAX)).filter(Boolean);
  if (verdict !== "not_verified" && quotes.length === 0) return { ok: false, error: "missing_quotes" };
  return { ok: true, verdict: { acId, verdict: verdict as V2VerdictKind, claim, artifactIds, ...(reproArtifactIds.length ? { reproArtifactIds } : {}), quotes } };
}

export type DowngradeReason =
  | "no_artifacts"
  | "unknown_artifact"
  | "no_quotes"
  | "quote_not_in_artifacts"
  | "pass_without_state_change"
  | "pass_quotes_only_initial_screen"
  /** 실행기 재실행(확인 V)에서 pass의 인용이 다시 나오지 않음 — 실행기가 붙인다 */
  | "pass_not_reproduced"
  /** 마감 − 단위를 마지막 시작 칸으로 둔 앱을 실패로 읽음(v2-judge) — 실행기가 붙인다 */
  | "closing_slot_interpretation"
  | "fail_not_reproduced"
  | "mismatch_without_observation"
  | "mismatch_not_reproduced";

/** 앱이 실제로 그렇게 동작했다는 관찰 종류(V-7: 코드·메모만으로 "생각과 달라요"를 내지 않는다). */
const OBSERVED_KINDS: ReadonlySet<ArtifactKind> = new Set(["request", "screen", "diff", "storage", "console"]);

export interface VerifyOptions {
  /** 기준 시작 화면 증거물 — pass 인용이 전부 여기 이미 있던 글자(소개 문구)면 강등(S5). */
  baselineIds?: readonly string[];
}

export interface VerifiedVerdict extends V2Verdict {
  /** 검증기가 강등했으면 원래 판정 */
  originalVerdict?: V2VerdictKind;
  /** 강등 사유(통과면 빈 배열) */
  reasons: DowngradeReason[];
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

function quotesFoundIn(quotes: readonly string[], arts: readonly Artifact[]): boolean {
  const hay = arts.map((a) => norm(`${a.summary}\n${a.raw}`));
  return quotes.every((q) => hay.some((h) => h.includes(norm(q))));
}

/** 판정 하나를 기계로 검증한다. 통과하지 못하면 not_verified로 강등하고 사유를 남긴다. */
export function verifyVerdict(v: V2Verdict, store: Pick<EvidenceStore, "get">, opts: VerifyOptions = {}): VerifiedVerdict {
  if (v.verdict === "not_verified") return { ...v, reasons: [] };
  const reasons: DowngradeReason[] = [];
  if (v.artifactIds.length === 0) reasons.push("no_artifacts");
  const arts = v.artifactIds.map((id) => store.get(id));
  if (arts.some((a) => !a)) reasons.push("unknown_artifact");
  const found = arts.filter((a): a is Artifact => Boolean(a));
  if (v.quotes.length === 0) reasons.push("no_quotes");
  else if (found.length > 0 && !quotesFoundIn(v.quotes, found)) reasons.push("quote_not_in_artifacts");
  if (v.verdict === "pass" && !found.some(isStateChangeArtifact)) reasons.push("pass_without_state_change");
  if (v.verdict === "pass" && opts.baselineIds?.length && v.quotes.length > 0) {
    const baseline = opts.baselineIds.map((id) => store.get(id)).filter((a): a is Artifact => Boolean(a));
    if (baseline.length > 0 && v.quotes.every((q) => quotesFoundIn([q], baseline))) reasons.push("pass_quotes_only_initial_screen");
  }
  if (v.verdict === "mismatch" && found.length > 0 && !found.some((a) => OBSERVED_KINDS.has(a.kind))) reasons.push("mismatch_without_observation");
  if (v.verdict === "fail" || v.verdict === "mismatch") {
    const repro = (v.reproArtifactIds ?? []).filter((id) => !v.artifactIds.includes(id)).map((id) => store.get(id));
    const reproFound = repro.filter((a): a is Artifact => Boolean(a));
    if (reproFound.length === 0 || v.quotes.length === 0 || !quotesFoundIn(v.quotes, reproFound)) reasons.push(v.verdict === "fail" ? "fail_not_reproduced" : "mismatch_not_reproduced");
  }
  if (reasons.length === 0) return { ...v, reasons };
  return { ...v, verdict: "not_verified", originalVerdict: v.verdict, reasons: [...new Set(reasons)] };
}

/** 판정 묶음 검증 — 통과분만 리포트에 오른다(설계 §2.1 "검증기를 통과하지 못한 판정은 리포트에 오르지 않는다"). */
export function verifyAll(verdicts: readonly V2Verdict[], store: Pick<EvidenceStore, "get">): { accepted: VerifiedVerdict[]; downgraded: VerifiedVerdict[] } {
  const accepted: VerifiedVerdict[] = [];
  const downgraded: VerifiedVerdict[] = [];
  for (const v of verdicts) {
    const r = verifyVerdict(v, store);
    (r.reasons.length ? downgraded : accepted).push(r);
  }
  return { accepted, downgraded };
}
