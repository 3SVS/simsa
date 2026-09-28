/**
 * 키 없음 → "키 없음 — 실행 대기" 로 정직하게 끝난다.
 *
 * 고정하는 것:
 *  ① 모든 진입 스크립트(setup·serve·run-checkout·scenarios)가 값 없이 실행되면 종료 코드 3.
 *     0(성공)도 1(오류)도 아니다 — 체인이 '실행 대기'를 성공으로 세지 못하게.
 *  ② 그때 네트워크 0 — 자식 프로세스의 fetch 를 막아 두고(no-network.mjs), 불리면 97로 죽는다.
 *  ③ 증거 폴더를 만들지 않는다(빈 증거가 '실행함'으로 오해되지 않게).
 *  ④ 출력에 값이 아니라 **이름**만 나온다.
 *  ⑤ requireOrWait 단위: 값이 있으면 돌려주고, 로그에 값이 새지 않는다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXIT_WAITING, WAITING_MESSAGE, requireOrWait, parseEnvFile } from "../lib/env.mjs";
import { FAKE_SANDBOX_KEY } from "./helpers/fakes.mjs";

const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NO_NET = pathToFileURL(join(SPIKE_DIR, "test", "helpers", "no-network.mjs")).href;

/** PADDLE_* 를 전부 지운 환경 + 존재하지 않는 env 파일 + 임시 증거 폴더. */
function cleanEnv(tmp) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("PADDLE_") && v !== undefined) env[k] = v;
  env.PADDLE_SPIKE_ENV_FILE = join(tmp, "does-not-exist.env.local");
  env.PADDLE_SPIKE_EVIDENCE_DIR = join(tmp, "evidence");
  return env;
}

const ENTRIES = [
  { script: "setup.mjs", args: [], needs: ["PADDLE_SANDBOX_API_KEY"] },
  { script: "serve.mjs", args: [], needs: ["PADDLE_SANDBOX_CLIENT_TOKEN"] },
  { script: "run-checkout.mjs", args: ["--count", "1"], needs: ["PADDLE_SANDBOX_API_KEY", "PADDLE_SANDBOX_CLIENT_TOKEN"] },
  { script: "scenarios.mjs", args: ["S-A"], needs: ["PADDLE_SANDBOX_API_KEY"] },
];

describe("① ~ ④ 진입 스크립트 — 키 없음이면 코드 3, 네트워크 0, 증거 0", () => {
  for (const { script, args, needs } of ENTRIES) {
    it(`${script} ${args.join(" ")}`.trim(), () => {
      const tmp = mkdtempSync(join(tmpdir(), "paddle-spike-honest-"));
      const env = cleanEnv(tmp);
      const res = spawnSync(process.execPath, ["--import", NO_NET, join(SPIKE_DIR, script), ...args], {
        cwd: SPIKE_DIR,
        env,
        encoding: "utf8",
        timeout: 30_000,
      });
      const out = `${res.stdout}\n${res.stderr}`;
      assert.notEqual(res.status, 97, `네트워크 호출이 일어났다:\n${out}`);
      assert.equal(res.status, EXIT_WAITING, `종료 코드 ${res.status}:\n${out}`);
      assert.ok(out.includes(WAITING_MESSAGE), out);
      for (const name of needs) assert.ok(out.includes(name), `없는 값 이름 ${name} 이 출력에 없다:\n${out}`);
      assert.equal(existsSync(env.PADDLE_SPIKE_EVIDENCE_DIR), false, "증거 폴더가 만들어졌다");
    });
  }
});

describe("⑤ requireOrWait 단위", () => {
  it("값 없음 → 로그에 대기 문구, exit(3), null", () => {
    const logs = [];
    let code = null;
    const tmp = mkdtempSync(join(tmpdir(), "paddle-spike-rw-"));
    const out = requireOrWait(["PADDLE_SANDBOX_API_KEY"], {
      env: {},
      envFile: join(tmp, "nope"),
      log: (s) => logs.push(s),
      exit: (c) => {
        code = c;
      },
    });
    assert.equal(out, null);
    assert.equal(code, 3);
    assert.match(logs.join("\n"), /키 없음 — 실행 대기/);
  });

  it("env 파일에 값이 있으면 돌려주고, 로그에 값이 새지 않는다", () => {
    const tmp = mkdtempSync(join(tmpdir(), "paddle-spike-rw2-"));
    const file = join(tmp, ".env.local");
    writeFileSync(file, `# 주석\nPADDLE_SANDBOX_API_KEY="${FAKE_SANDBOX_KEY}"\n`, "utf8");
    const logs = [];
    const out = requireOrWait(["PADDLE_SANDBOX_API_KEY"], {
      env: {},
      envFile: file,
      log: (s) => logs.push(s),
      exit: () => assert.fail("exit 불리면 안 됨"),
    });
    assert.equal(out.PADDLE_SANDBOX_API_KEY, FAKE_SANDBOX_KEY);
    assert.ok(!logs.join("\n").includes(FAKE_SANDBOX_KEY));
  });

  it("공백뿐인 값은 없는 것으로 친다 · 프로세스 env 는 PADDLE_* 만 파일을 덮는다", () => {
    const logs = [];
    let code = null;
    requireOrWait(["PADDLE_SANDBOX_API_KEY"], {
      env: { PADDLE_SANDBOX_API_KEY: "   ", OTHER: "x" },
      envFile: "",
      log: (s) => logs.push(s),
      exit: (c) => {
        code = c;
      },
    });
    assert.equal(code, 3);
  });

  it("env 파서: 주석·빈 줄·따옴표·잘못된 키", () => {
    assert.deepEqual(parseEnvFile("# c\n\nA_B='x y'\nbad-key=1\nC=\"한글 값\"\nNOEQ\n"), { A_B: "x y", C: "한글 값" });
  });
});
