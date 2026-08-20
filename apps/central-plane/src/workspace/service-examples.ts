/**
 * workspace/service-examples.ts
 *
 * D12 (P3, 2026-07-17 target-fit eval): need-based service walkthroughs for the
 * builder pack's beginner guidance. The eval measured Vercel+Supabase as the
 * ONLY worked examples in 10/10 packs regardless of what the idea needed — this
 * registry picks extra walkthroughs deterministically from what the spec
 * actually asks for (email/payment/maps/sms/uploads).
 *
 * D14 seam: this file is the SINGLE place a future deploy/service trend watcher
 * (changelog-monitor rails) updates when a platform ships an easier path — e.g.
 * a new drag-and-drop deploy. Guidance freshness lives here, not scattered
 * through prompt strings. Keep every block in the same shape: **서비스 (용도)**:
 * 가입 URL → 키를 찾는 정확한 위치 → 붙여넣을 곳.
 */

/** G14-b: guidance language. KO output is byte-identical to pre-locale code. */
export type GuideLocale = "ko" | "en";

/**
 * 스택 불가지 Phase 2 (D-1~D-4 LOCKED 2026-08-20): 유저가 답한 조합 축.
 * export.ts의 ExportUserProfile에서 온다. id 미지정/"unknown" = 중립 산출물
 * (특정 벤더를 조용히 가정하지 않는다 — D-2), "other"는 자유텍스트 이름을
 * 그대로 안내에 쓴다(D-3).
 */
export type StackAxes = {
  hosting?: string;
  hostingOther?: string;
  data?: string;
  dataOther?: string;
};

export type ServiceExampleNeed = {
  key: string;
  /** Deterministic matcher over the spec text (included/items/idea). */
  re: RegExp;
  /** One walkthrough bullet, beginner hand-holding style. */
  block: string;
  /** EN twin of `block`. Korea-only services swap to the international
   *  equivalent (Toss→Stripe, KakaoMap→Google Maps) — a faithful translation
   *  would send an EN user to a KR-gated signup. */
  blockEn: string;
};

/** Always-included walkthroughs: data (Supabase) + the deploy-path chooser. */
export const BASE_SERVICE_EXAMPLE_BLOCKS: string[] = [
  "- **Supabase (데이터베이스)**: https://supabase.com 가입 → `New project` 생성 → 왼쪽 하단 `Project Settings`(톱니바퀴) → `API` → `Project URL`과 `anon public` 키를 복사. 관리자 키가 필요하면 `API Keys` 탭 → `service_role` → `Reveal` 클릭 → 복사. **`service_role` 키는 관리자용이라 절대 프론트엔드/브라우저에 넣지 말라고 사용자에게 경고**하고, 서버 환경변수로만 쓰게 한다.",
];

export const BASE_SERVICE_EXAMPLE_BLOCKS_EN: string[] = [
  "- **Supabase (database)**: sign up at https://supabase.com → create a `New project` → bottom-left `Project Settings` (gear) → `API` → copy the `Project URL` and the `anon public` key. If an admin key is needed: `API Keys` tab → `service_role` → click `Reveal` → copy. **Warn the user that the `service_role` key is admin-only and must NEVER go into frontend/browser code** — server-side environment variables only.",
];

// ─── 스택 불가지 Phase 2: 데이터 축 어댑터 ──────────────────────────────────
// data 축이 답해진 조합에는 그 서비스의 워크스루를, 미응답에는 벤더를 가정하지
// 않는 물음-먼저 안내를 넣는다(D-2). 종전의 "무조건 Supabase" 기본 블록은
// data="supabase"일 때만 나간다.

const FIREBASE_DATA_BLOCK =
  "- **Firebase (데이터베이스)**: https://console.firebase.google.com 에서 프로젝트 만들기 → `프로젝트 설정`(톱니바퀴) → `일반` 탭 아래 `내 앱`에서 웹 앱 등록 → 나오는 `firebaseConfig`의 `apiKey`·`projectId` 등을 복사. Firestore를 쓰면 `빌드 → Firestore Database → 데이터베이스 만들기`(테스트 모드로 시작 가능, 규칙은 나중에 잠그도록 안내). **Admin SDK 키(서비스 계정 JSON)는 서버 전용 — 절대 프론트엔드에 넣지 말라고 경고**한다.";
