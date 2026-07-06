import { describe, it } from "node:test";
import assert from "node:assert/strict";

// B guard (prompt version of the #271 no-store guard).
//
// The builder-pack prompts (CLAUDE_CODE_PROMPT.md / CODEX_PROMPT.md) are pasted
// verbatim into an AI chat window — a secret-leak surface. When the user set up
// services in Simsa, the prompt must inject FACTS (which services exist, which
// env var KEYS to read) but NEVER a real secret VALUE. Values live only in the
// gitignored `.env.local`. This test bakes distinctive sentinel values into the
// service inputs and asserts they appear in `.env.local` but in NO prompt text.

const { generateBuilderPack } = await import("../dist/workspace/export.js");

// Distinctive sentinels — highly unlikely to occur by chance in prompt boilerplate.
const SENTINELS = {
  supabaseUrl: "https://ZQXSENTINEL9projref.supabase.co",
  anonKey: "eyJZQX-ANON-SENTINEL-abc123-do-not-leak",
  serviceKey: "eyJZQX-SERVICE-ROLE-SENTINEL-xyz789-server-only",
};

const MOCK_SPEC = {
  productName: "회의록 요약 앱",
  oneLine: "회의를 녹음하면 요약과 할 일이 정리됩니다",
  targetUsers: ["회의 많은 팀"],
  problem: "정리에 시간이 오래 걸립니다.",
  included: ["녹음 업로드", "요약 생성"],
  excluded: ["실시간 녹음"],
  userFlow: ["업로드", "요약", "확인"],
  decisions: [],
  openQuestions: [],
};

const MOCK_ITEMS = [
  { id: "req_001", title: "녹음 파일 업로드", status: "not_started", criteria: ["mp3 지원"] },
];

// Services carrying REAL values (as the setup UI would supply). The prompt must
// reference the keys/labels but never echo these values.
const SERVICES = [
  {
    id: "supabase",
    label: "Supabase (데이터베이스·인증)",
    setupUrl: "https://supabase.com",
    envVars: [
      {
        key: "NEXT_PUBLIC_SUPABASE_URL",
        description: "프로젝트 URL",
        example: "https://xxxx.supabase.co",
        secret: false,
        value: SENTINELS.supabaseUrl,
      },
      {
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        description: "공개 anon 키",
        example: "eyJ...",
        secret: false,
        value: SENTINELS.anonKey,
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        description: "관리자 키",
        example: "eyJ...",
        secret: true,
        value: SENTINELS.serviceKey,
      },
    ],
  },
];

function makeReq(target) {
  return {
    project: { title: MOCK_SPEC.productName, productSpec: MOCK_SPEC, items: MOCK_ITEMS },
    target,
    format: "json",
    locale: "ko",
    services: SERVICES,
  };
}

function fileByPath(res, suffix) {
  return res.bundle.files.find((f) => f.path.endsWith(suffix));
}

const ALL_VALUES = Object.values(SENTINELS);
const PROMPT_FILES = ["CLAUDE_CODE_PROMPT.md", "CODEX_PROMPT.md"];

describe("builder-pack prompt never contains a real secret value (B)", () => {
  it("both prompts inject the service KEYS but no VALUES", () => {
    const res = generateBuilderPack(makeReq("both"));
    for (const suffix of PROMPT_FILES) {
      const file = fileByPath(res, suffix);
      assert.ok(file, `${suffix} should be generated`);
      const text = file.content;
      // Reference present: keys + label appear so the agent knows what's wired.
      assert.ok(text.includes("NEXT_PUBLIC_SUPABASE_URL"), `${suffix} should reference the env var key`);
      assert.ok(text.includes("Supabase"), `${suffix} should name the service`);
      assert.ok(text.includes(".env.local"), `${suffix} should point at .env.local for values`);
      // No value leaks — the core assertion.
      for (const value of ALL_VALUES) {
        assert.ok(
          !text.includes(value),
          `${suffix} leaked a secret value into the prompt: ${value}`,
        );
      }
    }
  });

  it("values DO land in .env.local (proof they went to the right place)", () => {
    const res = generateBuilderPack(makeReq("both"));
    const envLocal = fileByPath(res, ".env.local");
    assert.ok(envLocal, ".env.local should be generated when values are supplied");
    for (const value of ALL_VALUES) {
      assert.ok(envLocal.content.includes(value), `.env.local should hold the value: ${value}`);
    }
  });

  it("no value leaks into ANY committed pack file (only .env.local, which is gitignored)", () => {
    const res = generateBuilderPack(makeReq("both"));
    for (const file of res.bundle.files) {
      if (file.path.endsWith(".env.local")) continue; // gitignored secret store
      for (const value of ALL_VALUES) {
        assert.ok(
          !file.content.includes(value),
          `${file.path} leaked a secret value: ${value}`,
        );
      }
    }
  });

  it("prompt reference block is omitted when no services are supplied", () => {
    const res = generateBuilderPack({
      project: { title: MOCK_SPEC.productName, productSpec: MOCK_SPEC, items: MOCK_ITEMS },
      target: "both",
      format: "json",
      locale: "ko",
    });
    const claude = fileByPath(res, "CLAUDE_CODE_PROMPT.md");
    assert.ok(claude);
    assert.ok(
      !claude.content.includes("이미 준비된 서비스"),
      "services block should not appear when no services are set up",
    );
  });
});
