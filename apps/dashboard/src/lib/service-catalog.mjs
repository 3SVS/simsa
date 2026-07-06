/**
 * service-catalog.mjs
 *
 * Prep layer P1b-② core: the catalog of external services a non-developer might
 * need, plus a deterministic detector that reads the product spec and suggests
 * which services this project probably requires.
 *
 * Pure + no I/O. The in-Simsa guided setup UI renders these entries, collects
 * the key values IN THE BROWSER, and sends the resulting `services` array to the
 * export API at download time. Values are NEVER persisted server-side (no-store,
 * Rule 3): this module only produces the *shape* (labels, signup URLs, step-by-
 * step key-finding guides, env var descriptions), with `value` left empty for
 * the UI to fill.
 *
 * The output shape mirrors `BuilderPackService` in
 * apps/central-plane/src/workspace/export.ts so a detected+filled service can be
 * passed straight through to the pack .env baking.
 */

/**
 * @typedef {Object} CatalogEnvVar
 * @property {string} key
 * @property {string} description
 * @property {boolean} [secret]   // server-only; never expose to the browser bundle
 * @property {string} [example]   // placeholder shown as a hint, never a real value
 */

/**
 * @typedef {Object} CatalogService
 * @property {string} id
 * @property {string} label
 * @property {string} why           // why a non-dev might need this, one plain sentence
 * @property {string} [setupUrl]
 * @property {string[]} [setupSteps]
 * @property {CatalogEnvVar[]} envVars
 */

/** @type {CatalogService[]} */
export const SERVICE_CATALOG = [
  {
    id: "app-url",
    label: "앱 주소",
    why: "앱이 자기 주소를 알아야 공유 링크·리디렉션이 깨지지 않습니다. 가입 없이 값만 넣으면 됩니다.",
    setupSteps: [
      "가입이 필요 없는 항목입니다.",
      "만드는 동안에는 http://localhost:3000 을 그대로 두세요.",
      "배포한 뒤에는 실제 도메인(예: https://내앱.vercel.app)으로 바꾸면 됩니다.",
    ],
    envVars: [
      {
        key: "NEXT_PUBLIC_APP_URL",
        description:
          "앱이 자기 자신을 가리키는 주소입니다. 공유 링크·리디렉션 등에 쓰입니다. 처음엔 localhost, 배포 후엔 실제 도메인.",
        example: "http://localhost:3000",
      },
    ],
  },
  {
    id: "supabase",
    label: "Supabase (데이터 저장·로그인)",
    why: "회원가입·로그인이나 글·기록 같은 데이터를 저장하려면 데이터베이스가 필요합니다. Supabase는 무료로 시작할 수 있습니다.",
    setupUrl: "https://supabase.com",
    setupSteps: [
      "https://supabase.com 에 접속해 GitHub 계정으로 가입합니다.",
      "New project 를 눌러 프로젝트를 하나 만듭니다(이름·비밀번호·지역 선택).",
      "왼쪽 아래 톱니바퀴(Project Settings) → API 메뉴로 이동합니다.",
      "Project URL 을 복사해 NEXT_PUBLIC_SUPABASE_URL 에 넣습니다.",
      "같은 화면의 anon public 키를 복사해 NEXT_PUBLIC_SUPABASE_ANON_KEY 에 넣습니다.",
      "관리자 기능이 필요하면 Project API keys 에서 service_role 의 Reveal 을 눌러 복사합니다. 이 키는 서버에서만 씁니다.",
    ],
    envVars: [
      {
        key: "NEXT_PUBLIC_SUPABASE_URL",
        description: "Supabase 프로젝트 주소입니다. Project Settings → API 의 Project URL.",
        example: "https://xxxxxxxx.supabase.co",
      },
      {
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        description:
          "브라우저에서 쓰는 공개 키(anon public)입니다. 공개돼도 되는 키라 프론트에 넣어도 됩니다.",
        example: "eyJhbGciOiJI...(공개 anon 키)",
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        description:
          "관리자 권한 키(service_role)입니다. 절대 브라우저/프론트엔드에 넣지 말고 서버에서만 쓰세요.",
        secret: true,
        example: "eyJhbGciOiJI...(service_role · 서버 전용)",
      },
    ],
  },
  {
    id: "resend",
    label: "Resend (이메일 보내기)",
    why: "가입 확인·비밀번호 재설정·알림 메일을 보내려면 이메일 발송 서비스가 필요합니다. Resend는 무료 한도로 시작할 수 있습니다.",
    setupUrl: "https://resend.com",
    setupSteps: [
      "https://resend.com 에 가입합니다(GitHub 계정으로 가능).",
      "왼쪽 메뉴의 API Keys → Create API Key 를 누릅니다.",
      "만들어진 키(re_ 로 시작)를 복사해 RESEND_API_KEY 에 넣습니다. 이 키는 서버에서만 씁니다.",
      "메일을 실제로 보내려면 나중에 도메인 인증이 필요할 수 있습니다(테스트는 인증 없이 가능).",
    ],
    envVars: [
      {
        key: "RESEND_API_KEY",
        description: "이메일을 보낼 때 쓰는 Resend API 키입니다. 서버 전용이라 프론트엔드에 넣지 마세요.",
        secret: true,
        example: "re_xxxxxxxx (서버 전용)",
      },
    ],
  },
  {
    id: "sentry",
    label: "Sentry (오류 추적)",
    why: "앱에서 나는 오류를 자동으로 모아 알려줍니다. 사용자가 겪은 문제를 놓치지 않고 고칠 수 있어요. 무료 한도로 시작할 수 있습니다.",
    setupUrl: "https://sentry.io",
    setupSteps: [
      "https://sentry.io 에 가입하고 프로젝트를 하나 만듭니다(플랫폼은 만드는 앱에 맞게 선택).",
      "프로젝트 설정(Settings) → Client Keys (DSN) 로 이동합니다.",
      "DSN 주소를 복사해 NEXT_PUBLIC_SENTRY_DSN 에 넣습니다. DSN은 공개돼도 되는 값입니다.",
    ],
    envVars: [
      {
        key: "NEXT_PUBLIC_SENTRY_DSN",
        description: "오류를 Sentry로 보내는 주소(DSN)입니다. 공개돼도 되는 값이라 프론트에 넣어도 됩니다.",
        example: "https://xxxx@oyyy.ingest.sentry.io/zzzz",
      },
    ],
  },
];

