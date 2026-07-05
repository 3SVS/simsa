/**
 * Workspace generation — calls Anthropic to produce a structured
 * idea-to-spec draft. Falls back to inline mock data on any failure
 * so the user-facing flow never breaks.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdeaToSpecDraftRequest = {
  idea: string;
  mode?: "quick" | "standard" | "thorough";
  answers?: Array<{ questionId: string; answer: string }>;
  locale?: "ko" | "en";
};

export type Question = {
  id: string;
  question: string;
  recommendation: string;
  reason: string;
  options: string[];
  allowCustom: boolean;
  allowLater: boolean;
};

export type ProductSpec = {
  productName: string;
  oneLine: string;
  targetUsers: string[];
  problem: string;
  included: string[];
  excluded: string[];
  userFlow: string[];
  decisions: string[];
  openQuestions: string[];
};

export type RequirementItem = {
  id: string;
  title: string;
  status: "not_started";
  criteria: string[];
};

export type IdeaToSpecDraftResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  understood: {
    summary: string;
    targetUsers: string[];
    mainFlow: string[];
  };
  questions: Question[];
  productSpec: ProductSpec;
  items: RequirementItem[];
  warnings?: string[];
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SCHEMA_DESCRIPTION = `{
  "understood": {
    "summary": "한 문장 요약 (일반 유저용 언어)",
    "targetUsers": ["주요 사용자 유형 1", "..."],
    "mainFlow": ["1. 첫 번째 단계", "2. 두 번째 단계", "..."]
  },
  "questions": [
    {
      "id": "q1",
      "question": "아이디어에 맞는 구체적 질문",
      "recommendation": "추천 답변 (짧게)",
      "reason": "추천 이유 (1~2문장, 일반 유저용 언어)",
      "options": ["선택지 1", "선택지 2", "선택지 3"],
      "allowCustom": true,
      "allowLater": true
    }
  ],
  "productSpec": {
    "productName": "제품 이름",
    "oneLine": "한 줄 설명",
    "targetUsers": ["누가 쓰는지"],
    "problem": "해결하려는 문제 (1~2문장)",
    "included": ["이번 버전에 포함할 기능"],
    "excluded": ["이번 버전에서 제외할 것"],
    "userFlow": ["1. 사용자 흐름 단계"],
    "decisions": ["질문 답변에 따라 결정된 사항"],
    "openQuestions": ["아직 결정이 필요한 것"]
  },
  "items": [
    {
      "id": "req_001",
      "title": "꼭 들어가야 할 것 (주어+서술어 형태)",
      "status": "not_started",
      "criteria": ["완성 기준 1", "완성 기준 2"]
    }
  ]
}`;

const SCHEMA_DESCRIPTION_EN = `{
  "understood": {
    "summary": "one-sentence summary (plain language)",
    "targetUsers": ["primary user type 1", "..."],
    "mainFlow": ["1. first step", "2. second step", "..."]
  },
  "questions": [
    {
      "id": "q1",
      "question": "a concrete question tailored to the idea",
      "recommendation": "recommended answer (short)",
      "reason": "why recommended (1-2 sentences, plain language)",
      "options": ["option 1", "option 2", "option 3"],
      "allowCustom": true,
      "allowLater": true
    }
  ],
  "productSpec": {
    "productName": "product name",
    "oneLine": "one-line description",
    "targetUsers": ["who uses it"],
    "problem": "the problem it solves (1-2 sentences)",
    "included": ["features in this version"],
    "excluded": ["out of scope for this version"],
    "userFlow": ["1. user flow step"],
    "decisions": ["decisions made from the answers"],
    "openQuestions": ["things still to decide"]
  },
  "items": [
    {
      "id": "req_001",
      "title": "a must-have item (subject + verb form)",
      "status": "not_started",
      "criteria": ["acceptance criterion 1", "acceptance criterion 2"]
    }
  ]
}`;

function buildPrompt(req: IdeaToSpecDraftRequest): string {
  // English-first product: generate in English unless the caller asks for Korean.
  if (req.locale === "ko") {
    const answersText =
      req.answers && req.answers.length > 0
        ? `\n사용자 답변:\n${req.answers.map((a) => `- ${a.questionId}: ${a.answer}`).join("\n")}`
        : "";
    return `사용자가 만들고 싶은 제품 아이디어가 있습니다. 이 아이디어를 바탕으로 구조화된 제품 설명서를 한국어로 만들어주세요.

아이디어: ${req.idea}${answersText}

다음 규칙을 반드시 따르세요:
- 모든 사용자 대상 텍스트는 자연스러운 한국어로 작성
- PRD, Requirement, Acceptance Criteria, FAIL, INCONCLUSIVE 같은 개발자 용어 사용 금지
- 질문은 이 아이디어에 맞춤형으로 3~5개만 생성 (단순 템플릿 반복 금지)
- 좋은 질문: 답변에 따라 실제 제품이 달라지는 것 (구현 범위, 사용자 흐름, 데이터 보관, 권한, 외부 연동)
- 나쁜 질문: "장기 비전은?", "사용자 경험은 어떤 느낌?" 같은 추상적 질문
- 꼭 들어가야 할 항목은 8~10개, 각 항목마다 완성 기준 2~4개
- 완성 기준은 확인 가능한 구체적 동작으로 작성

다음 JSON 형식으로만 응답하세요. 마크다운 코드블록, 설명문 없이 JSON만 반환:

${SCHEMA_DESCRIPTION}`;
  }

  const answersText =
    req.answers && req.answers.length > 0
      ? `\nUser answers:\n${req.answers.map((a) => `- ${a.questionId}: ${a.answer}`).join("\n")}`
      : "";
  return `A user has a product idea they want to build. Based on this idea, create a structured product brief in English.

Idea: ${req.idea}${answersText}

Follow these rules strictly:
- Write all user-facing text in natural, plain English
- Do NOT use developer jargon like PRD, Requirement, Acceptance Criteria, FAIL, INCONCLUSIVE
- Generate only 3-5 questions tailored to this idea (no repetitive templates)
- Good questions change the actual product depending on the answer (scope, user flow, data retention, permissions, integrations)
- Bad questions are abstract ("what's the long-term vision?", "how should the UX feel?")
- Include 8-10 must-have items, each with 2-4 acceptance criteria
- Acceptance criteria must be concrete, verifiable behaviors

Respond ONLY in the following JSON format. No markdown code block, no prose — JSON only:

${SCHEMA_DESCRIPTION_EN}`;
}

// ─── Anthropic fetch ──────────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  prompt: string,
  timeoutMs = 120000, // document-scale prompts (up to 80k chars) need generous time
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const tail = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${tail.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidResponse(v: unknown): v is Omit<IdeaToSpecDraftResponse, "ok" | "source"> {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["understood"] === "object" &&
    Array.isArray((r["understood"] as Record<string, unknown>)["mainFlow"]) &&
    Array.isArray(r["questions"]) &&
    typeof r["productSpec"] === "object" &&
    Array.isArray(r["items"]) &&
    (r["items"] as unknown[]).length >= 3
  );
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

/**
 * Extract intent flags from answers array.
 * Looks for Korean keyword signals in answer text so the fallback
 * output changes meaningfully when the user answers differently.
 */