const FIREBASE_DATA_BLOCK_EN =
  "- **Firebase (database)**: create a project at https://console.firebase.google.com → `Project settings` (gear) → `General` tab, register a web app under `Your apps` → copy `apiKey`, `projectId`, etc. from the shown `firebaseConfig`. For Firestore: `Build → Firestore Database → Create database` (test mode is fine to start; remind them to lock down rules later). **Warn that the Admin SDK key (service-account JSON) is server-only — never in frontend code.**";

const BUILDER_MANAGED_DATA_BLOCK =
  "- **데이터 (빌더 내장)**: 이 사용자의 데이터는 만들던 도구 안에서 관리된다 — 별도 가입이나 키 발급이 필요 없다. 데이터 구조를 바꿀 일이 있으면 그 빌더의 데이터/DB 패널에서 하도록 안내하고, 외부 DB로 옮기자는 제안을 먼저 하지 마라.";
const BUILDER_MANAGED_DATA_BLOCK_EN =
  "- **Data (managed by the builder)**: this user's data lives inside their building tool — no separate signup or keys needed. For schema changes, point them to that builder's data/DB panel, and do not proactively suggest migrating to an external database.";

const NEUTRAL_DATA_CHOOSER_BLOCK =
  "- **데이터 저장(필요해지면)**: 어떤 서비스를 쓸지 정해져 있지 않다 — **먼저 사용자에게 이미 쓰는 데이터 서비스가 있는지 물어라.** 있다면 그 서비스 기준으로(가입 URL → 키 위치 → 붙여넣을 곳 순), 없다면 예: Supabase, Firebase 등에서 하나를 고르게 하고 고른 것을 같은 순서로 안내한다. 특정 서비스를 기본값처럼 단정하지 마라.";
const NEUTRAL_DATA_CHOOSER_BLOCK_EN =
  "- **Data storage (when needed)**: no service has been chosen — **first ask the user whether they already use one.** If yes, guide for that service (signup URL → exactly where the key is → where to paste it); if not, have them pick one (e.g. Supabase, Firebase, or another they prefer) and walk through it in the same order. Never present one vendor as the assumed default.";

function otherDataBlock(name: string, locale: GuideLocale): string {
  return locale === "en"
    ? `- **${name} (the user's data service)**: guide against THIS service — do not swap it for another. Order: its dashboard/console → where the API key or connection string lives → which environment variable to paste it into (admin/secret keys are server-only). If unsure of the exact menu, say so honestly and find it together with the user.`
    : `- **${name} (사용자의 데이터 서비스)**: 다른 서비스로 바꾸지 말고 **이 서비스 기준으로** 안내하라. 순서: 해당 서비스 대시보드/콘솔 → API 키 또는 연결 문자열 위치 → 어떤 환경변수에 붙여넣을지(관리자·시크릿 키는 서버 전용). 정확한 메뉴 위치가 확실치 않으면 솔직히 말하고 사용자와 함께 찾아라.`;
}

/** data 축 → 데이터 워크스루 블록들. 미응답/unknown = 중립(물음-먼저). */
export function dataServiceBlocks(stack: StackAxes | undefined, locale: GuideLocale): string[] {
  const en = locale === "en";
  const id = stack?.data;
  if (id === "supabase") return [...(en ? BASE_SERVICE_EXAMPLE_BLOCKS_EN : BASE_SERVICE_EXAMPLE_BLOCKS)];
  if (id === "firebase") return [en ? FIREBASE_DATA_BLOCK_EN : FIREBASE_DATA_BLOCK];
  if (id === "builder_managed") return [en ? BUILDER_MANAGED_DATA_BLOCK_EN : BUILDER_MANAGED_DATA_BLOCK];
  if (id === "none") return [];
  if (id === "other") {
    const name = stack?.dataOther?.trim();
    return name
      ? [otherDataBlock(name, locale)]
      : [en ? NEUTRAL_DATA_CHOOSER_BLOCK_EN : NEUTRAL_DATA_CHOOSER_BLOCK];
  }
  // 미응답·unknown·미지 id — 벤더를 가정하지 않는다 (D-2).
  return [en ? NEUTRAL_DATA_CHOOSER_BLOCK_EN : NEUTRAL_DATA_CHOOSER_BLOCK];
}

