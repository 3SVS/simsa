/**
 * SI 티어 Train B — B-5b-2 · B-5b-3: 빌드 잡의 "일하는 부분" (builder-run.mjs가 부른다).
 *
 *   B-5b-2  implementing — WBS 항목마다 agent-worker runBuildLoop를 **Worker LLM 프록시**로(apiKey = jobToken) 돌린다.
 *           도구 실행기(createWorkspaceExecutor)는 작업 폴더 안에서만 읽고 쓰고, 명령은 샌드박스 사용자로 돌린다.
 *   B-5b-3  빌드 게이트(D-4) — 보호 파일 복원 → `pnpm install --frozen-lockfile --offline` → `pnpm run build` → `pnpm test`.
 *           빨간불이면 로그 끝부분을 모델에게 주고 수리 라운드 최대 GATE_LIMITS.repairRounds회(예산 안에서) → 그래도 빨간불이면
 *           building이면 failed(building), testing이면 failed(testing). 초록불이 아니면 절대 다음 단계(push·배포)로 가지 않는다.
 *
 * 생성 코드 실행 안전(이 컨테이너가 LLM이 만든 코드와 그 의존성을 실행하기 때문 — B-5b S1의 전제):
 *  - **샌드박스 사용자**: 이미지가 만든 `simsa-run`(SIMSA_SANDBOX_UID/GID)으로 모든 자식 프로세스(git·pnpm·모델 명령)를
 *    돌린다. 서버(root)의 메모리(/proc/<pid>/mem)·환경(/proc/<pid>/environ)은 다른 uid라 읽을 수 없고, 작업 폴더 밖
 *    (/builder 서버 코드 등)에는 쓸 수 없다. jobToken은 서버 메모리에만 있다.
 *  - 자식 env = childEnv(허용 목록) + HOME·NO_COLOR(+ 모델·빌드 명령은 npm_config_offline) — 비밀 0, jobToken 0.
 *  - 파일 도구: 경로 탈출(`..`·절대경로)·심볼릭 링크(어느 구성 요소든) 거부, 보호 파일은 쓰기 거부.
 *  - 명령: 명령 경로 금지(맨 이름만) · 인자 경로 탈출 금지 · pnpm/git 디렉터리 전환 플래그 금지 · 의존성 변경 pnpm 하위 명령 금지
 *    (의존성은 lockfile 고정 — GATE_ALLOWS_DEPENDENCY_CHANGES) · git은 읽기 전용 하위 명령만 · 장기 실행 스크립트(dev 등) 금지.
 *  - 시간 상한(명령·WBS·수리 라운드) · 출력 상한(앞·끝만 남김) · 로그·콜백·모델 입력으로 가는 출력은 ANSI 제거 + 비밀 가리기.
 *  - 네트워크: 의존성은 이미지 빌드 때 샌드박스 사용자의 pnpm 저장소로 미리 받아 둔다(Dockerfile `pnpm fetch`) → 잡 안의 설치는
 *    `--offline`. 모델·빌드·테스트 명령은 npm_config_offline=true. (OS 수준 차단은 아니다 — 컨테이너 egress는 열려 있다.)
 *
 * 순수성: exec·fetch·fs·agent-worker는 주입 가능 — 테스트는 네트워크·Docker 없이 돈다.
 */
import { spawn } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

// ─── 자식 프로세스 env (B-5b S1 — builder-run.mjs가 다시 내보낸다) ───────────────────────────────────────

/**
 * 자식 프로세스에 넘기는 환경변수 키 — **허용 목록만**. packages/agent-worker build-policy.ts ALLOWED_ENV_KEYS와 같은 목록
 * (테스트가 실제 dist와 비교해 고정). jobToken은 env에 없다(페이로드 메모리에만 — 콜백·LLM 설정에서만 쓴다).
 */
export const CHILD_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP", "SHELL",
  "NODE_ENV", "NODE_OPTIONS", "CI", "PNPM_HOME", "npm_config_registry", "COREPACK_ENABLE_STRICT",
  "PLAYWRIGHT_BROWSERS_PATH",
]);
const CHILD_ENV_KEY_SET = new Set(CHILD_ENV_KEYS);

/** base env(보통 process.env)에서 허용 키만. 값이 문자열인 것만. */
export function childEnv(base = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(base ?? {})) if (CHILD_ENV_KEY_SET.has(k) && typeof v === "string") out[k] = v;
  return out;
}

/**
 * 허용 목록 밖에서 **우리가** 넣는 키(값은 고정·비밀 아님). 테스트가 이 목록 밖의 키가 자식 env에 없는지 본다.
 * WRANGLER_SEND_METRICS(B-5b-4)는 산출물 번들(`wrangler deploy --dry-run`) 한 명령에만 — bundleEnv.
 */
export const WORK_ENV_EXTRA_KEYS = Object.freeze(["NO_COLOR", "npm_config_offline", "WRANGLER_SEND_METRICS"]);

/**
 * 잡의 자식 프로세스 env. 샌드박스면 HOME은 샌드박스 사용자의 집(pnpm 저장소·git이 쓴다).
 * offline=true(모델 명령·빌드·테스트)면 npm_config_offline — pnpm이 레지스트리에 닿지 않는다.
 */
export function workEnv(base = process.env, { sandbox = null, offline = false } = {}) {
  return {
    ...childEnv(base),
    ...(sandbox ? { HOME: sandbox.home } : {}),
    NO_COLOR: "1",
    ...(offline ? { npm_config_offline: "true" } : {}),
  };
}

/**
 * B-5b-4 산출물 번들(`wrangler deploy --dry-run --outdir …`)의 env = 오프라인 workEnv + 원격 측정 끔. 자격 증명은 **없다**
 * (허용 목록에 CLOUDFLARE_* 없음) — dry-run은 토큰 없이 번들만 만든다(실측: wrangler 4.141.0, exit 0). 배포는 Worker가 한다.
 */
export function bundleEnv(base = process.env, { sandbox = null } = {}) {
  return { ...workEnv(base, { sandbox, offline: true }), WRANGLER_SEND_METRICS: "false" };
}

// ─── 샌드박스 사용자 ────────────────────────────────────────────────────────────────────────────

/** Dockerfile이 ENV로 싣는 이름. 값은 비밀이 아니다(uid·경로). */
export const SANDBOX_ENV = Object.freeze({ uid: "SIMSA_SANDBOX_UID", gid: "SIMSA_SANDBOX_GID", home: "SIMSA_SANDBOX_HOME", store: "SIMSA_PNPM_STORE_DIR" });