function extractAnswerFlags(answers: IdeaToSpecDraftRequest["answers"]): {
  confirmBeforeSend: boolean;
  autoSend: boolean;
  editable: boolean;
  deleteAfterProcess: boolean;
} {
  const allText = (answers ?? []).map((a) => a.answer).join(" ").toLowerCase();
  // "확인 없이 자동" / "자동으로 보내도" → autoSend
  // "확인해야" / "확인 후" / "확인하고" → confirmBeforeSend
  // Explicit confirm phrases take precedence; auto phrases dominate when confirm is absent or negated
  const hasExplicitAuto = /자동으로|확인 없이|자동 전송|자동으로 보내/.test(allText);
  const hasExplicitConfirm = /확인해야|확인 후|확인하고|사용자가 확인|검토 후/.test(allText);
  return {
    // Confirm wins over auto only when explicitly stated
    confirmBeforeSend: hasExplicitConfirm || (!hasExplicitAuto && /확인|검토|선택|승인/.test(allText)),
    autoSend: hasExplicitAuto && !hasExplicitConfirm,
    editable: !/수정 불가|읽기 전용|readonly/.test(allText),
    deleteAfterProcess: /삭제|제거/.test(allText) || (!/보관|저장/.test(allText)),
  };
}

function buildMockFallback(req: IdeaToSpecDraftRequest): IdeaToSpecDraftResponse {
  const isMeeting = /회의|녹음|요약|linear|미팅/i.test(req.idea);
  const flags = extractAnswerFlags(req.answers);

  if (isMeeting) {
    const hasAnswers = (req.answers ?? []).length > 0;
    // If answers explicitly say "auto send" → no confirm step; otherwise default to confirm
    const confirmSend = hasAnswers ? flags.confirmBeforeSend || !flags.autoSend : true;
    const editable = flags.editable;

    const sendDecision = confirmSend
      ? "사용자가 확인한 할 일만 Linear로 전송"
      : "처리 완료 후 Linear로 자동 전송 (확인 단계 없음)";
    const sendRisk = confirmSend
      ? undefined
      : "자동 전송 시 잘못 추출된 할 일이 팀 시스템에 바로 들어갈 수 있으므로, 전송 실패 복구 및 되돌리기 기능이 필요합니다.";

    const sendItem: RequirementItem = confirmSend
      ? {
          id: "req_006",
          title: "사용자가 확인하고 선택한 할 일만 Linear로 보내야 함",
          status: "not_started",
          criteria: ["체크한 항목만 전송됨", "전송 후 Linear 이슈 링크 표시", "전송 취소 가능"],
        }
      : {
          id: "req_006",
          title: "처리 완료 후 할 일이 자동으로 Linear로 전송되어야 함",
          status: "not_started",
          criteria: [
            "처리 완료 시 자동 전송됨",
            "전송 실패 시 재시도 또는 수동 전송으로 전환",
            "전송 내역을 사용자가 확인할 수 있음",
          ],
        };

    return {
      ok: true,
      source: "mock-fallback",
      understood: {
        summary:
          "이 제품은 회의 녹음 파일을 업로드하면 자동으로 요약하고 할 일을 업무 도구로 보내는 앱입니다.",
        targetUsers: ["회의가 많은 팀", "PM·운영자", "Linear를 쓰는 스타트업 팀"],
        mainFlow: ["녹음 파일 업로드", "텍스트 변환", "요약 생성", "할 일 추출", "Linear로 전송"],
      },
      questions: [
        {
          id: "q1",
          question: "Linear로 보내기 전에 사용자가 확인하는 단계가 필요할까요?",
          recommendation: "확인 후 보내기",
          reason: "잘못 추출된 할 일이 팀 시스템에 들어가는 것을 막을 수 있습니다.",
          options: ["확인 후 보내기", "자동으로 보내기"],
          allowCustom: true,
          allowLater: true,
        },
        {
          id: "q2",
          question: "회의 녹음 원본은 저장해야 하나요, 요약 후 삭제해야 하나요?",
          recommendation: "요약 후 삭제",
          reason: "불필요한 민감 데이터를 줄이면 보안 위험과 비용이 감소합니다.",
          options: ["요약 후 삭제", "일정 기간 보관", "영구 보관"],
          allowCustom: false,
          allowLater: true,
        },
        {
          id: "q3",
          question: "잘못 추출된 할 일을 사용자가 수정할 수 있어야 하나요?",
          recommendation: "수정 가능하게",
          reason: "수정 기능이 있으면 오탐에 대한 부담이 줄고 신뢰도가 높아집니다.",
          options: ["수정 가능", "삭제만 가능", "수정 불가"],
          allowCustom: false,
          allowLater: true,
        },
      ],
      productSpec: {
        productName: "회의록 자동 요약 앱",
        oneLine: "회의를 녹음하면 요약과 할 일이 자동으로 정리됩니다",
        targetUsers: ["회의가 많은 팀", "Linear를 쓰는 스타트업"],
        problem: "회의 후 내용 정리와 할 일 분배에 시간이 많이 걸립니다.",
        included: [
          "녹음 파일 업로드",
          "STT 변환",
          "요약 생성 (결정사항·할 일 구분)",
          "할 일 추출",
          confirmSend ? "사용자 확인 후 Linear 전송" : "처리 완료 후 Linear 자동 전송",
          editable ? "추출된 할 일 수정·삭제" : "추출된 할 일 확인",
        ],
        excluded: ["실시간 녹음", "화상 회의 연동", "번역"],
        userFlow: [
          "파일 업로드",
          "변환·요약 처리",
          editable ? "할 일 확인 및 수정" : "할 일 확인",
          confirmSend ? "보낼 항목 선택 후 Linear 전송" : "자동 Linear 전송",
        ],
        decisions: [
          sendDecision,
          editable ? "할 일 수정·삭제 가능" : "할 일 읽기 전용",
        ],
        openQuestions: [
          "파일 크기 상한선 (예: 500MB)",
          "STT 서비스 선택",
          ...(sendRisk ? [sendRisk] : []),
        ],
      },
      items: [
        { id: "req_001", title: "녹음 파일을 올릴 수 있어야 함", status: "not_started", criteria: ["mp3, m4a, wav 파일 지원", "지원 안 되는 형식은 이유를 알려줌"] },
        { id: "req_002", title: "업로드된 녹음을 텍스트로 바꿔야 함", status: "not_started", criteria: ["변환 중 진행 상태 표시", "변환 실패 시 재시도 가능"] },
        { id: "req_003", title: "회의 내용을 요약해야 함", status: "not_started", criteria: ["결정사항과 할 일이 구분되어 보임", "원문 근거 확인 가능"] },
        { id: "req_004", title: "할 일을 자동으로 추출해야 함", status: "not_started", criteria: ["추출된 할 일이 목록으로 보임"] },
        ...(editable ? [{ id: "req_005", title: "추출된 할 일을 수정하거나 지울 수 있어야 함", status: "not_started" as const, criteria: ["텍스트 수정 가능", "항목 삭제 가능"] }] : []),
        sendItem,
        { id: "req_007", title: "다른 사용자의 회의록은 볼 수 없어야 함", status: "not_started", criteria: ["본인 회의록만 접근 가능"] },
        { id: "req_008", title: "처리 실패 시 다시 시도할 수 있어야 함", status: "not_started", criteria: ["오류 메시지와 재시도 버튼 표시"] },
      ],
      warnings: hasAnswers ? undefined : ["임시 초안입니다. 다시 시도하면 더 맞춤형 결과를 받을 수 있습니다."],
    };
  }

  const shortIdea = req.idea.slice(0, 30).trim();
  // Default to Korean (the route defaults locale to "ko"). English only when the
  // caller explicitly asked for it. This branch is the generic non-meeting draft
  // that a first-time non-dev user hits when the LLM is unavailable.
  if (req.locale === "en") {
    return {
      ok: true,
      source: "mock-fallback",
      understood: {
        summary: `An app that handles ${shortIdea}.`,
        targetUsers: ["General users", "Teams that want to work more efficiently"],
        mainFlow: ["Enter data", "Process automatically", "Review the result", "Send to an external tool"],
      },
      questions: [
        {
          id: "q1",
          question: "Should the user review and confirm the result before it proceeds?",
          recommendation: "Confirm before proceeding",
          reason: "Reviewing an automated result once reduces problems caused by errors.",
          options: ["Confirm before proceeding", "Proceed automatically"],
          allowCustom: true,
          allowLater: true,
        },
        {
          id: "q2",
          question: "How long should processed data be kept?",
          recommendation: "Delete after processing",
          reason: "Keeping less unnecessary data lowers security risk.",
          options: ["Delete after processing", "Keep for a period", "Keep forever"],
          allowCustom: false,
          allowLater: true,
        },
        {
          id: "q3",
          question: "Is this a multi-user service or for personal use?",
          recommendation: "Multi-user",
          reason: "How users are separated changes data isolation, permissions, and billing.",
          options: ["Multi-user (team/org)", "Personal, single user"],
          allowCustom: false,
          allowLater: true,
        },
      ],
      productSpec: {
        productName: shortIdea,
        oneLine: req.idea.slice(0, 60),
        targetUsers: ["General users"],
        problem: "Solves the problem the user described.",
        included: ["Core feature", "Result view", "Status display", "Error handling"],
        excluded: ["Secondary features deferred from the first version"],
        userFlow: ["1. Input or register", "2. Process or request", "3. Review the result", "4. Connect an external service"],
        decisions: [],
        openQuestions: ["Decide the concrete feature scope", "Choose the integration service"],
      },
      items: [
        { id: "req_001", title: "The core feature works end to end", status: "not_started", criteria: ["The main action works correctly", "The expected result appears on screen"] },
        { id: "req_002", title: "Processing status is visible", status: "not_started", criteria: ["A loading or progress indicator shows while processing", "A notification or screen change on completion"] },
        { id: "req_003", title: "The result can be reviewed", status: "not_started", criteria: ["A result list or detail view is shown", "Basic info like date and status is displayed"] },
        { id: "req_004", title: "Results can be exported or shared to an external tool", status: "not_started", criteria: ["An export or integration button is provided", "Success/failure of the send is shown"] },
        { id: "req_005", title: "Other users' data is not visible", status: "not_started", criteria: ["Only the signed-in user's data is shown", "Entering a URL directly cannot access another user's data"] },
        { id: "req_006", title: "Invalid input explains why", status: "not_started", criteria: ["Unsupported formats show a clear message", "Missing required fields show what is missing"] },
        { id: "req_007", title: "Failures can be retried", status: "not_started", criteria: ["An error message and retry button are shown", "The retry result is reflected on the same screen"] },
        { id: "req_008", title: "Past activity can be reviewed", status: "not_started", criteria: ["A history list is provided in date order", "Each record shows its status (done/failed, etc.)"] },
      ],
      warnings: ["This is a quick draft. Try again for a more tailored result."],
    };
  }

  return {
    ok: true,
    source: "mock-fallback",
    understood: {
      summary: `${shortIdea}을(를) 다루는 앱입니다.`,
      targetUsers: ["일반 사용자", "더 효율적으로 일하고 싶은 팀"],
      mainFlow: ["데이터 입력", "자동 처리", "결과 확인", "외부 도구로 전송"],
    },
    questions: [
      {
        id: "q1",
        question: "진행하기 전에 사용자가 결과를 확인하고 승인해야 하나요?",
        recommendation: "진행 전 확인",
        reason: "자동으로 만든 결과를 한 번 확인하면 오류로 인한 문제를 줄일 수 있어요.",
        options: ["진행 전 확인", "자동으로 진행"],
        allowCustom: true,
        allowLater: true,
      },
      {
        id: "q2",
        question: "처리한 데이터는 얼마나 보관해야 하나요?",
        recommendation: "처리 후 삭제",
        reason: "불필요한 데이터를 적게 보관할수록 보안 위험이 낮아져요.",
        options: ["처리 후 삭제", "일정 기간 보관", "계속 보관"],
        allowCustom: false,
        allowLater: true,
      },
      {
        id: "q3",
        question: "여러 사용자가 쓰는 서비스인가요, 개인용인가요?",
        recommendation: "여러 사용자",
        reason: "사용자를 어떻게 구분하느냐에 따라 데이터 분리, 권한, 요금 방식이 달라져요.",
        options: ["여러 사용자(팀/조직)", "개인, 단일 사용자"],
        allowCustom: false,
        allowLater: true,
      },
    ],
    productSpec: {
      productName: shortIdea,
      oneLine: req.idea.slice(0, 60),
      targetUsers: ["일반 사용자"],
      problem: "사용자가 설명한 문제를 해결합니다.",
      included: ["핵심 기능", "결과 보기", "상태 표시", "오류 처리"],
      excluded: ["첫 버전에서는 미루는 부가 기능"],
      userFlow: ["1. 입력 또는 등록", "2. 처리 또는 요청", "3. 결과 확인", "4. 외부 서비스 연결"],
      decisions: [],
      openQuestions: ["구체적인 기능 범위 정하기", "연동할 서비스 선택하기"],
    },
    items: [
      { id: "req_001", title: "핵심 기능이 처음부터 끝까지 동작해야 함", status: "not_started", criteria: ["주요 동작이 정상적으로 작동함", "예상한 결과가 화면에 나타남"] },
      { id: "req_002", title: "처리 상태가 보여야 함", status: "not_started", criteria: ["처리 중에는 로딩/진행 표시가 나타남", "완료 시 알림 또는 화면 전환이 있음"] },
      { id: "req_003", title: "결과를 확인할 수 있어야 함", status: "not_started", criteria: ["결과 목록 또는 상세 화면이 보임", "날짜·상태 같은 기본 정보가 표시됨"] },
      { id: "req_004", title: "결과를 내보내거나 외부 도구로 공유할 수 있어야 함", status: "not_started", criteria: ["내보내기 또는 연동 버튼이 제공됨", "전송 성공/실패가 표시됨"] },
      { id: "req_005", title: "다른 사용자의 데이터가 보이면 안 됨", status: "not_started", criteria: ["로그인한 사용자의 데이터만 보임", "URL을 직접 입력해도 다른 사용자 데이터에 접근할 수 없음"] },
      { id: "req_006", title: "잘못된 입력은 이유를 알려줘야 함", status: "not_started", criteria: ["지원하지 않는 형식은 명확한 안내가 나옴", "필수 항목이 빠지면 무엇이 빠졌는지 표시됨"] },
      { id: "req_007", title: "실패한 작업은 다시 시도할 수 있어야 함", status: "not_started", criteria: ["오류 메시지와 다시 시도 버튼이 표시됨", "다시 시도 결과가 같은 화면에 반영됨"] },
      { id: "req_008", title: "지난 활동을 다시 볼 수 있어야 함", status: "not_started", criteria: ["날짜순 기록 목록이 제공됨", "각 기록의 상태(완료/실패 등)가 표시됨"] },
    ],
    warnings: ["임시 초안입니다. 다시 시도하면 더 맞춤형 결과를 받을 수 있습니다."],
  };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generateIdeaToSpecDraft(
  req: IdeaToSpecDraftRequest,
  anthropicApiKey: string | undefined,
): Promise<IdeaToSpecDraftResponse> {
  if (!req.idea?.trim()) {
    return { ...buildMockFallback(req), warnings: ["아이디어를 입력해주세요."] };
  }
  if (!anthropicApiKey) {
    console.warn("[workspace/generate] ANTHROPIC_API_KEY not set — using mock fallback");
    return buildMockFallback(req);
  }

  const prompt = buildPrompt(req);
  let rawText = "";
  try {
    rawText = await callAnthropic(anthropicApiKey, prompt);
  } catch (err) {
    console.error("[workspace/generate] LLM call failed:", err);
    return buildMockFallback(req);
  }

  // Extract JSON — LLM sometimes wraps in code fences despite instructions
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[workspace/generate] LLM returned non-JSON, falling back");
    return buildMockFallback(req);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("[workspace/generate] JSON parse failed, falling back");
    return buildMockFallback(req);
  }

  if (!isValidResponse(parsed)) {
    console.warn("[workspace/generate] Response failed shape validation, falling back");
    return buildMockFallback(req);
  }

  // Ensure all items have status: "not_started"
  const data = parsed as Omit<IdeaToSpecDraftResponse, "ok" | "source">;
  data.items = data.items.map((item) => ({ ...item, status: "not_started" as const }));

  return { ok: true, source: "llm", ...data };
}
