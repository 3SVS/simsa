/**
 * SI 티어 Train B — B4: 빌드 에이전트 도구 정책 (D-4 · D-6). **순수·의존성 0** — 빌더 컨테이너 이미지에
 * standalone tsc로 컴파일해 넣을 수 있어야 한다(인스펙터의 nondev-report 패턴). import 금지(테스트로 고정).
 *
 * 무엇을 막나:
 *  - run_command: **허용 목록 밖의 실행 파일은 전부 거부**(D-4: pnpm/node/git/ls/cat). 허용된 실행 파일이라도
 *    `git push|remote|fetch|clone`(push는 잡이 한다), `pnpm dlx|exec|publish`(임의 패키지 실행 = vercel 우회로),
 *    셸 메타문자(`;`·`&&`·`|`·백틱·`$(`·리다이렉션 — 인자 배열로만 실행하므로 애초에 셸이 없지만 인자에 숨긴 것도
 *    거부)는 막는다. **vercel·netlify·wrangler는 목록에 없으므로 자동 거부**(D-6 "유저 배포 명령 차단").
 *  - create_file: 경로 탈출(`..`·절대경로), `.git/`·`.github/`·`node_modules/`, 비밀 파일(`.env*`, `*.pem`,
 *    `*.key`), 잡이 소유하는 설정(`wrangler.toml`·`pnpm-workspace.yaml`)은 거부. 내용에 비밀 패턴이 있으면 거부.
 *  - 환경변수: 자식 프로세스에 넘기는 키는 **허용 목록만**. 배포 토큰 키 이름은 목록에 없다(D-6 코드 강제).
 *
 * 왜 거부를 "조용히 성공"이 아니라 오류로 돌려주나: 모델이 잘못된 길을 갔다는 신호가 있어야 다른 길을 찾는다.
 * 거부는 카운트되어 상한(maxDenied)에서 잡이 정직하게 실패한다.
 */

export const COMMAND_ALLOWLIST: ReadonlySet<string> = new Set(["pnpm", "node", "git", "ls", "cat"]);

/** 허용된 실행 파일 안에서도 막는 하위 명령. 첫 인자 기준. */
export const DENIED_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set(["push", "remote", "fetch", "clone", "pull", "config", "credential", "submodule"]),
  pnpm: new Set(["dlx", "exec", "publish", "login", "deploy", "config", "setup", "self-update"]),
  node: new Set(["--eval", "-e", "--print", "-p", "--input-type"]),
};

/** D-6: 이름만으로도 거부해야 하는 배포·자격 CLI(허용 목록에 없지만, 오류 문구를 정확히 하기 위해). */
export const DEPLOY_CLIS: ReadonlySet<string> = new Set(["vercel", "netlify", "wrangler", "gh", "aws", "gcloud", "az", "firebase", "flyctl", "railway", "render", "heroku", "ssh", "scp", "curl", "wget", "npx", "npm", "yarn", "bun", "sudo", "sh", "bash", "zsh"]);

const SHELL_META = /[;&|`$<>\n\r]|\$\(|\{\s*\w+\s*\}/;

export type CommandDecision = { allowed: true } | { allowed: false; reason: "not_allowlisted" | "deploy_cli" | "denied_subcommand" | "shell_meta" | "empty" };

export function decideCommand(cmd: string, args: readonly string[]): CommandDecision {
  const exe = String(cmd ?? "").trim();
  if (!exe) return { allowed: false, reason: "empty" };
  const base = exe.split(/[\\/]/).pop() ?? exe;
  if (SHELL_META.test(exe) || args.some((a) => SHELL_META.test(String(a)))) return { allowed: false, reason: "shell_meta" };
  if (DEPLOY_CLIS.has(base)) return { allowed: false, reason: "deploy_cli" };
  if (!COMMAND_ALLOWLIST.has(base)) return { allowed: false, reason: "not_allowlisted" };
  const denied = DENIED_SUBCOMMANDS[base];
  const first = String(args[0] ?? "");
  if (denied && denied.has(first)) return { allowed: false, reason: "denied_subcommand" };
  // `pnpm run <script>`·`pnpm <script>`는 package.json 스크립트라 임의 코드지만 저장소 안의 코드다 — 허용.
  // 단 스크립트 이름에 deploy가 들어가면 막는다(템플릿 `deploy` 스크립트 = wrangler deploy).
  if (base === "pnpm" && (first === "deploy" || (first === "run" && String(args[1] ?? "").startsWith("deploy")))) return { allowed: false, reason: "denied_subcommand" };
  return { allowed: true };
}

const DENIED_PATH_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.github(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.env(\.[^/]*)?$/,
  /\.(pem|key|p12|pfx|jks)$/i,
  /(^|\/)wrangler\.(toml|json|jsonc)$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)\.npmrc$/,
];

export type PathDecision = { allowed: true; path: string } | { allowed: false; reason: "traversal" | "absolute" | "denied_path" | "empty" | "too_long" };

/** 저장소 상대 경로만. 정규화한 경로를 돌려준다. */
export function decidePath(rawPath: string): PathDecision {
  const p = String(rawPath ?? "").replace(/\\/g, "/").trim();
  if (!p) return { allowed: false, reason: "empty" };
  if (p.length > 300) return { allowed: false, reason: "too_long" };
  if (/^([a-zA-Z]:)?\//.test(p)) return { allowed: false, reason: "absolute" };
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.some((s) => s === "..")) return { allowed: false, reason: "traversal" };
  const norm = parts.join("/");
  // `.env.example`은 허용(값 없는 예시). 그 외 .env*는 거부.
  if (/(^|\/)\.env\.example$/.test(norm)) return { allowed: true, path: norm };
  if (DENIED_PATH_PATTERNS.some((re) => re.test(norm))) return { allowed: false, reason: "denied_path" };
  return { allowed: true, path: norm };
}

/** 비밀로 보이는 문자열. repair-brief.ts의 introduces_secret와 같은 취지(여기선 의존성 0으로 재구현). */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bcfat_[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s'"]*:[^\s'"@]+@/i,
  /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{20,}["']/i,
];

export function findSecretLike(content: string): string | null {
  for (const re of SECRET_PATTERNS) {
    const m = re.exec(content);
    if (m) return m[0].slice(0, 12) + "…";
  }
  return null;
}

/** 자식 프로세스에 넘길 환경변수 키 허용 목록. 배포 토큰 키는 여기 없다(D-6). */
export const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  "PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP", "SHELL",
  "NODE_ENV", "NODE_OPTIONS", "CI", "PNPM_HOME", "npm_config_registry", "COREPACK_ENABLE_STRICT",
  "PLAYWRIGHT_BROWSERS_PATH",
]);

export function filterEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (ALLOWED_ENV_KEYS.has(k) && typeof v === "string") out[k] = v;
  return out;
}

/** [PILOT] D-4 상한 — 파일럿 후 고정. */
export const BUILD_LIMITS = Object.freeze({
  maxTurnsPerTask: 4 * 6, // WBS당 반복 4회 × 회당 도구 호출 여유
  maxToolCalls: 60,
  maxDenied: 6,
  maxFileBytes: 200 * 1024,
  commandTimeoutMs: 180_000,
  maxOutputChars: 12_000,
});