/** Case-insensitive keyword groups that hint a service is needed. */
const DATA_KEYWORDS = [
  // ko
  "저장",
  "데이터",
  "기록",
  "목록",
  "등록",
  "계정",
  "로그인",
  "회원",
  "가입",
  "댓글",
  "좋아요",
  "업로드",
  "게시",
  "예약",
  "주문",
  "장바구니",
  // en
  "database",
  "data",
  "save",
  "store",
  "record",
  "account",
  "login",
  "sign in",
  "sign up",
  "user",
  "comment",
  "upload",
  "post",
  "order",
  "booking",
];

/**
 * Deep-clone a catalog entry so the UI can attach `value` per env var without
 * mutating the shared catalog.
 * @param {string} id
 * @returns {CatalogService | null}
 */
export function catalogServiceById(id) {
  const found = SERVICE_CATALOG.find((s) => s.id === id);
  if (!found) return null;
  return {
    id: found.id,
    label: found.label,
    why: found.why,
    ...(found.setupUrl ? { setupUrl: found.setupUrl } : {}),
    ...(found.setupSteps ? { setupSteps: [...found.setupSteps] } : {}),
    envVars: found.envVars.map((v) => ({ ...v })),
  };
}

/** Email-sending keywords → Resend. */
const EMAIL_KEYWORDS = ["이메일", "메일", "알림 메일", "발송", "비밀번호 재설정", "인증 메일", "email", "e-mail", "notification email", "verify email", "password reset"];
/** Error-monitoring keywords → Sentry. */
const ERROR_KEYWORDS = ["오류", "에러", "버그", "모니터링", "예외", "error", "bug", "monitoring", "crash", "exception"];

/**
 * Read the product spec and return the services this project probably needs.
 * Deterministic: same spec → same result, no LLM, no network.
 *
 * - `app-url` is always suggested (every deployed app benefits from a
 *   deploy-aware self URL; also fixes the localhost-hardcoding pitfall).
 * - `supabase` is suggested when the spec mentions data/account keywords.
 *
 * Never invents keys or values — only picks catalog entries.
 *
 * @param {{ oneLine?: string, problem?: string, included?: string[], userFlow?: string[], productName?: string } | null | undefined} spec
 * @returns {CatalogService[]}
 */
export function detectServices(spec) {
  /** @type {CatalogService[]} */
  const out = [];
  const appUrl = catalogServiceById("app-url");
  if (appUrl) out.push(appUrl);

  const parts = [
    spec?.oneLine,
    spec?.problem,
    spec?.productName,
    ...(Array.isArray(spec?.included) ? spec.included : []),
    ...(Array.isArray(spec?.userFlow) ? spec.userFlow : []),
  ].filter((s) => typeof s === "string" && s.length > 0);
  const text = parts.join(" ").toLowerCase();

  if (DATA_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) {
    const supabase = catalogServiceById("supabase");
    if (supabase) out.push(supabase);
  }
  if (EMAIL_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) {
    const resend = catalogServiceById("resend");
    if (resend) out.push(resend);
  }
  if (ERROR_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) {
    const sentry = catalogServiceById("sentry");
    if (sentry) out.push(sentry);
  }

  return out;
}

/** All services a user can add from the picker (full catalog, cloned). */
export function allCatalogServices() {
  return SERVICE_CATALOG.map((s) => catalogServiceById(s.id)).filter(Boolean);
}

/**
 * True when at least one non-secret-safe requirement is unmet — i.e. the pack
 * would ship an .env.example but the user hasn't entered any value yet. Used by
 * the UI to decide whether "값을 채우면 .env.local 도 함께 만들어집니다" applies.
 * @param {CatalogService[]} services
 * @returns {boolean}
 */
export function hasAnyValue(services) {
  return (Array.isArray(services) ? services : []).some((s) =>
    (s?.envVars ?? []).some((v) => typeof v.value === "string" && v.value.trim().length > 0),
  );
}
