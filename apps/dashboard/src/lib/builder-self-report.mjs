/**
 * builder-self-report.mjs — "만든 AI에게 물어보기"(2026-10-09).
 * 질문 원문은 central-plane src/workspace/builder-self-report.ts BUILDER_SELF_REPORT_PROMPT와 **같아야** 한다(테스트가 대조).
 * 정리된 답은 이 브라우저에만 둔다(서버는 원문을 저장하지 않는다) — 다음 확인 요청에 실려 검사 엔진의 가설이 된다.
 */

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
};

const KEY = (projectId) => `simsa:builder-report:${projectId}`;

export function saveBuilderReport(projectId, report) {
  try {
    window.localStorage.setItem(KEY(projectId), JSON.stringify(report));
  } catch {
    /* 저장 못 해도 화면은 계속 */
  }
}

export function loadBuilderReport(projectId) {
  try {
    const raw = window.localStorage.getItem(KEY(projectId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && Array.isArray(v.claims) ? v : null;
  } catch {
    return null;
  }
}

export const BSR_COPY = {
  ko: {
    title: "만든 AI에게 물어보기 (선택)",
    intro: "앱을 만든 AI(Lovable·Bolt·v0·ChatGPT 등)에게 아래 질문을 그대로 붙여 넣고, 받은 답을 아래 칸에 붙여 주세요. 확인할 거리를 더 정확히 고를 수 있어요. 만든 AI의 말은 그대로 믿지 않고, 실제로 해 보고 맞는지 확인해요.",
    copy: "질문 복사",
    copied: "복사했어요",
    answerLabel: "만든 AI의 답",
    parse: "답 정리하기",
    parsing: "정리하는 중…",
    removed: (n) => `답에 들어 있던 비밀값 ${n}개는 지웠어요(저장하지 않아요).`,
    failed: "답을 정리하지 못했어요. 잠시 뒤 다시 해 주세요.",
    empty: "답이 너무 짧아요. 만든 AI의 답을 그대로 붙여 주세요.",
    understood: "만든 AI의 설명",
    claims: (n) => `확인할 주장 ${n}개 — 이번 확인에서 실제로 맞는지 봐요.`,
    flowsLabel: "만든 AI가 말한 핵심 흐름 — 꼭 되어야 하는 것만 체크해 주세요",
  },
  en: {
    title: "Ask the AI that built it (optional)",
    intro: "Paste the question below into the AI that built your app (Lovable, Bolt, v0, ChatGPT…), then paste its answer here. It helps us choose what to check. We don't take its word for it — we try each thing and check.",
    copy: "Copy question",
    copied: "Copied",
    answerLabel: "The builder's answer",
    parse: "Organize the answer",
    parsing: "Organizing…",
    removed: (n) => `We removed ${n} secret value(s) found in the answer (not stored).`,
    failed: "We couldn't organize the answer. Please try again shortly.",
    empty: "The answer is too short. Paste the builder's answer as it is.",
    understood: "What the builder says",
    claims: (n) => `${n} claim(s) to verify — we'll check whether each is actually true.`,
    flowsLabel: "Core flows the builder mentioned — check only the ones that must work",
  },
};