/**
 * D11: the deploy guidance is a PATH CHOICE, not a GitHub mandate. A user who
 * already has GitHub keeps the Vercel path; a user with nothing gets the
 * genuinely easiest current option first (drag-and-drop deploys exist!) or the
 * step-by-step "make a GitHub account first" path — their choice, asked
 * explicitly. (Bae 2026-07-17: "꼭 GitHub 연동을 해야 하는가 — 유동적 안내".)
 */
export const DEPLOY_PATH_GUIDANCE: string = [
  "- **배포 — 사용자 상황에 맞는 길을 먼저 물어라 (GitHub을 강요하지 마라):**",
  "  1. **이미 GitHub 계정·저장소가 있는 사용자**: https://vercel.com 에 GitHub 계정으로 로그인 → `Add New → Project` → 저장소 선택 → `Environment Variables`에 키를 이름 그대로 추가 → `Deploy`. 끝나면 나오는 URL을 사용자에게 알려준다.",
  "  2. **GitHub이 처음인 사용자**: 두 갈래를 쉽게 설명하고 고르게 하라 —",
  "     - **(a) 지금 당장 가장 쉬운 길 (GitHub 없이)**: 로그인·데이터 저장이 없는 정적 앱이라면, 빌드 결과 폴더를 **Netlify Drop**(https://app.netlify.com/drop)에 드래그해서 놓으면 바로 인터넷 주소가 나온다. **Cloudflare Pages 직접 업로드**(dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets)도 같은 방식이다.",
  "     - **(b) 계속 키워갈 길 (GitHub부터)**: ①https://github.com 가입 ②오른쪽 위 `+` → `New repository`로 저장소 만들기 ③코드 올리기(네게 GitHub 도구가 연결돼 있으면 네가 직접 푸시) ④위 1번의 Vercel 경로로 연결. 각 단계를 한 번에 하나씩, '했어요' 확인 후 다음으로.",
  "  3. 로그인·DB 쓰기 같은 **서버 기능이 있는 앱**은 (a)로는 안 된다 — (b) 또는 사용 중인 빌더의 내장 배포를 권하라.",
].join("\n");

export const DEPLOY_PATH_GUIDANCE_EN: string = [
  "- **Deploy — first ask which path fits this user (do NOT force GitHub):**",
  "  1. **User already has a GitHub account/repo**: log in to https://vercel.com with GitHub → `Add New → Project` → pick the repo → add the keys under `Environment Variables` (exact names) → `Deploy`. Give the user the URL that comes out.",
  "  2. **User is new to GitHub**: explain two simple paths and let them choose —",
  "     - **(a) Easiest right now (no GitHub)**: for a static app with no login/data writes, drag the build output folder onto **Netlify Drop** (https://app.netlify.com/drop) and a live URL appears. **Cloudflare Pages direct upload** (dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets) works the same way.",
  "     - **(b) The long-term path (GitHub first)**: ① sign up at https://github.com ② top-right `+` → `New repository` ③ push the code (if you have a GitHub tool connected, push it yourself) ④ connect the repo via path 1 (Vercel). One step at a time, waiting for the user's \"done\" before the next.",
  "  3. An app with **server features** (login, database writes) cannot use (a) — recommend (b) or the builder's built-in deploy.",
].join("\n");

// ─── 스택 불가지 Phase 2: 호스팅 축 어댑터 ──────────────────────────────────