/**
 * 개발 PC에서 샌드박스 없이 돌리겠다는 **명시** opt-out(값 "1"). 운영 이미지·Worker 컨테이너 설정은 이 이름을 싣지 않는다
 * (test/train-b-b5b2-gate.test.mjs가 Dockerfile·wrangler.toml·builder-container.ts를 확인). root에서는 받지 않는다 —
 * 생성 코드를 root로 돌리는 길은 설정 누락으로도, opt-out으로도 없다(PR #569 S2 검증 결함 2).
 */
export const SANDBOX_OPT_OUT_ENV = "SIMSA_ALLOW_UNSANDBOXED";

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/**
 * 샌드박스 설정. { ok, sandbox: {uid,gid,home,storeDir}|null, reason }. **기본은 샌드박스 필수(fail closed)**:
 *  - 설정 없음 → **ok:false** ("not_configured") — ENV 하나가 빠진 이미지가 LLM이 만든 코드를 root로 돌리지 않는다.
 *    [정정 2026-10-01 S2 결함 2] 종전에는 ok:true였다(설정 누락 = 조용히 샌드박스 없이 실행).
 *  - 설정 없음 + SANDBOX_OPT_OUT_ENV=1 + root 아님(개발 PC) → ok, sandbox null ("opted_out"). root면 "opt_out_refused_as_root".
 *  - 설정이 있는데 쓸 수 없음(root가 아님·값 이상) → ok:false.
 * 테스트는 runBuild에 deps.sandbox(null 또는 {uid,…})를 **명시로** 넘긴다 — 이 함수를 거치지 않는다.
 */
export function sandboxFromEnv(env = process.env, getuid = currentUid) {
  const rawUid = env?.[SANDBOX_ENV.uid];
  if (rawUid === undefined || rawUid === "") {
    if (env?.[SANDBOX_OPT_OUT_ENV] !== "1") return { ok: false, sandbox: null, reason: "not_configured" };
    if (getuid() === 0) return { ok: false, sandbox: null, reason: "opt_out_refused_as_root" };
    return { ok: true, sandbox: null, reason: "opted_out" };
  }
  const uid = Number(rawUid);
  const gid = Number(env?.[SANDBOX_ENV.gid] ?? rawUid);
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0) return { ok: false, sandbox: null, reason: "invalid_sandbox_ids" };
  const home = env?.[SANDBOX_ENV.home];
  if (typeof home !== "string" || !home.startsWith("/")) return { ok: false, sandbox: null, reason: "sandbox_home_missing" };
  if (getuid() !== 0) return { ok: false, sandbox: null, reason: "not_root" };
  const store = env?.[SANDBOX_ENV.store];
  return { ok: true, sandbox: { uid, gid, home, storeDir: typeof store === "string" && store.startsWith("/") ? store : null }, reason: null };
}

/**
 * 자가점검 항목 — 샌드박스 사용자가 실제로 있고(집 폴더 소유자 = uid) 저장소가 미리 받아져 있나. 던지지 않는다.
 * 설정이 없으면 ok:false(not_configured) — runBuild와 **같은 판정**(sandboxFromEnv)이라 자가점검 초록불 = 빌드가 샌드박스로 돈다.
 */
export async function checkSandbox({ env = process.env, getuid = currentUid, fsImpl = fs } = {}) {
  const s = sandboxFromEnv(env, getuid);
  if (!s.ok) return { ok: false, enabled: false, uid: null, storeReady: false, reason: s.reason };
  if (!s.sandbox) return { ok: true, enabled: false, uid: null, storeReady: false, reason: s.reason }; // opted_out(개발 PC)만
  try {
    const st = await fsImpl.stat(s.sandbox.home);
    if (st.uid !== s.sandbox.uid) return { ok: false, enabled: true, uid: s.sandbox.uid, storeReady: false, reason: "sandbox_home_owner_mismatch" };
    let storeReady = false;
    if (s.sandbox.storeDir) storeReady = await fsImpl.stat(s.sandbox.storeDir).then((x) => x.isDirectory(), () => false);
    return { ok: true, enabled: true, uid: s.sandbox.uid, storeReady, reason: null };
  } catch (err) {
    return { ok: false, enabled: true, uid: s.sandbox.uid, storeReady: false, reason: `sandbox_home_unreadable:${String(err?.code ?? err?.message ?? err).slice(0, 60)}` };
  }
}

/** 트리 전체 소유자를 바꾼다(root가 만든 스캐폴드를 샌드박스 사용자에게). 심볼릭 링크는 따라가지 않는다(lchown). */
export async function chownTree(root, uid, gid, fsImpl = fs) {
  const lchown = fsImpl.lchown ?? fs.lchown;
  await lchown(root, uid, gid);
  const entries = await fsImpl.readdir(root, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    const dir = e.parentPath ?? e.path ?? root;
    await lchown(path.join(dir, e.name), uid, gid);
  }
}

// ─── 출력: ANSI 제거 · 비밀 가리기 · 끝부분 ─────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
export function stripAnsi(s) {
  return String(s ?? "").replace(ANSI_RE, "");
}

/** 토큰 모양(값이 아니라 모양 — 픽스처에 실토큰을 두지 않는다). jobToken 문자열 자체는 literals로 넘긴다. */
const SECRET_SHAPES = [
  /\bbjt\d+\.[A-Za-z0-9_-]{1,64}\.[0-9a-f]{16,}/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bcfat_[A-Za-z0-9_-]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi;

/** 로그·콜백·모델 입력으로 가는 텍스트에서 비밀을 가린다. literals = 이 잡의 jobToken 등(8자 이상만). */
export function redactSecrets(text, literals = []) {
  let s = String(text ?? "");
  for (const lit of literals) if (typeof lit === "string" && lit.length >= 8) s = s.split(lit).join("[redacted]");
  for (const re of SECRET_SHAPES) s = s.replace(re, "[redacted]");
  return s.replace(BEARER_RE, "$1 [redacted]");
}

/** 끝부분 max자(빌드 오류는 대개 끝에 있다). 잘랐으면 앞에 표시. */
export function tailText(text, max) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return `…[${s.length - max} chars omitted]\n${s.slice(s.length - max)}`;
}

