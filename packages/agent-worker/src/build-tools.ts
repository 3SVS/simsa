/**
 * SI 티어 Train B — B4: 빌드 에이전트 도구 스키마 (다중 턴 tool_use).
 * 실행은 전부 호출자가 주입한 BuildToolExecutor가 한다 — 이 패키지는 파일시스템·프로세스에 손대지 않는다
 * (ClaudeWorker와 같은 원칙). 정책(build-policy.ts)이 실행 전에 매 호출을 거른다.
 */

export const BUILD_TOOLS = [
  {
    name: "read_file",
    description: "Read a repo-relative file. Use before editing so you copy unchanged lines verbatim.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "list_files",
    description: "List files under a repo-relative directory (recursive, capped). '' = repo root.",
    input_schema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] },
  },
  {
    name: "create_file",
    description:
      "Create or overwrite a repo-relative file with COMPLETE contents. Never write secrets, .env files, wrangler.toml or anything under .git/.github.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "run_command",
    description:
      "Run a build/test command with an argument array (no shell). Allowed executables: pnpm, node, git, ls, cat. Deploy tools (vercel, netlify, wrangler), git push, pnpm dlx/exec and shell metacharacters are refused.",
    input_schema: {
      type: "object",
      properties: { cmd: { type: "string" }, args: { type: "array", items: { type: "string" } }, timeoutMs: { type: "number" } },
      required: ["cmd", "args"],
    },
  },
  {
    name: "finish",
    description: "Call exactly once when the task is done (build and tests green) or when you cannot finish. Say honestly which acceptance criteria are covered.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["done", "gave_up"] },
        summary: { type: "string" },
        commitMessage: { type: "string" },
      },
      required: ["status", "summary"],
    },
  },
] as const;

export type BuildToolName = (typeof BUILD_TOOLS)[number]["name"];

export const BUILD_SYSTEM_PROMPT = `You are Simsa's build worker. You implement ONE work item of a development spec inside a scaffolded Cloudflare app (Hono API under /api/*, React/Vite client, D1 via migrations/).

Rules:
- Read before you write. Keep unchanged code verbatim.
- Data schema changes go in a NEW numbered file under migrations/. Never CREATE TABLE in code.
- Run \`pnpm run build\` (and \`pnpm test\` if tests exist) before calling finish. If red, fix and re-run. Do not claim done while red.
- You cannot deploy, push, or touch secrets/config the platform owns. Refused tool calls are not bugs to work around — choose another way or give up honestly.
- Write user-facing text in the spec's language. Keep the UI simple and honest.
- Call finish exactly once.`;