const NETLIFY_DEPLOY_GUIDANCE = [
  "- **배포 — 이 사용자는 Netlify를 쓴다 (답변으로 확인됨). Netlify 기준으로 안내하라:**",
  "  1. https://app.netlify.com 로그인 → `Add new site`. GitHub 저장소가 있으면 `Import an existing project`로 연결, 없으면 빌드 결과 폴더를 **Netlify Drop**(https://app.netlify.com/drop)에 드래그.",
  "  2. 환경변수는 `Site configuration → Environment variables`에 키 이름 그대로 추가 → 재배포. 끝나면 나오는 URL을 사용자에게 알려준다.",
  "  3. 다른 호스팅으로 갈아타자는 제안을 먼저 하지 마라.",
].join("\n");
const NETLIFY_DEPLOY_GUIDANCE_EN = [
  "- **Deploy — this user is on Netlify (confirmed by their answer). Guide for Netlify:**",
  "  1. Log in at https://app.netlify.com → `Add new site`. With a GitHub repo, use `Import an existing project`; without one, drag the build output folder onto **Netlify Drop** (https://app.netlify.com/drop).",
  "  2. Add keys (exact names) under `Site configuration → Environment variables` → redeploy. Give the user the resulting URL.",
  "  3. Do not proactively suggest switching hosts.",
].join("\n");

const BUILDER_HOSTED_DEPLOY_GUIDANCE = [
  "- **배포 — 이 사용자의 앱은 만들던 도구가 직접 호스팅한다 (답변으로 확인됨):**",
  "  1. 배포는 그 빌더의 **Publish/Deploy 버튼**으로 끝난다 — 별도의 호스팅 가입·터미널·git이 필요 없다.",
  "  2. 환경변수·키는 빌더의 설정(Settings/Secrets) 화면에 넣도록 안내한다.",
  "  3. 외부 호스팅으로 옮기자는 제안을 먼저 하지 마라 — 사용자가 원할 때만.",
].join("\n");
const BUILDER_HOSTED_DEPLOY_GUIDANCE_EN = [
  "- **Deploy — this user's app is hosted by their building tool (confirmed by their answer):**",
  "  1. Deploying is that builder's **Publish/Deploy button** — no separate hosting signup, terminal, or git.",
  "  2. Environment variables/keys go in the builder's Settings/Secrets screen.",
  "  3. Do not proactively suggest moving to external hosting — only if the user asks.",
].join("\n");

function otherHostGuidance(name: string, locale: GuideLocale): string {
  return locale === "en"
    ? [
        `- **Deploy — this user hosts on ${name} (their answer). Guide against THAT host, do not swap it:**`,
        `  1. In ${name}'s dashboard: connect/select the project → add the environment variables (exact key names) in its settings → trigger a deploy → give the user the resulting URL.`,
        "  2. If you are unsure of the exact menus, say so honestly and find them together — never fall back to a different host's instructions.",
      ].join("\n")
    : [
        `- **배포 — 이 사용자는 ${name} 에 올린다 (답변으로 확인됨). 그 호스팅 기준으로 안내하고 바꾸자고 하지 마라:**`,
        `  1. ${name} 대시보드에서: 프로젝트 연결/선택 → 설정에서 환경변수(키 이름 그대로) 추가 → 배포 실행 → 나온 URL을 사용자에게 알려준다.`,
        "  2. 정확한 메뉴가 확실치 않으면 솔직히 말하고 함께 찾아라 — 다른 호스팅 안내로 대체하지 마라.",
      ].join("\n");
}

/**
 * #296 Phase 3: when the onboarding interview captured the user's GitHub level,
 * the deploy guidance stops asking and leads with the right path. No answer →
 * the neutral D11 chooser above (unchanged behavior).
 *
 * 스택 불가지 Phase 2: hosting 축이 답해졌으면 그 호스팅 기준 안내가 우선한다
 * (netlify/builder_hosted/other). vercel·미응답·unknown·none_yet은 기존 로직
 * (vercel은 종전 기본 경로가 이미 Vercel 기준).
 */