/** 출력 수집기 — 앞 headMax자 + 끝 나머지만 남긴다(자식이 수 MB를 뱉어도 메모리·콜백이 커지지 않는다). */
function makeCapture(maxChars) {
  const headMax = Math.min(16 * 1024, Math.floor(maxChars / 4));
  const tailMax = Math.max(1, maxChars - headMax);
  let head = "";
  let tail = "";
  let dropped = 0;
  return {
    push(chunk) {
      let s = String(chunk);
      if (head.length < headMax) {
        const take = s.slice(0, headMax - head.length);
        head += take;
        s = s.slice(take.length);
      }
      if (!s) return;
      tail += s;
      if (tail.length > tailMax) {
        dropped += tail.length - tailMax;
        tail = tail.slice(tail.length - tailMax);
      }
    },
    get dropped() {
      return dropped;
    },
    text() {
      return dropped > 0 ? `${head}\n…[${dropped} chars omitted]…\n${tail}` : head + tail;
    },
  };
}

// ─── 실행기 (spawn · 프로세스 그룹 · 시간·출력 상한 · 샌드박스 uid) ────────────────────────────────────

export const EXEC_DEFAULT_MAX_OUTPUT_CHARS = 256 * 1024;

/**
 * 명령 하나. 던지지 않는다 → { ok, code, stdout, stderr, timedOut, aborted, truncated, error }.
 *  - env: 호출자가 준 것(없으면 childEnv(process.env)) — process.env를 통째로 넘기지 않는다.
 *  - uid/gid: 샌드박스 사용자(root 서버만 바꿀 수 있다).
 *  - 리눅스에서는 새 프로세스 그룹(detached)으로 띄우고, 시간 초과·중단 때 **그룹 전체**를 죽인다(vite·esbuild 손자까지).
 *  - 출력은 maxOutputBytes(문자) 안에서 앞·끝만 남긴다 — 넘쳐도 자식을 죽이지 않는다(execFile maxBuffer와 다름).
 *  - 보조 그룹: uid/gid를 주면 Node(libuv uv__process_child_init)가 자식에서 `setgroups(0, NULL)` → setgid → setuid 순서로
 *    부른다(uid/gid가 있으면 posix_spawn 빠른 길은 쓰지 않는다 — ENOSYS 폴백). 즉 root 서버의 보조 그룹(gid 0 등)은 자식에
 *    남지 않는다. container-images CI 탐침이 실제 이미지에서 `groups=10001`·보조 그룹 비어 있음을 확인한다(PR #569 S2 검증 1).
 */
export function sandboxExec(cmd, args, { cwd, env, timeoutMs = 15_000, signal = null, uid, gid, maxOutputBytes = EXEC_DEFAULT_MAX_OUTPUT_CHARS } = {}) {
  return new Promise((resolve) => {
    const useGroup = process.platform !== "win32";
    const out = makeCapture(maxOutputBytes);
    const err = makeCapture(maxOutputBytes);
    let child = null;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timer = null;
    const killTree = () => {
      if (!child || typeof child.pid !== "number") return;
      try {
        if (useGroup) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* 이미 끝났다 */
        }
      }
    };
    const onAbort = () => {
      aborted = true;
      killTree();
    };
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve({ ...r, truncated: out.dropped + err.dropped > 0 });
    };
    if (signal?.aborted) {
      finish({ ok: false, code: -1, stdout: "", stderr: "", timedOut: false, aborted: true, error: "aborted" });
      return;
    }
    try {
      child = spawn(cmd, args, {
        cwd,
        env: env ?? childEnv(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        detached: useGroup,
        windowsHide: true,
        ...(Number.isInteger(uid) ? { uid } : {}),
        ...(Number.isInteger(gid) ? { gid } : {}),
      });
    } catch (e) {
      finish({ ok: false, code: -1, stdout: "", stderr: "", timedOut: false, aborted: false, error: String(e?.message ?? e).slice(0, 200) });
      return;
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => out.push(d));
    child.stderr?.on("data", (d) => err.push(d));
    timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, Math.max(1, timeoutMs));
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.on("error", (e) => finish({ ok: false, code: -1, stdout: out.text(), stderr: err.text(), timedOut, aborted, error: String(e?.message ?? e).slice(0, 200) }));
    child.on("close", (code, sig) => {
      const c = typeof code === "number" ? code : -1;
      const ok = c === 0 && !timedOut && !aborted;
      finish({
        ok,
        code: c,
        stdout: out.text(),
        stderr: err.text(),
        timedOut,
        aborted,
        error: ok ? null : timedOut ? `timed out after ${timeoutMs}ms` : aborted ? "aborted" : sig ? `killed by ${sig}` : `exit ${c}`,
      });
    });
  });
}

// ─── 작업 폴더 정책 ────────────────────────────────────────────────────────────────────────────

/**
 * 플랫폼이 소유하는 앱 파일 — 모델의 create_file은 거부하고, 빌드 게이트 전에 스캐폴드 때의 내용으로 **되돌린다**
 * (restoreProtected). 모델(또는 모델이 쓴 node 스크립트)이 테스트·빌드 스크립트·의존성·배포 설정을 바꿔 게이트를 통과시키는
 * 길을 막는다. wrangler.toml·pnpm-workspace.yaml·.npmrc는 agent-worker decidePath도 막는다(이중).
 */
export const PROTECTED_APP_FILES = Object.freeze(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "wrangler.toml", ".gitignore", "test/smoke.test.mjs"]);
const PROTECTED_SET = new Set(PROTECTED_APP_FILES);

function normRel(rel) {
  return String(rel ?? "").replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".").join("/");
}

export function isProtectedAppFile(rel) {
  return PROTECTED_SET.has(normRel(rel));
}

/**
 * [결정] 생성 코드는 의존성을 더할 수 없다(설치는 언제나 `--frozen-lockfile`). 근거:
 *  ① 공급망 — 모델이 지어낸 패키지 이름(slopsquatting)·악성 postinstall·런타임 코드가 우리 컨테이너에서 돌고 유저 앱으로 배포된다.
 *  ② 재현성 — Worker가 올릴(S3) 트리의 lockfile이 설치한 것과 같아야 한다.
 *  ③ 오프라인 — 템플릿 의존성은 이미지에 미리 받아 두므로 잡 안의 설치는 레지스트리에 닿지 않는다.
 * 모델이 package.json·lockfile을 바꿔도(노드 스크립트로라도) 게이트가 원본으로 되돌린다 — 그 의존성을 쓰는 코드는 빌드에서 깨지고
 * 수리 라운드가 고친다. 재검토 트리거: 템플릿으로 못 만드는 must 기능이 파일럿에서 반복될 때(허용 목록 레지스트리 검토).
 */
export const GATE_ALLOWS_DEPENDENCY_CHANGES = false;

