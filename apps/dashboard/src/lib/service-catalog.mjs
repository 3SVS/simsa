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
 * i18n (2026-07-21, journey-audit v2 기준선 P1): entries are authored bilingual
 * (ko/en) and every public function takes an optional `locale` (default "ko" —
 * 기존 호출자 무변경). EN 주행에서 이 카드만 한국어 478자가 남던 누수의 근본 수정.
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

/** @typedef {"en" | "ko"} CatalogLocale */

// Bilingual source of truth. Shape per entry: every user-facing string is
// { ko, en }; ids/keys/urls are locale-neutral.
const CATALOG_SOURCE = [
  {
    id: "app-url",
    label: { ko: "앱 주소", en: "App URL" },
    why: {
      ko: "앱이 자기 주소를 알아야 공유 링크·리디렉션이 깨지지 않습니다. 가입 없이 값만 넣으면 됩니다.",
      en: "Your app needs to know its own address so share links and redirects don't break. No sign-up — just fill in the value.",
    },
    setupSteps: {
      ko: [
        "가입이 필요 없는 항목입니다.",
        "만드는 동안에는 http://localhost:3000 을 그대로 두세요.",
        "배포한 뒤에는 실제 도메인(예: https://내앱.vercel.app)으로 바꾸면 됩니다.",
      ],
      en: [
        "No sign-up needed for this one.",
        "While building, leave it as http://localhost:3000.",
        "After deploying, change it to your real domain (e.g. https://myapp.vercel.app).",
      ],
    },
    envVars: [
      {
        key: "NEXT_PUBLIC_APP_URL",
        description: {
          ko: "앱이 자기 자신을 가리키는 주소입니다. 공유 링크·리디렉션 등에 쓰입니다. 처음엔 localhost, 배포 후엔 실제 도메인.",
          en: "The address your app uses to refer to itself — used for share links and redirects. localhost at first, your real domain after deploying.",
        },
        example: { ko: "http://localhost:3000", en: "http://localhost:3000" },
      },
    ],
  },
  {
    id: "supabase",
    label: { ko: "Supabase (데이터 저장·로그인)", en: "Supabase (data & sign-in)" },
    why: {
      ko: "회원가입·로그인이나 글·기록 같은 데이터를 저장하려면 데이터베이스가 필요합니다. Supabase는 무료로 시작할 수 있습니다.",
      en: "Sign-ups, logins, and saved data (posts, records) need a database. Supabase has a free tier to start with.",
    },
    setupUrl: "https://supabase.com",
    setupSteps: {
      ko: [
        "https://supabase.com 에 접속해 GitHub 계정으로 가입합니다.",
        "New project 를 눌러 프로젝트를 하나 만듭니다(이름·비밀번호·지역 선택).",
        "왼쪽 아래 톱니바퀴(Project Settings) → API 메뉴로 이동합니다.",
        "Project URL 을 복사해 NEXT_PUBLIC_SUPABASE_URL 에 넣습니다.",
        "같은 화면의 anon public 키를 복사해 NEXT_PUBLIC_SUPABASE_ANON_KEY 에 넣습니다.",
        "관리자 기능이 필요하면 Project API keys 에서 service_role 의 Reveal 을 눌러 복사합니다. 이 키는 서버에서만 씁니다.",
      ],
      en: [
        "Go to https://supabase.com and sign up with your GitHub account.",
        "Press New project and create one (name, password, region).",
        "Open the gear at bottom-left (Project Settings) → API.",
        "Copy the Project URL into NEXT_PUBLIC_SUPABASE_URL.",
        "Copy the anon public key on the same screen into NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        "If you need admin features, press Reveal next to service_role under Project API keys and copy it. That key is server-only.",
      ],
    },
    envVars: [
      {
        key: "NEXT_PUBLIC_SUPABASE_URL",
        description: {
          ko: "Supabase 프로젝트 주소입니다. Project Settings → API 의 Project URL.",
          en: "Your Supabase project address — Project Settings → API → Project URL.",
        },
        example: { ko: "https://xxxxxxxx.supabase.co", en: "https://xxxxxxxx.supabase.co" },
      },
      {
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        description: {
          ko: "브라우저에서 쓰는 공개 키(anon public)입니다. 공개돼도 되는 키라 프론트에 넣어도 됩니다.",
          en: "The public browser key (anon public). Safe to expose, so it can go in the frontend.",
        },
        example: { ko: "eyJhbGciOiJI...(공개 anon 키)", en: "eyJhbGciOiJI...(public anon key)" },
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        description: {
          ko: "관리자 권한 키(service_role)입니다. 절대 브라우저/프론트엔드에 넣지 말고 서버에서만 쓰세요.",
          en: "The admin key (service_role). Never put it in the browser/frontend — server only.",
        },
        secret: true,
        example: { ko: "eyJhbGciOiJI...(service_role · 서버 전용)", en: "eyJhbGciOiJI...(service_role · server only)" },
      },
    ],
  },
  {
    id: "resend",
    label: { ko: "Resend (이메일 보내기)", en: "Resend (sending email)" },
    why: {
      ko: "가입 확인·비밀번호 재설정·알림 메일을 보내려면 이메일 발송 서비스가 필요합니다. Resend는 무료 한도로 시작할 수 있습니다.",
      en: "Sign-up confirmations, password resets, and notification emails need an email service. Resend has a free tier.",
    },
    setupUrl: "https://resend.com",
    setupSteps: {
      ko: [
        "https://resend.com 에 가입합니다(GitHub 계정으로 가능).",
        "왼쪽 메뉴의 API Keys → Create API Key 를 누릅니다.",
        "만들어진 키(re_ 로 시작)를 복사해 RESEND_API_KEY 에 넣습니다. 이 키는 서버에서만 씁니다.",
        "메일을 실제로 보내려면 나중에 도메인 인증이 필요할 수 있습니다(테스트는 인증 없이 가능).",
      ],
      en: [
        "Sign up at https://resend.com (GitHub account works).",
        "Open API Keys in the left menu → Create API Key.",
        "Copy the new key (starts with re_) into RESEND_API_KEY. Server-only.",
        "Sending real mail may later require domain verification (testing works without it).",
      ],
    },
    envVars: [
      {
        key: "RESEND_API_KEY",
        description: {
          ko: "이메일을 보낼 때 쓰는 Resend API 키입니다. 서버 전용이라 프론트엔드에 넣지 마세요.",
          en: "The Resend API key used to send email. Server-only — don't put it in the frontend.",
        },
        secret: true,
        example: { ko: "re_xxxxxxxx (서버 전용)", en: "re_xxxxxxxx (server only)" },
      },
    ],
  },
  {
    id: "sentry",
    label: { ko: "Sentry (오류 추적)", en: "Sentry (error tracking)" },
    why: {
      ko: "앱에서 나는 오류를 자동으로 모아 알려줍니다. 사용자가 겪은 문제를 놓치지 않고 고칠 수 있어요. 무료 한도로 시작할 수 있습니다.",
      en: "Collects and reports your app's errors automatically, so problems users hit never slip by. Free tier available.",
    },
    setupUrl: "https://sentry.io",
    setupSteps: {
      ko: [
        "https://sentry.io 에 가입하고 프로젝트를 하나 만듭니다(플랫폼은 만드는 앱에 맞게 선택).",
        "프로젝트 설정(Settings) → Client Keys (DSN) 로 이동합니다.",
        "DSN 주소를 복사해 NEXT_PUBLIC_SENTRY_DSN 에 넣습니다. DSN은 공개돼도 되는 값입니다.",
      ],
      en: [
        "Sign up at https://sentry.io and create a project (pick the platform matching your app).",
        "Open project Settings → Client Keys (DSN).",
        "Copy the DSN into NEXT_PUBLIC_SENTRY_DSN. The DSN is safe to expose.",
      ],
    },
    envVars: [
      {
        key: "NEXT_PUBLIC_SENTRY_DSN",
        description: {
          ko: "오류를 Sentry로 보내는 주소(DSN)입니다. 공개돼도 되는 값이라 프론트에 넣어도 됩니다.",
          en: "The address (DSN) errors are sent to. Safe to expose, so it can go in the frontend.",
        },
        example: { ko: "https://xxxx@oyyy.ingest.sentry.io/zzzz", en: "https://xxxx@oyyy.ingest.sentry.io/zzzz" },
      },
    ],
  },
];