export function deployPathGuidanceFor(
  githubLevel?: "fluent" | "heard" | "new",
  locale: GuideLocale = "ko",
  stack?: StackAxes,
): string {
  const en = locale === "en";
  if (stack?.hosting === "netlify") return en ? NETLIFY_DEPLOY_GUIDANCE_EN : NETLIFY_DEPLOY_GUIDANCE;
  if (stack?.hosting === "builder_hosted") return en ? BUILDER_HOSTED_DEPLOY_GUIDANCE_EN : BUILDER_HOSTED_DEPLOY_GUIDANCE;
  if (stack?.hosting === "other" && stack.hostingOther?.trim()) {
    return otherHostGuidance(stack.hostingOther.trim(), locale);
  }
  if (locale === "en") {
    if (githubLevel === "fluent") {
      return [
        "- **Deploy — this user is comfortable with GitHub (confirmed in onboarding). Lead with the GitHub path:**",
        "  1. **Default path**: log in to https://vercel.com with GitHub → `Add New → Project` → pick the repo → add the keys under `Environment Variables` (exact names) → `Deploy`. Give the user the resulting URL. (If you have GitHub/Vercel tools connected, push and deploy yourself.)",
        "  2. If they just want a static app (no login/data writes) up fast, mention the shortcut: drag the build folder onto **Netlify Drop** (https://app.netlify.com/drop).",
      ].join("\n");
    }
    if (githubLevel === "new") {
      return [
        "- **Deploy — this user is new to GitHub or has no account (confirmed in onboarding). Don't ask again; start with the no-GitHub path:**",
        "  1. **Easiest right now (no GitHub)**: for a static app with no login/data writes, drag the build output folder onto **Netlify Drop** (https://app.netlify.com/drop) for an instant live URL. **Cloudflare Pages direct upload** (dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets) works the same way.",
        "  2. **The long-term path (GitHub first, only if they want it)**: ① sign up at https://github.com ② top-right `+` → `New repository` ③ push the code (if you have a GitHub tool connected, push it yourself) ④ log in to https://vercel.com with GitHub, connect the repo, `Deploy`. One step at a time, waiting for \"done\" before the next.",
        "  3. An app with **server features** (login, database writes) cannot use path 1 (drag-and-drop) — recommend path 2 or the builder's built-in deploy. Keep the tone \"we'll do it one step at a time\", never \"this is hard\".",
      ].join("\n");
    }
    return DEPLOY_PATH_GUIDANCE_EN;
  }
  if (githubLevel === "fluent") {
    return [
      "- **배포 — 이 사용자는 GitHub에 익숙하다 (온보딩에서 확인됨). GitHub 경로를 기본으로 진행하라:**",
      "  1. **기본 경로**: https://vercel.com 에 GitHub 계정으로 로그인 → `Add New → Project` → 저장소 선택 → `Environment Variables`에 키를 이름 그대로 추가 → `Deploy`. 끝나면 나오는 URL을 사용자에게 알려준다. (네게 GitHub·Vercel 도구가 연결돼 있으면 네가 직접 푸시·배포한다.)",
      "  2. 로그인·데이터 저장이 없는 정적 앱을 빠르게만 올리고 싶어 하면, **Netlify Drop**(https://app.netlify.com/drop)에 빌드 폴더를 끌어다 놓는 지름길도 있다고만 알려준다.",
    ].join("\n");
  }
  if (githubLevel === "new") {
    return [
      "- **배포 — 이 사용자는 GitHub이 처음이거나 계정이 없다 (온보딩에서 확인됨). 계정이 있냐고 되묻지 말고, GitHub 없이 되는 길부터 안내하라:**",
      "  1. **지금 당장 가장 쉬운 길 (GitHub 없이)**: 로그인·데이터 저장이 없는 정적 앱이라면, 빌드 결과 폴더를 **Netlify Drop**(https://app.netlify.com/drop)에 드래그해서 놓으면 바로 인터넷 주소가 나온다. **Cloudflare Pages 직접 업로드**(dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets)도 같은 방식이다.",
      "  2. **계속 키워갈 길 (GitHub부터, 원할 때만)**: ①https://github.com 가입 ②오른쪽 위 `+` → `New repository`로 저장소 만들기 ③코드 올리기(네게 GitHub 도구가 연결돼 있으면 네가 직접 푸시) ④https://vercel.com 에 GitHub 계정으로 로그인해 저장소를 연결하고 `Deploy`. 각 단계를 한 번에 하나씩, '했어요' 확인 후 다음으로.",
      "  3. 로그인·DB 쓰기 같은 **서버 기능이 있는 앱**은 1번(드래그앤드롭)으로는 안 된다 — 2번 또는 사용 중인 빌더의 내장 배포를 권하라. 이때도 '어렵다'가 아니라 '한 단계씩 같이 하면 된다'는 톤을 유지한다.",
    ].join("\n");
  }
  return DEPLOY_PATH_GUIDANCE;
}