/** 모델의 pnpm 하위 명령 중 거부(의존성 변경·네트워크·게시·임의 패키지 실행·장기 실행). */
export const PNPM_MODEL_DENIED = Object.freeze([
  "add", "install", "i", "remove", "rm", "uninstall", "un", "update", "up", "upgrade", "link", "ln", "unlink", "import",
  "patch", "patch-commit", "patch-remove", "approve-builds", "rebuild", "rb", "prune", "store", "fetch", "create", "init",
  "dedupe", "env", "server", "pack", "publish", "dlx", "exec", "x", "login", "logout", "adduser", "deploy", "config", "c",
  "setup", "self-update", "audit", "outdated", "licenses", "doctor", "cache", "dev", "start", "preview",
]);
const PNPM_DEPENDENCY_SUBCOMMANDS = new Set(["add", "install", "i", "remove", "rm", "uninstall", "un", "update", "up", "upgrade", "link", "ln", "unlink", "import", "patch", "patch-commit", "patch-remove", "approve-builds", "rebuild", "rb", "prune", "store", "fetch", "dedupe"]);
const PNPM_DENIED_SET = new Set(PNPM_MODEL_DENIED);
/** `pnpm <bin>`(암묵 exec)·스크립트 이름으로도 부를 수 없는 것 — 배포·자격·셸(D-6). */
const WORKSPACE_DENIED_BINS = new Set(["wrangler", "wrangler2", "cf-wrangler", "miniflare", "workerd", "vercel", "netlify", "gh", "npm", "npx", "yarn", "bun", "corepack", "curl", "wget", "ssh", "scp", "sh", "bash", "zsh", "sudo", "su", "env"]);
/** 끝나지 않는 스크립트(개발 서버·감시). 명령 시간만 태운다. */
const LONG_RUNNING_RE = /^(dev|start|preview|serve|watch)(:|$)/;
/** 모델이 쓸 수 있는 git 하위 명령 — 읽기 전용. 커밋·리셋·체크아웃은 잡이 한다(WBS 경계·되돌리기). */
export const GIT_MODEL_ALLOWED = Object.freeze(["status", "diff", "log", "show", "ls-files", "grep", "blame", "rev-parse", "shortlog", "describe", "cat-file", "diff-tree"]);
const GIT_ALLOWED_SET = new Set(GIT_MODEL_ALLOWED);
/** 작업 폴더·설정 바꿔치기 플래그(pnpm·git). */
const DIR_SWITCH_RE = /^(-C|--dir|--prefix|--cwd|--git-dir|--work-tree|--global|-g|--workspace-root|-w|--filter|-F|--recursive|-r|--store-dir|--virtual-store-dir|--modules-dir|--lockfile-dir|--global-dir|--userconfig|--globalconfig|--registry|--config\..*|--namespace)(=|$)/;

function isEscapingPath(v) {
  const s = String(v ?? "");
  return /^(\/|~|[A-Za-z]:[\\/]|\\\\)/.test(s) || s.split(/[\\/]/).includes("..");
}

/**
 * 모델 run_command의 두 번째 관문(agent-worker decideCommand 다음). { allowed } | { allowed:false, reason, detail }.
 * decideCommand는 첫 인자만 본다 — `pnpm --silent dlx x`·`pnpm wrangler deploy`(암묵 exec)·`git -C /x`는 여기서 막는다.
 */
export function decideWorkspaceCommand(cmd, args) {
  const deny = (reason, detail = "") => ({ allowed: false, reason, detail: String(detail).slice(0, 120) });
  const exe = String(cmd ?? "").trim();
  if (!exe) return deny("empty");
  if (/[\\/]/.test(exe)) return deny("command_path", exe);
  const list = Array.isArray(args) ? args.map((a) => String(a)) : [];
  for (const a of list) {
    const value = a.startsWith("-") && a.includes("=") ? a.slice(a.indexOf("=") + 1) : a;
    if (isEscapingPath(value)) return deny("path_escape", a);
  }
  if (exe === "pnpm" || exe === "git") {
    const flag = list.find((a) => DIR_SWITCH_RE.test(a));
    if (flag) return deny("dir_switch", flag);
  }
  if (exe === "pnpm") {
    const i = list.findIndex((a) => !a.startsWith("-"));
    const sub = i < 0 ? "" : list[i];
    if (PNPM_DEPENDENCY_SUBCOMMANDS.has(sub)) return deny("dependencies_fixed", sub);
    if (PNPM_DENIED_SET.has(sub)) return deny(LONG_RUNNING_RE.test(sub) ? "long_running" : "pnpm_subcommand", sub);
    if (WORKSPACE_DENIED_BINS.has(sub)) return deny("deploy_cli", sub);
    if (sub === "run" || sub === "run-script") {
      const script = list.slice(i + 1).find((a) => !a.startsWith("-")) ?? "";
      if (/^deploy/.test(script)) return deny("deploy_script", script);
      if (LONG_RUNNING_RE.test(script)) return deny("long_running", script);
      if (WORKSPACE_DENIED_BINS.has(script)) return deny("deploy_cli", script);
    }
    if (LONG_RUNNING_RE.test(sub)) return deny("long_running", sub);
  }
  if (exe === "git") {
    const sub = list[0] ?? "";
    if (!GIT_ALLOWED_SET.has(sub)) return deny("git_subcommand", sub);
  }
  return { allowed: true };
}

function refusal(reason, detail) {
  return new Error(`REFUSED (${reason})${detail ? `: ${String(detail).slice(0, 160)}` : ""}. This will not be executed. Choose another approach.`);
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".wrangler", ".pnpm-store", ".turbo"]);

/**
 * 작업 폴더 안의 경로(저장소 상대) → 절대 경로. 어느 구성 요소든 심볼릭 링크면 거부(모델 코드가 링크로 밖을 가리켜도
 * root인 서버가 따라가 읽거나 쓰지 않게). forWrite면 아직 없는 꼬리 구성 요소를 허용한다.
 */
export async function resolveInside(appDir, rel, { forWrite = false, fsImpl = fs } = {}) {
  const raw = String(rel ?? "").replace(/\\/g, "/");
  if (isEscapingPath(raw)) throw refusal("path_escape", raw);
  const parts = raw.split("/").filter((s) => s !== "" && s !== ".");
  const root = path.resolve(appDir);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st;
    try {
      st = await fsImpl.lstat(cur);
    } catch (err) {
      if (err?.code === "ENOENT") {
        if (forWrite) break;
        const e = new Error(`not found: ${parts.join("/")}`);
        e.code = "ENOENT";
        throw e;
      }
      throw err;
    }
    if (st.isSymbolicLink()) throw refusal("symlink", parts.slice(0, i + 1).join("/"));
    if (i < parts.length - 1 && !st.isDirectory()) throw refusal("not_a_directory", parts.slice(0, i + 1).join("/"));
  }
  return path.join(root, ...parts);
}

