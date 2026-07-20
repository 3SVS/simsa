/**
 * mcp-catalog.mjs
 *
 * Prep layer — deploy option A: the user's building agent deploys in one shot
 * using its OWN connected tools (Vercel/GitHub MCP or CLI). Simsa's job is only
 * to LEAD the one-time connect, never to hold a token.
 *
 * Unlike service-catalog.mjs (which collects runtime env values in the browser),
 * this catalog is PURE GUIDANCE: there are no key inputs, no `value` fields, and
 * nothing is ever sent to the server. The one-time auth happens in the user's
 * editor (OAuth/login there), so the deploy token stays on their machine and
 * never reaches Simsa. That invariant is the whole point of option A.
 */

/**
 * @typedef {Object} McpTool
 * @property {string} id
 * @property {string} label
 * @property {string} purpose      // why a non-dev needs this, one plain sentence
 * @property {string} authNote     // the "we never see your token" reassurance
 * @property {string} mcpName      // the MCP server name to register it under
 * @property {string} serverUrl    // the official remote MCP server URL (agent-agnostic, stable)
 * @property {string} [docsUrl]
 *
 * The exact "how to connect" is resolved PER AGENT via agent-registry
 * (resolveMcpConnect): Claude Code gets a `claude mcp add …` command; other
 * agents get the serverUrl to add in their own MCP settings. The server URL is
 * the stable fact and lives here; the command is not hardcoded to Claude Code.
 */

// Bilingual source (2026-07-21, journey-audit v2 재감사: EN 화면 잔여 한글
// 177자의 출처가 이 카탈로그였다). 사용자 대면 문자열만 {ko,en}; id/url은 중립.
const MCP_SOURCE = [
  {
    id: "github",
    label: { ko: "GitHub — 코드 저장소", en: "GitHub — code storage" },
    purpose: {
      ko: "만든 코드를 저장하고 올려두는 곳입니다. 개발 AI가 여기에 코드를 올려야 나중에 Simsa에서 확인할 수 있어요.",
      en: "Where your app's code is stored. Your dev AI pushes code here so Simsa can review it later.",
    },
    // Official GitHub remote MCP server (OAuth). Verified 2026-07.
    mcpName: "github",
    serverUrl: "https://api.githubcopilot.com/mcp/",
    authNote: {
      ko: "로그인은 에디터에서 한 번만 하면 됩니다. 토큰이나 비밀번호를 Simsa에 넣지 마세요 — 저희는 받지도, 저장하지도 않습니다.",
      en: "You sign in once, inside your editor. Never paste tokens or passwords into Simsa — we don't accept or store them.",
    },
    docsUrl: "https://github.com/github/github-mcp-server",
  },
  {
    id: "vercel",
    label: { ko: "Vercel — 인터넷에 배포", en: "Vercel — put it online" },
    purpose: {
      ko: "만든 앱을 인터넷에 올려 접속 주소(URL)를 만드는 곳입니다. 개발 AI가 여기로 배포하면 바로 주소가 나와요.",
      en: "Puts your app on the internet and gives it a URL. When your dev AI deploys here, you get an address right away.",
    },
    // Official Vercel remote MCP server (OAuth, public beta). Verified 2026-07.
    mcpName: "vercel",
    serverUrl: "https://mcp.vercel.com",
    authNote: {
      ko: "로그인은 에디터에서 한 번만. 배포 토큰을 Simsa에 넣지 마세요 — 저희는 받지도, 저장하지도 않습니다.",
      en: "Sign in once, in your editor. Never paste deploy tokens into Simsa — we don't accept or store them.",
    },
    docsUrl: "https://vercel.com/docs/mcp/vercel-mcp",
  },
];

/** @param {"en"|"ko"|undefined} locale */
function norm(locale) {
  return locale === "en" ? "en" : "ko";
}

/** @param {(typeof MCP_SOURCE)[number]} src @param {"en"|"ko"} loc @returns {McpTool} */
function resolve(src, loc) {
  return {
    id: src.id,
    label: src.label[loc],
    purpose: src.purpose[loc],
    authNote: src.authNote[loc],
    mcpName: src.mcpName,
    serverUrl: src.serverUrl,
    ...(src.docsUrl ? { docsUrl: src.docsUrl } : {}),
  };
}

/** Backward-compat KO view. Prefer the function forms with an explicit locale.
 * @type {McpTool[]} */
export const MCP_CATALOG = MCP_SOURCE.map((s) => resolve(s, "ko"));

/**
 * Return a fresh clone of a tool entry by id (so callers never mutate the
 * shared catalog).
 * @param {string} id
 * @param {"en"|"ko"} [locale]
 * @returns {McpTool | null}
 */
export function mcpToolById(id, locale) {
  const found = MCP_SOURCE.find((t) => t.id === id);
  if (!found) return null;
  return resolve(found, norm(locale));
}

/**
 * The deploy tools a "build it and put it live" project needs. Any web app the
 * user wants online needs a code repo (GitHub) and a host (Vercel), so this is
 * deterministic and spec-independent for now — returned in connect order
 * (repo first, then deploy). The `spec` parameter is accepted for future
 * refinement (e.g. skipping the repo tool for a throwaway prototype) but is not
 * used today.
 *
 * @param {"en"|"ko"} [locale]
 * @returns {McpTool[]}
 */
export function detectMcpTools(locale) {
  const loc = norm(locale);
  return MCP_SOURCE.map((t) => resolve(t, loc));
}
