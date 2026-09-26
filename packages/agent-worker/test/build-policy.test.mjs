/**
 * B4 — 빌드 에이전트 도구 정책. D-6 "유저 배포 명령 차단"을 코드로 고정한다.
 * 규칙: 차단 테스트는 정책이 없던 코드에서 실패해야 한다(모듈 자체가 신설이라 옛 코드=import 실패).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { decideCommand, decidePath, findSecretLike, filterEnv, ALLOWED_ENV_KEYS, COMMAND_ALLOWLIST, BUILD_LIMITS } = await import("../dist/build-policy.js");

describe("decideCommand — D-4 허용 목록 · D-6 배포 CLI 차단", () => {
  it("허용: pnpm/node/git/ls/cat의 빌드·테스트·읽기 명령", () => {
    for (const [c, a] of [["pnpm", ["install"]], ["pnpm", ["run", "build"]], ["pnpm", ["test"]], ["pnpm", ["add", "zod"]], ["node", ["scripts/check.mjs"]], ["git", ["status"]], ["git", ["diff"]], ["git", ["add", "-A"]], ["git", ["commit", "-m", "wip"]], ["ls", ["src"]], ["cat", ["package.json"]]]) {
      assert.deepEqual(decideCommand(c, a), { allowed: true }, `${c} ${a.join(" ")}`);
    }
  });
  it("★D-6: vercel·netlify·wrangler·gh·curl·npx… 는 실행 파일 이름만으로 거부", () => {
    for (const c of ["vercel", "netlify", "wrangler", "gh", "curl", "wget", "npx", "npm", "aws", "ssh", "bash", "sh", "sudo"]) {
      const d = decideCommand(c, ["deploy"]);
      assert.equal(d.allowed, false, c);
      assert.equal(d.reason, "deploy_cli", c);
    }
    // 경로로 우회해도 basename으로 잡는다
    assert.equal(decideCommand("/usr/local/bin/vercel", ["--prod"]).reason, "deploy_cli");
    assert.equal(decideCommand("node_modules\\.bin\\wrangler", ["deploy"]).reason, "deploy_cli");
  });
  it("★허용 실행 파일의 위험 하위 명령: git push/remote, pnpm dlx/exec/deploy, node -e", () => {
    assert.equal(decideCommand("git", ["push", "origin", "main"]).reason, "denied_subcommand");
    assert.equal(decideCommand("git", ["remote", "add", "x", "https://…"]).reason, "denied_subcommand");
    assert.equal(decideCommand("pnpm", ["dlx", "vercel"]).reason, "denied_subcommand");
    assert.equal(decideCommand("pnpm", ["exec", "wrangler", "deploy"]).reason, "denied_subcommand");
    assert.equal(decideCommand("pnpm", ["deploy"]).reason, "denied_subcommand");
    assert.equal(decideCommand("pnpm", ["run", "deploy"]).reason, "denied_subcommand");
    assert.equal(decideCommand("node", ["-e", "process.env"]).reason, "denied_subcommand");
  });
  it("셸 메타문자는 인자 어디에 있든 거부(인자 배열 실행이라도 숨긴 체인 금지)", () => {
    for (const a of [["build;", "vercel"], ["build", "&&", "vercel"], ["run", "build", "|", "sh"], ["$(vercel)"], ["`vercel`"], [">", "/etc/x"]]) {
      assert.equal(decideCommand("pnpm", a).reason, "shell_meta", a.join(" "));
    }
  });
  it("목록 밖 실행 파일(python, make…)은 not_allowlisted · 빈 명령은 empty", () => {
    assert.equal(decideCommand("python", ["x.py"]).reason, "not_allowlisted");
    assert.equal(decideCommand("make", []).reason, "not_allowlisted");
    assert.equal(decideCommand("", []).reason, "empty");
    assert.deepEqual([...COMMAND_ALLOWLIST].sort(), ["cat", "git", "ls", "node", "pnpm"]);
  });
});

describe("decidePath — 저장소 안 · 비밀·플랫폼 설정 보호", () => {
  it("허용: 일반 소스·마이그레이션·README·.env.example", () => {
    for (const p of ["src/worker.ts", "src/client/App.tsx", "migrations/0002_orders.sql", "README.md", "package.json", ".env.example", "./src/x.ts", "src//y.ts"]) {
      assert.equal(decidePath(p).allowed, true, p);
    }
    assert.equal(decidePath("./src//y.ts").path, "src/y.ts");
  });
  it("거부: 탈출·절대·.git·.github·node_modules·.env·키 파일·wrangler.toml·pnpm-workspace·.npmrc", () => {
    const cases = { "../x": "traversal", "src/../../etc/passwd": "traversal", "/etc/passwd": "absolute", "C:/x": "absolute", ".git/config": "denied_path", ".github/workflows/x.yml": "denied_path", "node_modules/a/index.js": "denied_path", ".env": "denied_path", ".env.production": "denied_path", "keys/server.pem": "denied_path", "id_rsa.key": "denied_path", "wrangler.toml": "denied_path", "sub/wrangler.jsonc": "denied_path", "pnpm-workspace.yaml": "denied_path", ".npmrc": "denied_path", "": "empty" };
    for (const [p, reason] of Object.entries(cases)) {
      const d = decidePath(p);
      assert.equal(d.allowed, false, p);
      assert.equal(d.reason, reason, p);
    }
  });
});

describe("findSecretLike · filterEnv (D-6 환경변수 allowlist)", () => {
  it("비밀 패턴 탐지, 평범한 코드는 통과", () => {
    assert.ok(findSecretLike('const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";'));
    assert.ok(findSecretLike("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(findSecretLike("token = ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
    assert.ok(findSecretLike("cfat_FAKEFIXTUREtoken0123456789abcdefghijKLMN"));
    assert.ok(findSecretLike("-----BEGIN PRIVATE KEY-----"));
    assert.ok(findSecretLike("postgres://user:pa55word@db.example.com/app"));
    assert.equal(findSecretLike("const apiKey = process.env.API_KEY;"), null);
    assert.equal(findSecretLike("// 동네 빵집 픽업 예약 — 한글 주석"), null);
  });
  it("★배포 토큰 키 이름은 allowlist에 없고 filterEnv가 떨어뜨린다", () => {
    for (const k of ["VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "HOSTING_CF_API_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY"]) {
      assert.ok(!ALLOWED_ENV_KEYS.has(k), k);
    }
    const env = filterEnv({ PATH: "/usr/bin", HOME: "/home/x", NODE_ENV: "production", VERCEL_TOKEN: "v", CLOUDFLARE_API_TOKEN: "c", ANTHROPIC_API_KEY: "a", CI: "1" });
    assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/home/x", NODE_ENV: "production", CI: "1" });
  });
  it("[PILOT] 상한 상수가 있다", () => {
    assert.ok(BUILD_LIMITS.maxDenied >= 1 && BUILD_LIMITS.maxTurnsPerTask >= 4);
  });
});

describe("build-policy.ts는 의존성 0 (컨테이너 이미지 standalone 컴파일용)", () => {
  it("import 문이 없다", () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(HERE, "../src/build-policy.ts"), "utf8");
    assert.doesNotMatch(src, /^\s*import\s/m);
  });
});
