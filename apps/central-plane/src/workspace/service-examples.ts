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

export type ServiceExampleNeed = {
  key: string;
  /** Deterministic matcher over the spec text (included/items/idea). */
  re: RegExp;
  /** One walkthrough bullet, beginner hand-holding style. */
  block: string;
};

/** Always-included walkthroughs: data (Supabase) + the deploy-path chooser. */
export const BASE_SERVICE_EXAMPLE_BLOCKS: string[] = [
  "- **Supabase (데이터베이스)**: https://supabase.com 가입 → `New project` 생성 → 왼쪽 하단 `Project Settings`(톱니바퀴) → `API` → `Project URL`과 `anon public` 키를 복사. 관리자 키가 필요하면 `API Keys` 탭 → `service_role` → `Reveal` 클릭 → 복사. **`service_role` 키는 관리자용이라 절대 프론트엔드/브라우저에 넣지 말라고 사용자에게 경고**하고, 서버 환경변수로만 쓰게 한다.",
];

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

/**
 * #296 Phase 3: when the onboarding interview captured the user's GitHub level,
 * the deploy guidance stops asking and leads with the right path. No answer →
 * the neutral D11 chooser above (unchanged behavior).
 */
export function deployPathGuidanceFor(githubLevel?: "fluent" | "heard" | "new"): string {
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
  },
  {
    key: "payment",
    re: /결제|구매|판매|구독료|유료|checkout|payment|subscription/i,
    block:
      "- **결제 (토스페이먼츠·Stripe)**: 실제 돈이 오가는 기능이므로 **테스트 키로만 구현**하고, 실 결제 전환은 사용자가 사업자 정보 등록을 마친 뒤 별도로 진행하게 안내한다. 토스페이먼츠: https://developers.tosspayments.com 가입 → 테스트 클라이언트/시크릿 키 복사. 시크릿 키는 서버 전용.",
  },
  {
    key: "maps",
    re: /지도|위치\s*(?:표시|기반)|길\s*찾기|근처|\bmaps?\b|location/i,
    block:
      "- **지도 (카카오맵)**: https://developers.kakao.com 가입 → `내 애플리케이션` → 앱 만들기 → `앱 키`에서 JavaScript 키 복사 → 플랫폼에 배포 도메인 등록(등록 안 하면 지도가 안 뜬다는 것까지 안내).",
  },
  {
    key: "sms",
    re: /문자|SMS|알림톡|카카오\s*알림|휴대폰\s*알림/i,
    block:
      "- **문자·알림톡 (솔라피 등)**: 발신번호 등록 심사가 필요해 즉시는 안 된다 — 우선 이메일이나 화면 내 알림으로 대체 구현하고, 문자 발송은 발신번호 등록 후 붙이도록 순서를 안내한다.",
  },
  {
    key: "uploads",
    re: /사진|이미지\s*(?:업로드|첨부|올리)|파일\s*(?:업로드|첨부)|영수증|photo|upload|attachment/i,
    block:
      "- **파일·사진 업로드 (Supabase Storage)**: 위 Supabase 프로젝트 안에서 해결된다 — `Storage` → `New bucket`(공개 여부 선택) → 코드에선 같은 `Project URL`/`anon` 키 사용. 별도 가입이 필요 없다는 것부터 알려준다.",
  },
];

/**
 * Pick the walkthrough blocks for THIS product: base + whatever the spec text
 * actually needs. Deterministic, order-stable, no LLM.
 */
export function pickServiceExampleBlocks(
  specText: string,
  githubLevel?: "fluent" | "heard" | "new",
): string[] {
  const blocks = [...BASE_SERVICE_EXAMPLE_BLOCKS];
  for (const need of NEED_SERVICE_EXAMPLES) {
    if (need.re.test(specText)) blocks.push(need.block);
  }
  blocks.push(deployPathGuidanceFor(githubLevel));
  blocks.push(
    "- 그 외 서비스도 같은 순서로: **가입 URL → 키를 찾는 정확한 위치 → 붙여넣을 곳** 순으로 상세히 안내한다.",
  );
  return blocks;
}