/** Need-matched extra walkthroughs. Matchers are parameters — tune freely. */
export const NEED_SERVICE_EXAMPLES: ServiceExampleNeed[] = [
  {
    key: "email",
    re: /이메일|메일\s*(?:발송|전송|알림)|뉴스레터|email|newsletter/i,
    block:
      "- **Resend (이메일 발송)**: https://resend.com 가입 → `API Keys` → `Create API Key` → 복사해 서버 환경변수(`RESEND_API_KEY`)로. 도메인 인증 전에는 `onboarding@resend.dev` 발신으로 테스트할 수 있다고 안내한다.",
    blockEn:
      "- **Resend (sending email)**: sign up at https://resend.com → `API Keys` → `Create API Key` → copy it into a server-side environment variable (`RESEND_API_KEY`). Mention that before domain verification they can test with the `onboarding@resend.dev` sender.",
  },
  {
    key: "payment",
    re: /결제|구매|판매|구독료|유료|checkout|payment|subscription/i,
    block:
      "- **결제 (토스페이먼츠·Stripe)**: 실제 돈이 오가는 기능이므로 **테스트 키로만 구현**하고, 실 결제 전환은 사용자가 사업자 정보 등록을 마친 뒤 별도로 진행하게 안내한다. 토스페이먼츠: https://developers.tosspayments.com 가입 → 테스트 클라이언트/시크릿 키 복사. 시크릿 키는 서버 전용.",
    blockEn:
      "- **Payments (Stripe)**: real money is involved, so **build with test keys only** and tell the user that switching payments live is a separate step after their business details are registered. Stripe: sign up at https://stripe.com → `Developers` → `API keys` → copy the test publishable/secret keys. The secret key is server-only.",
  },
  {
    key: "maps",
    re: /지도|위치\s*(?:표시|기반)|길\s*찾기|근처|\bmaps?\b|location/i,
    block:
      "- **지도 (카카오맵)**: https://developers.kakao.com 가입 → `내 애플리케이션` → 앱 만들기 → `앱 키`에서 JavaScript 키 복사 → 플랫폼에 배포 도메인 등록(등록 안 하면 지도가 안 뜬다는 것까지 안내).",
    blockEn:
      "- **Maps (Google Maps Platform)**: sign in at https://console.cloud.google.com → create a project → `APIs & Services` → enable `Maps JavaScript API` → `Credentials` → `Create credentials → API key` → copy it. Also restrict the key to the deployed domain (and warn that the map won't load on unlisted domains).",
  },
  {
    key: "sms",
    re: /문자|SMS|알림톡|카카오\s*알림|휴대폰\s*알림/i,
    block:
      "- **문자·알림톡 (솔라피 등)**: 발신번호 등록 심사가 필요해 즉시는 안 된다 — 우선 이메일이나 화면 내 알림으로 대체 구현하고, 문자 발송은 발신번호 등록 후 붙이도록 순서를 안내한다.",
    blockEn:
      "- **SMS/text notifications (Twilio etc.)**: sender-number registration and review means this cannot go live instantly — implement email or in-app notifications first, and guide the user to attach SMS after their sender number is approved.",
  },
  {
    key: "uploads",
    re: /사진|이미지\s*(?:업로드|첨부|올리)|파일\s*(?:업로드|첨부)|영수증|photo|upload|attachment/i,
    block:
      "- **파일·사진 업로드 (Supabase Storage)**: 위 Supabase 프로젝트 안에서 해결된다 — `Storage` → `New bucket`(공개 여부 선택) → 코드에선 같은 `Project URL`/`anon` 키 사용. 별도 가입이 필요 없다는 것부터 알려준다.",
    blockEn:
      "- **File/photo uploads (Supabase Storage)**: handled inside the Supabase project above — `Storage` → `New bucket` (choose public or not) → the code uses the same `Project URL`/`anon` key. Start by telling the user no extra signup is needed.",
  },
];

