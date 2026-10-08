/**
 * workspace/builder-self-report.ts — 만든 AI의 자기 설명(Builder self-report, Bae 2026-10-09).
 *
 * 사용자가 앱을 만든 AI에게 아래 질문을 그대로 붙여 넣고, 그 답을 Simsa에 다시 붙여 넣는다. 서버는:
 *   1) 실수로 붙은 비밀(키·토큰·비밀번호)을 지운다(secret-guard + 비밀번호 줄) — 원문은 저장하지 않는다.
 *   2) LLM이 구조로 뽑는다(경계에서 Zod) → (a) 의도·핵심 흐름 후보("맞나요?" 카드 미리 채움, 체크는 여전히 사용자가)
 *      (b) 주장 목록 — 검사 엔진 v2의 가설이 된다(주장은 **증거가 아니다**: V-1/V-2 그대로, 실행으로만 판정)
 *      (c) 접근 힌트(로그인 방법·시험 계정 만드는 법).
 */
import { z } from "zod";
import { redactSecrets } from "@simsa/secret-guard";
import { anthropicEndpoint, anthropicMessages, type LlmUsageSink, type VendorFallback } from "./anthropic-fetch.js";

export const BUILDER_SELF_REPORT_PROMPT = {
  ko: [
    "이 앱을 다른 검수자가 확인하려고 해. 아래를 솔직하게, 빠짐없이 적어 줘.",
    "1) 이 앱이 하려는 일·쓰는 사람·꼭 되어야 하는 핵심 흐름",
    "2) 실제로 동작하는 것과 아직 가짜(예시 데이터·고정 결과·자리표시자)인 것",
    "3) 데이터 저장 위치(서버·DB/브라우저), 결제·외부 API·키 연결 상태",
    "4) 알고 있는 한계·버그·시험 안 해 본 부분",
    "5) 로그인 방법과 시험용 계정을 만드는 방법(비밀번호는 적지 마)",
  ].join("\n"),
  en: [
    "Another reviewer is going to check this app. Answer the following honestly and completely.",
    "1) What the app is for, who uses it, and the core flows that must work",
    "2) What actually works vs. what is still fake (sample data, fixed results, placeholders)",
    "3) Where data is stored (server/database vs. browser), and the state of payments, external APIs and keys",
    "4) Known limits, bugs, and parts you have not tested",
    "5) How to log in and how to create a test account (do not write any password)",
  ].join("\n"),
} as const;

export const SELF_REPORT_MAX_CHARS = 30_000;

/** 비밀 지우기: secret-guard 규칙 + "비밀번호: …" 같은 줄. 지운 개수를 함께 돌려준다(값은 어디에도 남기지 않는다). */
export function scrubSelfReport(text: string): { text: string; removed: number } {
  const base = redactSecrets(String(text ?? "").slice(0, SELF_REPORT_MAX_CHARS));
  let removed = base.findings.length;
  const out = base.text.replace(/((?:비밀\s*번호|패스워드|암호|password|passwd|pwd|pw)\s*[:=：]\s*)(\S+)/gi, (_m, head: string) => {
    removed += 1;
    return `${head}[지움]`;
  });
  return { text: out, removed };
}

