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
 * @property {string} [setupUrl]
 * @property {string[]} [setupSteps]
 * @property {CatalogEnvVar[]} envVars
 */

/** @type {CatalogService[]} */
export const SERVICE_CATALOG = [
  {
    id: "app-url",
    label: "앱 주소",
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
    ...(found.setupUrl ? { setupUrl: found.setupUrl } : {}),
    ...(found.setupSteps ? { setupSteps: [...found.setupSteps] } : {}),
    envVars: found.envVars.map((v) => ({ ...v })),
  };
}

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

  return out;
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