/** 작업 폴더의 파일 목록(저장소 상대, POSIX). 설치물·산출물·.git 제외, 링크는 따라가지 않는다. */
export async function listWorkspaceFiles(appDir, { dir = "", max = 500, fsImpl = fs } = {}) {
  const root = path.resolve(appDir);
  const start = dir ? await resolveInside(root, dir, { fsImpl }) : root;
  const out = [];
  const walk = async (abs) => {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await fsImpl.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.isSymbolicLink()) continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        await walk(child);
      } else if (e.isFile()) {
        out.push(path.relative(root, child).split(path.sep).join("/"));
      }
    }
  };
  await walk(start);
  return out;
}

/** 모델 파일 읽기 상한(바이트). 도구 결과는 runBuildLoop가 한 번 더 자른다. */
const READ_MAX_BYTES = 1024 * 1024;

/**
 * 신뢰 프로세스(root 서버)가 **샌드박스 사용자가 쓸 수 있는 파일**을 읽는 길 — 모델 read_file과 보호 파일 복원이 쓴다.
 *  - 크기 상한: 최대 max+1바이트만 읽는다(truncated로 표시). lstat 크기를 본 뒤 파일이 커져도(검사-사용 경합 — 생성 코드가
 *    남긴 백그라운드 프로세스) 서버 메모리는 max를 넘지 않는다(PR #569 S2 검증 결함 3).
 *  - 마지막 구성 요소가 링크면 열지 않는다(O_NOFOLLOW) · FIFO에서 멈추지 않는다(O_NONBLOCK으로 열고, fstat가 일반 파일이
 *    아니면 읽지 않는다 — 종전 lstat→readFile 사이에 FIFO로 바뀌면 root 서버가 영원히 막혔다).
 * 반환 { isFile, buf, truncated }. 열기 실패는 던진다(ENOENT·ELOOP 등 — 호출자가 판단).
 */
export async function readBoundedFile(abs, max, fsImpl = fs) {
  const limit = Math.max(0, Math.floor(max));
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  const fh = await fsImpl.open(abs, flags);
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { isFile: false, buf: Buffer.alloc(0), truncated: false };
    const buf = Buffer.alloc(limit + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    return { isFile: true, buf: buf.subarray(0, Math.min(n, limit)), truncated: n > limit };
  } finally {
    await fh.close();
  }
}

/**
 * runBuildLoop의 BuildToolExecutor. 경로는 decidePath가 정규화한 저장소 상대 경로로 온다.
 *  - 쓰기: 보호 파일 거부 · 링크 거부 · 마지막 구성 요소는 O_NOFOLLOW로 연다 · 샌드박스 사용자 소유로.
 *  - 명령: decideWorkspaceCommand → 샌드박스 exec(cwd = 작업 폴더, env = 비밀 없는 env, 시간·출력 상한) → ANSI 제거 + 비밀 가리기.
 *  - 읽기: readBoundedFile(상한·O_NOFOLLOW·FIFO 안전).
 *  - 신호(WBS 시간 상한·잡 마감)가 끊긴 뒤의 쓰기·명령은 거부한다 — 시간 상한 뒤 유예가 지나 잡이 다음으로 넘어가도(runTimed)
 *    뒤에 남은 루프가 작업 폴더를 바꾸거나 명령을 띄우지 못한다(PR #569 S2 검증 결함 6).
 * 거부는 던진다 — runBuildLoop가 모델에게 `tool error: REFUSED (...)`로 돌려준다.
 */
export function createWorkspaceExecutor({
  appDir, exec, env, sandbox = null, signal = null, fsImpl = fs, redactLiterals = [],
  maxOutputBytes = EXEC_DEFAULT_MAX_OUTPUT_CHARS, commandTimeoutCapMs = 180_000,
}) {
  const root = path.resolve(appDir);
  const clean = (s) => redactSecrets(stripAnsi(s), redactLiterals);
  const refuseIfStopped = () => {
    if (signal?.aborted) throw refusal("stopped", "the work item's time limit or the job deadline has passed");
  };
  return {
    async readFile(rel) {
      let abs;
      try {
        abs = await resolveInside(root, rel, { fsImpl });
      } catch (err) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
      let got;
      try {
        got = await readBoundedFile(abs, READ_MAX_BYTES, fsImpl);
      } catch (err) {
        if (err?.code === "ENOENT") return null;
        if (err?.code === "ELOOP") throw refusal("symlink", rel);
        if (err?.code === "EISDIR") throw refusal("not_a_file", rel);
        throw err;
      }
      if (!got.isFile) throw refusal("not_a_file", rel);
      const text = got.buf.toString("utf8");
      return got.truncated ? `${text}\n…[file truncated at ${READ_MAX_BYTES} bytes]` : text;
    },
    async listFiles(rel) {
      return listWorkspaceFiles(root, { dir: rel ?? "", fsImpl });
    },
    async createFile(rel, content) {
      refuseIfStopped();
      if (isProtectedAppFile(rel)) throw refusal("protected_file", `${normRel(rel)} is managed by the build platform (restored before the build gate)`);
      const abs = await resolveInside(root, rel, { forWrite: true, fsImpl });
      const parent = path.dirname(abs);
      await fsImpl.mkdir(parent, { recursive: true });
      // mkdir 뒤 다시 — 방금 만든 폴더들 사이에 링크가 끼어들지 않았나
      await resolveInside(root, path.relative(root, parent).split(path.sep).join("/"), { fsImpl });
      const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0);
      const fh = await fsImpl.open(abs, flags, 0o644);
      try {
        await fh.writeFile(String(content), "utf8");
      } finally {
        await fh.close();
      }
      if (sandbox) {
        const lchown = fsImpl.lchown ?? fs.lchown;
        let cur = parent;
        while (cur.startsWith(root) && cur !== root) {
          await lchown(cur, sandbox.uid, sandbox.gid);
          cur = path.dirname(cur);
        }
        await lchown(abs, sandbox.uid, sandbox.gid);
      }
    },
    async runCommand(cmd, args, opts = {}) {
      refuseIfStopped();
      const d = decideWorkspaceCommand(cmd, args);
      if (!d.allowed) throw refusal(d.reason, d.detail);
      const requested = Number(opts.timeoutMs);
      const timeoutMs = Math.min(Number.isFinite(requested) && requested > 0 ? requested : commandTimeoutCapMs, commandTimeoutCapMs);
      const r = await exec(String(cmd), (args ?? []).map(String), { cwd: root, env, timeoutMs, signal, maxOutputBytes });
      return { ok: r.ok === true, code: typeof r.code === "number" ? r.code : -1, stdout: clean(r.stdout), stderr: clean(r.stderr), ...(r.timedOut ? { timedOut: true } : {}) };
    },
  };
}