/** uploads 워크스루는 data 축에 붙는다 — Supabase 고정이던 것을 조합별로. */
function uploadsBlockFor(stack: StackAxes | undefined, locale: GuideLocale): string {
  const en = locale === "en";
  const id = stack?.data;
  if (id === "firebase") {
    return en
      ? "- **File/photo uploads (Firebase Storage)**: handled inside the Firebase project above — `Build → Storage → Get started`, then upload from code with the same `firebaseConfig`. Start by telling the user no extra signup is needed."
      : "- **파일·사진 업로드 (Firebase Storage)**: 위 Firebase 프로젝트 안에서 해결된다 — `빌드 → Storage → 시작하기`, 코드에선 같은 `firebaseConfig` 사용. 별도 가입이 필요 없다는 것부터 알려준다.";
  }
  if (id === "builder_managed") {
    return en
      ? "- **File/photo uploads**: use the builder's built-in upload/asset feature — no external storage signup. Only if the builder has none, ask the user before introducing an external service."
      : "- **파일·사진 업로드**: 빌더의 내장 업로드/자산 기능을 쓴다 — 외부 스토리지 가입이 필요 없다. 빌더에 그 기능이 없을 때만, 외부 서비스 도입 전에 사용자에게 먼저 묻는다.";
  }
  if (id === "supabase") {
    const supa = NEED_SERVICE_EXAMPLES.find((n) => n.key === "uploads")!;
    return en ? supa.blockEn : supa.block;
  }
  // other/none/미응답 — 데이터 축과 같은 물음-먼저 원칙.
  return en
    ? "- **File/photo uploads**: use the storage feature of whatever data service the user chose (ask first if none is chosen yet — e.g. Supabase Storage, Firebase Storage, or another they prefer), then guide signup URL → key location → where to paste."
    : "- **파일·사진 업로드**: 사용자가 고른 데이터 서비스의 스토리지 기능을 쓴다(아직 없으면 먼저 물어라 — 예: Supabase Storage, Firebase Storage 등). 이후 가입 URL → 키 위치 → 붙여넣을 곳 순으로 안내한다.";
}

/**
 * Pick the walkthrough blocks for THIS product: data-axis walkthrough + whatever
 * the spec text actually needs + the hosting-axis deploy path. Deterministic,
 * order-stable, no LLM.
 *
 * 스택 불가지 Phase 2: stack 미전달·미응답 = 중립(물음-먼저) — 종전의 무조건
 * Supabase 기본은 data="supabase"일 때만 나간다 (D-2).
 */
export function pickServiceExampleBlocks(
  specText: string,
  githubLevel?: "fluent" | "heard" | "new",
  locale: GuideLocale = "ko",
  stack?: StackAxes,
): string[] {
  const en = locale === "en";
  const blocks = dataServiceBlocks(stack, locale);
  for (const need of NEED_SERVICE_EXAMPLES) {
    if (!need.re.test(specText)) continue;
    if (need.key === "uploads") {
      blocks.push(uploadsBlockFor(stack, locale));
      continue;
    }
    blocks.push(en ? need.blockEn : need.block);
  }
  blocks.push(deployPathGuidanceFor(githubLevel, locale, stack));
  blocks.push(
    en
      ? "- For any other service, guide in the same order: **signup URL → exactly where to find the key → where to paste it**, in full detail."
      : "- 그 외 서비스도 같은 순서로: **가입 URL → 키를 찾는 정확한 위치 → 붙여넣을 곳** 순으로 상세히 안내한다.",
  );
  return blocks;
}
