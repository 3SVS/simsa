/**
 * simsa-landing dictionary — EN + KO, same key shape (parity-tested).
 *
 * Non-developer language rules (same as the dashboard):
 *   acceptance → 확인 · repo → 코드 저장소 · PRD → 기획서 · PR → 코드 변경(PR).
 * Tone: open-beta invite — calm, early-member, no launch hype.
 *
 * Pure ESM (no React) so `node --test` can import it directly.
 */

/** localStorage key for the visitor's manual language choice. */
export const LANG_STORAGE_KEY = "simsa:landing-lang";

/**
 * Resolve the language to show. Pure + deterministic:
 *   stored choice ("en"|"ko") > browser language (ko* → ko) > "en".
 * @param {{ stored?: string | null, navigatorLanguage?: string | null }} input
 * @returns {"en" | "ko"}
 */
export function resolveInitialLang(input) {
  const { stored, navigatorLanguage } = input ?? {};
  if (stored === "en" || stored === "ko") return stored;
  const nav = typeof navigatorLanguage === "string" ? navigatorLanguage.toLowerCase() : "";
  if (nav === "ko" || nav.startsWith("ko-")) return "ko";
  return "en";
}

export const LANDING_DICT = {
  en: {
    langToggle: "한국어",
    hero: {
      wordmark: "Simsa",
      headline: "Built an app with AI? Make sure it actually works.",
      subline: "From fast AI-built drafts to product work you can trust.",
      lede:
        "AI coding tools can build a first version fast. Simsa checks whether that result does what you asked — and helps you decide what to accept, fix, or run again, with evidence.",
      betaNote:
        "Simsa is in open beta — everything is free while we build it out. You'd be one of the early members, and what you run shapes what it becomes.",
      ctaStart: "Start free — open beta",
      ctaDemo: "View demo",
    },
    startAnything: {
      title: "Start from anything",
      body:
        "Bring an idea, a product brief, a product link, a code home (GitHub), a submitted code change, or an AI-built app. Simsa turns it into a step-by-step checking flow.",
      chips: ["Idea", "Product brief", "Product link", "Code home (GitHub)", "Code change (PR)", "AI-built app"],
    },
    creates: {
      title: "What Simsa gives you",
      body:
        "Left alone, AI-built output stays at \"it seems to work.\" Simsa turns it into results you can check, compare, and stand behind.",
      outputs: [
        "A clear picture of your product",
        "Checking items (what \"done\" means)",
        "A step-by-step plan",
        "Evidence for every check",
        "Accept / fix / re-run decisions",
        "Ready-to-ship status",
      ],
    },
    workflow: {
      title: "How a check runs",
      steps: [
        { title: "See what you have.", sub: "An idea, a brief, code, or an AI-built draft." },
        { title: "Turn it into checking items.", sub: "The things the result has to get right." },
        { title: "Check the result against them.", sub: "With evidence, not gut feeling." },
        { title: "Decide: accept, fix, or run again.", sub: "Compare runs and choose." },
        { title: "Keep the evidence and history.", sub: "So every decision stays reviewable." },
      ],
    },
    forWhom: {
      title: "For everyone building with AI",
      body:
        "You don't need to be a developer. Founders, planners, and teams use Simsa to put a checking layer on top of fast AI-built drafts — so you can tell what's actually ready.",
      contactLead: "For partnership inquiries, contact the team.",
    },
    joinBeta: {
      title: "Join the open beta",
      p1:
        "No waitlist, no invite code — bring an idea, a brief, or an AI-built app and start checking it today. Everything is free during the beta.",
      p2:
        "Being early matters here: the checks beta members run are what teach Simsa which failures actually happen in AI-built apps. If something feels off or missing, tell us — we read every note.",
      ctaStart: "Start free — open beta",
      ctaFeedback: "Send beta feedback",
    },
    faq: {
      title: "Common questions",
      items: [
        { q: "Is it free?", a: "Yes — Simsa is free during the open beta. No card, no limits beyond a light daily cap." },
        { q: "How is my data handled?", a: "Your work stays in your browser and your account. Reviews are only kept if you opt in, under an anonymized ID — we share patterns, never people." },
        { q: "Which AI tools does it support?", a: "Anything you built with — Lovable, v0, Bolt, Cursor, Claude Code, Replit, Windsurf, and more. You can also just paste a plan or connect a GitHub repo." },
        { q: "Do I need to know how to code?", a: "No. Simsa is built for non-developers — describe what your app should do in plain language and it checks the result for you." },
        { q: "How do I get in touch?", a: "Use the in-app feedback button (bug, question, or idea) — we read every note." },
      ],
    },
    footer: {
      demo: "Demo",
      privacy: "Privacy",
      terms: "Terms",
      contact: "Contact",
      tag: "The checking layer for AI-built apps.",
    },
  },
  ko: {
    langToggle: "English",
    hero: {
      wordmark: "Simsa",
      headline: "AI로 만든 앱, 제대로 작동하는지 확인하세요.",
      subline: "빠르게 만든 초안을, 믿고 내보낼 수 있는 결과물로.",
      lede:
        "AI 코딩 도구는 첫 버전을 금방 만들어줘요. Simsa는 그 결과물이 요청한 대로 됐는지 확인하고 — 채택할지, 고칠지, 다시 돌릴지를 근거와 함께 결정하도록 도와줘요.",
      betaNote:
        "지금은 오픈 베타예요 — 만들어가는 동안 모든 기능이 무료입니다. 지금 시작하면 초기 멤버가 되고, 여러분이 돌린 확인이 Simsa의 방향을 만들어요.",
      ctaStart: "무료로 시작하기 — 오픈 베타",
      ctaDemo: "데모 보기",
    },
    startAnything: {
      title: "무엇으로든 시작하세요",
      body:
        "아이디어, 기획서, 제품 링크, 코드 저장소(GitHub), 제출된 코드 변경, AI로 만든 앱 — 무엇이든 가져오면 Simsa가 단계별 확인 과정으로 바꿔줘요.",
      chips: ["아이디어", "기획서", "제품 링크", "코드 저장소(GitHub)", "코드 변경(PR)", "AI로 만든 앱"],
    },
    creates: {
      title: "Simsa가 만들어주는 것",
      body:
        "AI가 만든 결과물은 그대로 두면 \"되는 것 같은\" 상태에 머물러요. Simsa는 이를 확인하고, 비교하고, 자신 있게 내보낼 수 있는 결과로 바꿔줘요.",
      outputs: [
        "내 제품에 대한 명확한 정리",
        "확인 항목 (\"완성\"의 기준)",
        "단계별 진행 계획",
        "확인마다 남는 근거",
        "채택 · 수정 · 재확인 결정",
        "내보낼 준비 상태",
      ],
    },
    workflow: {
      title: "확인은 이렇게 진행돼요",
      steps: [
        { title: "지금 있는 것을 파악해요.", sub: "아이디어, 기획서, 코드, AI가 만든 초안." },
        { title: "확인 항목으로 바꿔요.", sub: "결과물이 반드시 맞춰야 할 기준." },
        { title: "결과물을 기준에 맞춰 확인해요.", sub: "감이 아니라 근거로." },
        { title: "채택할지, 고칠지, 다시 돌릴지 정해요.", sub: "실행 결과를 비교해서 선택해요." },
        { title: "근거와 이력을 남겨요.", sub: "모든 결정을 언제든 다시 볼 수 있게." },
      ],
    },
    forWhom: {
      title: "AI로 만드는 모든 사람을 위해",
      body:
        "개발자가 아니어도 괜찮아요. 창업자, 기획자, 팀이 AI로 빠르게 만든 결과물 위에 확인 과정을 얹어 — 무엇이 정말 준비됐는지 알 수 있게 해줘요.",
      contactLead: "제휴 문의는 팀에게 연락해주세요.",
    },
    joinBeta: {
      title: "오픈 베타에 함께하세요",
      p1:
        "대기 명단도 초대 코드도 없어요 — 아이디어든, 기획서든, AI로 만든 앱이든 가져와서 오늘 바로 확인을 시작하세요. 베타 기간에는 전부 무료예요.",
      p2:
        "초기 멤버가 중요한 이유가 있어요: 베타 멤버가 돌린 확인이, AI로 만든 앱에서 실제로 어떤 문제가 생기는지 Simsa에게 가르쳐줘요. 이상하거나 아쉬운 게 있으면 알려주세요 — 모든 메모를 읽습니다.",
      ctaStart: "무료로 시작하기 — 오픈 베타",
      ctaFeedback: "베타 피드백 보내기",
    },
    faq: {
      title: "자주 묻는 질문",
      items: [
        { q: "무료인가요?", a: "네 — 오픈 베타 기간에는 무료예요. 카드도 필요 없고, 가벼운 하루 사용량 제한 외에는 한도도 없어요." },
        { q: "제 데이터는 어떻게 처리되나요?", a: "작업물은 브라우저와 계정 안에 있어요. 확인 결과는 동의하실 때만 익명 ID로 보관돼요 — 패턴은 공유해도 개인은 절대 아니에요." },
        { q: "어떤 AI 도구를 지원하나요?", a: "Lovable, v0, Bolt, Cursor, Claude Code, Replit, Windsurf 등 무엇으로 만드셨든 괜찮아요. 기획서를 붙여넣거나 GitHub 저장소를 연결해도 돼요." },
        { q: "코드를 몰라도 되나요?", a: "네. Simsa는 비개발자를 위해 만들었어요 — 앱이 무엇을 해야 하는지 말로 알려주시면 결과를 대신 확인해드려요." },
        { q: "문의는 어떻게 하나요?", a: "앱 안의 피드백 버튼(버그·질문·제안)을 눌러주세요 — 모든 메모를 읽어요." },
      ],
    },
    footer: {
      demo: "데모",
      privacy: "개인정보 처리방침",
      terms: "이용약관",
      contact: "문의",
      tag: "AI로 만든 앱을 위한 확인 레이어.",
    },
  },
};