/** @param {"en"|"ko"|undefined} locale */
function norm(locale) {
  return locale === "en" ? "en" : "ko";
}

/**
 * Resolve one bilingual entry to the flat CatalogService shape for a locale.
 * @param {(typeof CATALOG_SOURCE)[number]} src
 * @param {CatalogLocale} loc
 * @returns {CatalogService}
 */
function resolve(src, loc) {
  return {
    id: src.id,
    label: src.label[loc],
    why: src.why[loc],
    ...(src.setupUrl ? { setupUrl: src.setupUrl } : {}),
    ...(src.setupSteps ? { setupSteps: [...src.setupSteps[loc]] } : {}),
    envVars: src.envVars.map((v) => ({
      key: v.key,
      description: v.description[loc],
      ...(v.secret ? { secret: true } : {}),
      ...(v.example ? { example: v.example[loc] } : {}),
    })),
  };
}

/**
 * Backward-compat view of the catalog (KO). Prefer the function forms with an
 * explicit locale — this exists so pre-i18n imports keep working.
 * @type {CatalogService[]}
 */
export const SERVICE_CATALOG = CATALOG_SOURCE.map((s) => resolve(s, "ko"));

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
 * @param {"en"|"ko"} [locale]
 * @returns {CatalogService | null}
 */
export function catalogServiceById(id, locale) {
  const found = CATALOG_SOURCE.find((s) => s.id === id);
  if (!found) return null;
  return resolve(found, norm(locale));
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
 * @param {"en"|"ko"} [locale]
 * @returns {CatalogService[]}
 */
export function detectServices(spec, locale) {
  const loc = norm(locale);
  /** @type {CatalogService[]} */
  const out = [];
  const appUrl = catalogServiceById("app-url", loc);
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
    const supabase = catalogServiceById("supabase", loc);
    if (supabase) out.push(supabase);
  }
  if (EMAIL_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) {
    const resend = catalogServiceById("resend", loc);
    if (resend) out.push(resend);
  }
  if (ERROR_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) {
    const sentry = catalogServiceById("sentry", loc);
    if (sentry) out.push(sentry);
  }

  return out;
}

/**
 * All services a user can add from the picker (full catalog, cloned).
 * @param {"en"|"ko"} [locale]
 */
export function allCatalogServices(locale) {
  const loc = norm(locale);
  return CATALOG_SOURCE.map((s) => catalogServiceById(s.id, loc)).filter(Boolean);
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