// ─── 보호 파일 스냅샷·복원 ───────────────────────────────────────────────────────────────────────

/** 스캐폴드 직후 보호 파일 내용(있는 것만). */
export async function snapshotProtected(appDir, fsImpl = fs) {
  const snap = new Map();
  for (const rel of PROTECTED_APP_FILES) {
    const abs = path.join(appDir, ...rel.split("/"));
    const buf = await fsImpl.readFile(abs).catch(() => null);
    if (buf !== null) snap.set(rel, Buffer.from(buf));
  }
  return snap;
}

/**
 * 경로의 구성 요소 중 심볼릭 링크를 지운다(링크 자체만 — 대상은 건드리지 않는다). 모델 코드가 `test/` 폴더를 밖(/builder 등)을
 * 가리키는 링크로 바꿔 두면, root인 서버의 복원이 그 링크를 따라가 작업 폴더 밖에 쓰게 된다 — 복원 전에 끊는다.
 */
async function unlinkLinksOnPath(appDir, rel, fsImpl) {
  let cur = path.resolve(appDir);
  for (const part of rel.split("/")) {
    cur = path.join(cur, part);
    const st = await fsImpl.lstat(cur).catch(() => null);
    if (!st) return;
    if (st.isSymbolicLink()) {
      await fsImpl.rm(cur, { force: true });
      return;
    }
  }
}

/**
 * 보호 파일을 스냅샷 내용으로 되돌린다. 바뀐(또는 없어진·링크로 바뀐) 파일 목록을 돌려준다.
 * 링크로 바뀌었으면(파일 자체든 상위 폴더든) 링크를 지우고 파일로 쓴다(따라가 쓰지 않는다).
 *
 * 비교 읽기는 **스냅샷 크기까지만**(PR #569 S2 검증 결함 3): 보호 파일은 샌드박스 사용자 소유라 게이트의 build·test 중에
 * 생성 코드가 수 GB로 부풀릴 수 있다 — 종전 readFile은 그것을 root 서버 메모리로 통째로 읽었다(OOM → 서버 자멸).
 * 이제 lstat 크기가 스냅샷과 다르면 읽지 않고 곧장 되돌리고, 같아도 readBoundedFile(want.length)로만 읽는다(경합으로 커져도
 * 상한). 읽기가 실패하면 "다르다"로 보고 되돌린다 — rm은 비교 밖에서 하므로 읽기 오류가 링크를 따라 쓰는 길을 열지 않는다.
 * 쓰기는 O_CREAT|O_EXCL|O_NOFOLLOW(방금 지운 자리에 링크·파일이 다시 생겼으면 쓰지 않고 던진다 → 게이트 restore_failed).
 */
export async function restoreProtected(appDir, snapshot, { sandbox = null, fsImpl = fs } = {}) {
  const restored = [];
  for (const [rel, want] of snapshot) {
    const abs = path.join(appDir, ...rel.split("/"));
    let linked = false;
    try {
      await resolveInside(appDir, rel, { forWrite: true, fsImpl });
    } catch {
      linked = true;
      await unlinkLinksOnPath(appDir, rel, fsImpl);
      await resolveInside(appDir, rel, { forWrite: true, fsImpl }); // 그래도 링크면 던진다(게이트가 restore_failed로 멈춘다)
    }
    let same = false;
    try {
      const st = await fsImpl.lstat(abs);
      if (st.isFile() && st.size === want.length) {
        const got = await readBoundedFile(abs, want.length, fsImpl);
        same = got.isFile && !got.truncated && got.buf.length === want.length && Buffer.compare(got.buf, want) === 0;
      }
    } catch {
      same = false;
    }
    if (same && !linked) continue;
    await fsImpl.rm(abs, { recursive: true, force: true });
    await fsImpl.mkdir(path.dirname(abs), { recursive: true });
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
    const fh = await fsImpl.open(abs, flags, 0o644);
    try {
      await fh.writeFile(want);
    } finally {
      await fh.close();
    }
    if (sandbox) await (fsImpl.lchown ?? fs.lchown)(abs, sandbox.uid, sandbox.gid);
    restored.push(rel);
  }
  return restored;
}

// ─── LLM: Worker 프록시 클라이언트 ────────────────────────────────────────────────────────────────

export const ANTHROPIC_VERSION = "2023-06-01";
/** 호출 1회 상한(프록시의 업스트림 대기 상한과 같은 10분). */
export const LLM_CALL_TIMEOUT_MS = 10 * 60 * 1000;
/** 재시도할 상태(프록시가 벤더 오류를 그대로 넘긴다). 우리 쪽 거절은 `x-should-retry: false`라 재시도하지 않는다. */
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

function abortReason(signal) {
  const r = signal?.reason;
  return r instanceof Error ? r : new Error(`aborted${r ? `: ${String(r).slice(0, 80)}` : ""}`);
}

function sleepFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const t = setTimeout(done, Math.max(0, ms));
    function done() {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      reject(abortReason(signal));
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * fetch를 감싼다: 잡·WBS 신호 + 호출당 시간 상한 · 네트워크 오류와 RETRY_STATUSES는 retries번 더(`x-should-retry: false` 제외).
 * 재시도 뒤에도 실패한 응답은 그대로 돌려준다(호출자가 오류로 만든다). 신호가 끊기면 던진다.
 */
export function createRetryingFetch({ fetchImpl = globalThis.fetch, signal = null, timeoutMs = LLM_CALL_TIMEOUT_MS, retries = 2, backoffMs = [2_000, 6_000], sleep = sleepFor } = {}) {
  return async function retryingFetch(url, init = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0, signal);
      if (signal?.aborted) throw abortReason(signal);
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res;
      try {
        res = await fetchImpl(url, { ...init, signal: combined });
      } catch (err) {
        if (signal?.aborted) throw abortReason(signal);
        lastErr = new Error(`llm proxy unreachable: ${String(err?.message ?? err).slice(0, 160)}`);
        continue;
      }
      const noRetry = String(res.headers?.get?.("x-should-retry") ?? "").toLowerCase() === "false";
      if (res.ok || noRetry || !RETRY_STATUSES.has(res.status) || attempt === retries) return res;
      await res.text().catch(() => "");
    }
    throw lastErr ?? new Error("llm proxy failed");
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tokenCount(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 외부 경계(LLM 응답) 명시 가드 — Anthropic Messages 응답을 runBuildLoop가 쓰는 모양으로만 남긴다.
 * content는 text·tool_use 블록만(모르는 키는 버린다 — 다음 턴에 그대로 되돌려 보내므로 프록시 허용 목록에도 맞는다).
 * 모양이 아니면 던진다(빈 응답을 "도구 없음"으로 오해하지 않게).
 */
export function parseAnthropicResponse(json, requestedModel) {
  if (typeof json !== "object" || json === null || !Array.isArray(json.content) || typeof json.usage !== "object" || json.usage === null) {
    throw new Error("invalid_llm_response: not an Anthropic Messages response");
  }
  const content = [];
  for (const b of json.content) {
    if (b?.type === "text" && typeof b.text === "string") content.push({ type: "text", text: b.text });
    else if (b?.type === "tool_use" && typeof b.id === "string" && b.id && typeof b.name === "string" && b.name) content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
  }
  // 걸러서 비었으면(빈 응답·모르는 블록만) 빈 assistant 메시지를 만들지 않는다 — 다음 턴 요청이 프록시 스키마(content ≥1)에서
  // 400이 된다. 텍스트 한 줄로 두면 runBuildLoop가 "도구를 쓰라"고 다시 요구한다.
  if (content.length === 0) content.push({ type: "text", text: "(no usable content in the response)" });
  const u = json.usage;
  return {
    id: typeof json.id === "string" ? json.id : "",
    model: typeof json.model === "string" && json.model.trim() ? json.model.trim() : requestedModel,
    vendor: "anthropic",
    content,
    ...(typeof json.stop_reason === "string" ? { stop_reason: json.stop_reason } : {}),
    usage: {
      input_tokens: tokenCount(u.input_tokens),
      output_tokens: tokenCount(u.output_tokens),
      ...(tokenCount(u.cache_creation_input_tokens) ? { cache_creation_input_tokens: tokenCount(u.cache_creation_input_tokens) } : {}),
      ...(tokenCount(u.cache_read_input_tokens) ? { cache_read_input_tokens: tokenCount(u.cache_read_input_tokens) } : {}),
    },
  };
}

/**
 * Worker 프록시(`<baseUrl>/v1/messages`)로 가는 AnthropicLike 클라이언트. apiKey 자리 = jobToken(`x-api-key`) — 실제 벤더 키는
 * Worker에만 있다. 실패는 `<status> <본문 앞부분>` 오류(+ status·error 필드)로 던진다 — isBudgetExhausted가 402를 안다.
 * 오류 문구에 apiKey를 넣지 않는다(본문은 프록시의 것).
 */
export function createProxyAnthropicClient({ baseUrl, apiKey, fetchImpl = globalThis.fetch, signal = null, retryOptions = {} }) {
  const url = `${String(baseUrl).replace(/\/+$/, "")}/v1/messages`;
  const doFetch = createRetryingFetch({ fetchImpl, signal, ...retryOptions });
  return {
    messages: {
      async create(params) {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
          body: JSON.stringify(params),
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const err = new Error(`${res.status} ${text.slice(0, 300)}`);
          err.status = res.status;
          err.error = safeJson(text);
          throw err;
        }
        return parseAnthropicResponse(safeJson(text), params?.model);
      },
    },
  };
}

// ─── WBS 실패 정책 · 게이트 상수 ───────────────────────────────────────────────────────────────────

/**
 * [PILOT] WBS 하나가 끝내 done이 아닐 때(gave_up · limit_turns · limit_tool_calls · limit_denied · limit_time):
 *   must WBS(그 WBS의 완료 조건 중 하나라도 must 기능) → **멈춤**: failed(implementing, wbs_failed:<id>:<상태>)
 *   그 밖(should·could만)                              → **기록 후 계속**: 그 WBS의 변경은 되돌리고(깨진 코드로 뒤를 막지 않게) 다음 WBS
 *   실패·건너뛴 WBS에 기대는(dependsOn) WBS           → LLM 호출 없이 **건너뜀**(그 자신이 must면 멈춤: wbs_blocked:<id>:<선행>)
 * 페이로드에 must가 없으면(옛 Worker) must로 본다 — 보수 쪽.
 */
export const WBS_FAILURE_POLICY = Object.freeze({ must: "stop", optional: "continue", dependents: "skip" });
/** 항목 탓이 아니라 LLM 경로가 막힌 것 — must 여부와 상관없이 멈춘다(뒤 항목도 똑같이 실패하며 시간만 쓴다). */
export const WBS_ALWAYS_STOP_STATUSES = Object.freeze(["llm_error"]);
/** [PILOT] WBS 하나의 벽시계 상한(잡 전체 45분 안에서). 넘으면 limit_time. */
export const WBS_TIME_LIMIT_MS = 10 * 60 * 1000;

export function decideWbsFailure(item, status) {
  if (WBS_ALWAYS_STOP_STATUSES.includes(status)) return "stop";
  return item?.must === false ? WBS_FAILURE_POLICY.optional : WBS_FAILURE_POLICY.must;
}

/** 빌드 게이트 명령(순서대로). 설치는 lockfile 고정 + 오프라인(이미지에 미리 받은 저장소). */
export const GATE_COMMANDS = Object.freeze({
  install: Object.freeze(["pnpm", Object.freeze(["install", "--frozen-lockfile", "--offline"])]),
  build: Object.freeze(["pnpm", Object.freeze(["run", "build"])]),
  test: Object.freeze(["pnpm", Object.freeze(["test"])]),
});

/** [PILOT] 게이트 상한. repairRounds = 게이트 전체(빌드·테스트 합산)의 수리 라운드 수. */
export const GATE_LIMITS = Object.freeze({
  installMs: 5 * 60 * 1000,
  buildMs: 6 * 60 * 1000,
  testMs: 5 * 60 * 1000,
  repairRounds: 2,
  repairTimeMs: 6 * 60 * 1000,
  /** 모델에게 주는 실패 로그 끝부분(문자). */
  logTailChars: 6_000,
  /** 진행 이벤트(D1 build_job_events.meta)에 싣는 끝부분(문자). */
  eventLogTailChars: 1_500,
  maxOutputBytes: 512 * 1024,
});

/** 수리 라운드의 루프 상한(WBS보다 짧게). */
export const REPAIR_LIMITS = Object.freeze({ maxTurnsPerTask: 12, maxToolCalls: 30 });

/** 설치 명령 인자 — 샌드박스 저장소가 있으면 명시(pnpm이 파일시스템마다 다른 저장소를 고르지 않게). */
export function installArgs({ storeDir = null, offline = true } = {}) {
  const base = offline ? [...GATE_COMMANDS.install[1]] : ["install", "--frozen-lockfile", "--prefer-offline"];
  return storeDir ? [...base, "--store-dir", storeDir] : base;
}

// ─── 모델에게 주는 작업 설명 ───────────────────────────────────────────────────────────────────────

/** 지시서 마크다운 상한(턴마다 다시 보낸다 — 프록시 요청 상한 4MB보다 한참 작게). */
export const SPEC_MAX_CHARS = 60_000;

/**
 * runBuildLoop BuildTask.specMarkdown = 지시서 + 이 잡의 규칙 + 다른 WBS 목록(+ 수리면 실패 로그 끝부분).
 * WBS 항목·완료 조건 ID·파일 목록은 runBuildLoop가 따로 싣는다.
 */
export function buildTaskMarkdown(job, item, { plan = [], repair = null, redactLiterals = [] } = {}) {
  const spec = String(job.specMarkdown ?? "");
  const clipped = spec.length > SPEC_MAX_CHARS ? `${spec.slice(0, SPEC_MAX_CHARS)}\n…[spec truncated — ${spec.length - SPEC_MAX_CHARS} chars omitted]` : spec;
  const lines = [
    clipped,
    "",
    "## Build platform rules (Simsa)",
    `- Product: ${job.productName}`,
    "- Dependencies are fixed: installs run `pnpm install --frozen-lockfile --offline`. Do not add or remove packages.",
    `- These files are managed by the platform and are restored before the build gate: ${PROTECTED_APP_FILES.join(", ")}.`,
    "- Keep `GET /api/health` returning `{ \"ok\": true }` and unknown `/api/*` routes returning 404 — the platform smoke test checks both.",
    "- The build gate runs `pnpm install --frozen-lockfile --offline` → `pnpm run build` → `pnpm test`. You may add tests as `test/*.test.mjs` (node:test).",
    "- Database changes go in a new file `migrations/NNNN_name.sql` (4 digits, then ASCII letters, digits, `_` or `-` — e.g. `0002_add_reservations.sql`). Never edit an existing migration. The platform applies them in name order when it deploys.",
    "- Implement only the current work item. Other items are done separately.",
  ];
  if (plan.length > 0) {
    lines.push("", "## Work items (context)");
    for (const p of plan.slice(0, 120)) lines.push(`- ${p.id} [${p.state}]${p.must === false ? "" : " (must)"}: ${p.title}`);
  }
  if (!repair) lines.push("", `This work item is ${item.must === false ? "optional (should/could)" : "required (must)"}.`);
  if (repair) {
    lines.push(
      "",
      `## Build gate failure to fix (repair round ${repair.round} of ${repair.maxRounds})`,
      `Stage: ${repair.stage}`,
      `Command: ${repair.command} (${repair.exitLabel})`,
      "```",
      redactSecrets(stripAnsi(repair.logTail), redactLiterals),
      "```",
      "Fix the cause with the smallest change, then run the same command to confirm. Do not weaken tests, build settings or type checks.",
    );
  }
  return lines.join("\n");
}

// ─── 기본 implementWbs (B-5b-2) ────────────────────────────────────────────────────────────────────

/**
 * WBS(또는 수리 라운드) 하나 = agent-worker runBuildLoop 한 번.
 *   클라이언트 = withOpenAiFallback(프록시 Anthropic 클라이언트, { 프록시 OpenAI 경로, apiKey = jobToken })
 *   실행기     = createWorkspaceExecutor(작업 폴더·샌드박스 exec·비밀 없는 env)
 *   맥락       = buildTaskMarkdown(지시서 + 규칙 + WBS 목록 [+ 실패 로그]) + 이 항목 + 완료 조건 ID + 현재 파일 목록
 * 로컬 EfficiencyGate 상한은 잡 예산 이상(max(budgetUsd, 0.5)) — 예산의 권위는 Worker 프록시(402)다.
 */
export function createDefaultImplementWbs({ agentWorker, fetchImpl = globalThis.fetch, sandbox = null, log = () => {}, fsImpl = fs, retryOptions = {}, maxOutputBytes = EXEC_DEFAULT_MAX_OUTPUT_CHARS } = {}) {
  if (!agentWorker || typeof agentWorker.runBuildLoop !== "function" || typeof agentWorker.withOpenAiFallback !== "function") {
    throw new Error("agent_worker_missing_exports");
  }
  return async function implementWbs({ item, job, appDir, llm, exec, signal, env, plan = [], repair = null }) {
    const literals = [llm.apiKey];
    const executor = createWorkspaceExecutor({ appDir, exec, env, sandbox, signal, fsImpl, redactLiterals: literals, maxOutputBytes });
    const fileList = await listWorkspaceFiles(appDir, { max: 400, fsImpl });
    const primary = createProxyAnthropicClient({ baseUrl: llm.anthropicBaseUrl, apiKey: llm.apiKey, fetchImpl, signal, retryOptions });
    const client = agentWorker.withOpenAiFallback(primary, {
      openaiApiKey: llm.apiKey,
      openaiBaseUrl: llm.openaiBaseUrl,
      ...(llm.openaiModel ? { model: llm.openaiModel } : {}),
      preferFallback: llm.preferFallback === true,
      fetchImpl: createRetryingFetch({ fetchImpl, signal, ...retryOptions }),
    });
    const limits = repair ? { ...(agentWorker.BUILD_LIMITS ?? {}), ...REPAIR_LIMITS } : undefined;
    return agentWorker.runBuildLoop(
      {
        specMarkdown: buildTaskMarkdown(job, item, { plan, repair, redactLiterals: literals }),
        wbsId: item.id,
        wbsTitle: item.title,
        acceptanceIds: item.acceptanceIds ?? [],
        locale: job.locale,
        fileList,
      },
      {
        client,
        executor,
        model: llm.model,
        ...(limits ? { limits } : {}),
        baseEnv: env,
        budgetUsd: Math.max(Number(job.budgetUsd) || 0, 0.5),
        onEvent: (line) => log(redactSecrets(stripAnsi(line), literals).slice(0, 300)),
      },
    );
  };
}