export const CLAIM_KINDS = ["works", "fake", "storage", "integration", "limitation", "untested", "login"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

const str = (max: number) => z.string().trim().min(1).max(max);
export const BuilderClaimSchema = z.object({
  id: z.string().regex(/^C\d{1,2}$/),
  kind: z.enum(CLAIM_KINDS),
  /** 만든 AI가 한 말(요약, 사용자 언어). */
  text: str(400),
});
export type BuilderClaim = z.infer<typeof BuilderClaimSchema>;

export const BuilderSelfReportSchema = z.object({
  intent: str(500),
  users: z.array(str(120)).max(8).default([]),
  mustFlows: z.array(str(240)).max(12).default([]),
  claims: z.array(BuilderClaimSchema).max(30).default([]),
  access: z
    .object({
      loginMethod: z.string().trim().max(300).default(""),
      testAccountHow: z.string().trim().max(400).default(""),
    })
    .default({ loginMethod: "", testAccountHow: "" }),
});
export type BuilderSelfReport = z.infer<typeof BuilderSelfReportSchema>;

/** 요청 경계: 런 요청에 실려 오는 파싱된 자기 설명(클라이언트가 보냄) — 같은 스키마로 다시 검사하고 비밀을 다시 지운다. */
export function sanitizeBuilderReport(raw: unknown): BuilderSelfReport | null {
  const parsed = BuilderSelfReportSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = (t: string) => scrubSelfReport(t).text;
  const r = parsed.data;
  return {
    intent: s(r.intent),
    users: r.users.map(s),
    mustFlows: r.mustFlows.map(s),
    claims: r.claims.map((c) => ({ ...c, text: s(c.text) })),
    access: { loginMethod: s(r.access.loginMethod), testAccountHow: s(r.access.testAccountHow) },
  };
}

export function selfReportExtractionPrompt(scrubbed: string, locale: "ko" | "en"): string {
  const lang = locale === "en" ? "English" : "Korean (한국어)";
  return `Below is what the AI that BUILT an app says about it (pasted by the app's owner). Extract it into JSON. Do not judge or add anything the text does not say; keep the builder's claims as claims.

Fields:
- intent: one sentence — what the app is for and for whom.
- users: who uses it (short).
- mustFlows: the core flows that must work, one short sentence each (only ones the text states).
- claims: every concrete statement about the app's real state, one per item, id "C1","C2",…, kind one of:
  works (says X actually works), fake (says X is sample/fixed/placeholder), storage (where data is stored),
  integration (payments/external API/keys connected or not), limitation (known limit/bug), untested (not tested), login (how login/test accounts work).
- access: loginMethod (how to log in), testAccountHow (how to create a test account). Never include passwords.
Write values in ${lang}. Reply with ONLY the JSON object.

[Builder's answer]
${scrubbed}`;
}

export type SelfReportResult = { ok: true; report: BuilderSelfReport; removedSecrets: number } | { ok: false; error: "empty" | "llm_unavailable" | "unparseable"; removedSecrets: number };

/** 붙여 넣은 답 → 비밀 지우기 → LLM 추출 → Zod. 실패는 정직하게(지어낸 구조 없음). */
export async function parseBuilderSelfReport(
  text: string,
  locale: "ko" | "en",
  apiKey: string | undefined,
  baseUrl?: string,
  fallback?: VendorFallback,
  onUsage?: LlmUsageSink,
): Promise<SelfReportResult> {
  const { text: scrubbed, removed } = scrubSelfReport(text);
  if (scrubbed.trim().length < 20) return { ok: false, error: "empty", removedSecrets: removed };
  if (!apiKey && !fallback) return { ok: false, error: "llm_unavailable", removedSecrets: removed };
  let raw = "";
  try {
    const data = (await anthropicMessages(
      apiKey ?? "",
      { model: "claude-haiku-4-5-20251001", max_tokens: 3000, messages: [{ role: "user", content: selfReportExtractionPrompt(scrubbed, locale) }] },
      30_000,
      undefined,
      anthropicEndpoint(baseUrl),
      "builder-self-report",
      { fallback, onUsage },
    )) as { content?: Array<{ type: string; text?: string }> };
    raw = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
  } catch {
    return { ok: false, error: "llm_unavailable", removedSecrets: removed };
  }
  const m = /\{[\s\S]*\}/.exec(raw);
  let json: unknown = null;
  try {
    json = m ? JSON.parse(m[0]) : null;
  } catch {
    json = null;
  }
  const report = sanitizeBuilderReport(json);
  if (!report) return { ok: false, error: "unparseable", removedSecrets: removed };
  return { ok: true, report, removedSecrets: removed };
}
