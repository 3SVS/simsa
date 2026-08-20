/**
 * workspace-export-stack.test.mjs — 스택 불가지 Phase 2 (D-1~D-4 LOCKED 2026-08-20).
 *
 * 빌더팩이 유저가 답한 조합(hosting/data)을 실제로 소비하는지 고정한다.
 * 핵심 계약: 미응답 = 중립(물음-먼저) — 종전의 "무조건 Supabase/Vercel" 기본은
 * 명시적 답변이 있을 때만 나간다. 이 테스트들은 P2 이전 코드에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { generateBuilderPack } = await import("../dist/workspace/export.js");

const SPEC = {
  productName: "영수증 정리 앱",
  oneLine: "영수증 사진을 올려 월별로 정리",
  targetUsers: ["자영업자"],
  problem: "영수증이 쌓여요.",
  included: ["영수증 사진 업로드", "월별 정리"],
  excluded: ["세무 신고"],
  userFlow: ["업로드", "확인"],
  decisions: [],
  openQuestions: [],
};
const ITEMS = [
  { id: "r1", title: "영수증 사진을 업로드할 수 있어야 함", status: "not_started", criteria: ["업로드 후 목록 표시"] },
];

function pack(userProfile, extra = {}) {
  return generateBuilderPack({
    project: { title: SPEC.productName, productSpec: SPEC, items: ITEMS },
    target: "claude_code",
    format: "json",
    locale: "ko",
    ...(userProfile ? { userProfile } : {}),
    ...extra,
  });
}
const promptOf = (res) => res.bundle.files.find((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md")).content;

describe("스택 불가지 P2 — data 축", () => {
  it("미응답 → 중립(물음-먼저), Supabase를 기본값처럼 단정하지 않는다 (D-2)", () => {
    const p = promptOf(pack(undefined));
    assert.doesNotMatch(p, /https:\/\/supabase\.com/);
    assert.match(p, /먼저 사용자에게 이미 쓰는 데이터 서비스가 있는지 물어라/);
  });

  it("data=supabase → 종전 Supabase 워크스루 유지", () => {
    const p = promptOf(pack({ data: "supabase" }));
    assert.match(p, /https:\/\/supabase\.com/);
    assert.match(p, /Supabase Storage/); // uploads도 supabase 변형
  });

  it("data=firebase → Firebase 워크스루 + Firebase Storage 업로드, Supabase 없음", () => {
    const p = promptOf(pack({ data: "firebase" }));
    assert.match(p, /console\.firebase\.google\.com/);
    assert.match(p, /Firebase Storage/);
    assert.doesNotMatch(p, /https:\/\/supabase\.com|Supabase Storage/);
  });

  it("data=builder_managed → 빌더 내장 안내, 외부 DB 이관 제안 금지 문구", () => {
    const p = promptOf(pack({ data: "builder_managed" }));
    assert.match(p, /빌더의 데이터\/DB 패널|만들던 도구 안에서 관리/);
    assert.doesNotMatch(p, /https:\/\/supabase\.com/);
  });

  it('data=other("PocketBase") → 그 서비스 기준 안내, 다른 서비스로 치환 금지 (D-3)', () => {
    const p = promptOf(pack({ data: "other", dataOther: "PocketBase" }));
    assert.match(p, /PocketBase/);
    assert.match(p, /다른 서비스로 바꾸지 말고/);
    assert.doesNotMatch(p, /https:\/\/supabase\.com/);
  });

  it("data=none → 데이터 워크스루 자체가 없다", () => {
    const p = promptOf(pack({ data: "none" }));
    assert.doesNotMatch(p, /https:\/\/supabase\.com|데이터 저장\(필요해지면\)/);
  });
});

describe("스택 불가지 P2 — hosting 축", () => {
  it("hosting=netlify → Netlify 기준 배포 안내, Vercel 경로 없음", () => {
    const p = promptOf(pack({ hosting: "netlify" }));
    assert.match(p, /Netlify를 쓴다|app\.netlify\.com/);
    assert.doesNotMatch(p, /https:\/\/vercel\.com/);
    // MCP 배포 지시의 연결 안내도 Netlify 기준
    assert.match(p, /에디터에서 Netlify\(또는 GitHub\) 연결/);
  });

  it('hosting=other("회사 서버") → 그 호스팅 기준, 바꾸자고 하지 않기', () => {
    const p = promptOf(pack({ hosting: "other", hostingOther: "회사 서버" }));
    assert.match(p, /회사 서버 에 올린다|회사 서버 대시보드/);
    assert.match(p, /바꾸자고 하지 마라|대체하지 마라/);
  });

  it("hosting=builder_hosted → Publish 버튼 안내, MCP 배포 지시 없음", () => {
    const p = promptOf(pack({ hosting: "builder_hosted" }));
    assert.match(p, /Publish\/Deploy 버튼/);
    assert.doesNotMatch(p, /한 번에 배포 — 네게 연결된 도구로/);
  });

  it("hosting 미응답 → 종전 물음-먼저 경로 선택 안내 유지 (무회귀)", () => {
    const p = promptOf(pack(undefined));
    assert.match(p, /GitHub을 강요하지 마라/);
    assert.match(p, /Netlify Drop/);
  });
});

describe("스택 불가지 P2 — EN", () => {
  it("data=firebase EN → 영어 Firebase 블록, 한글 누수 없음(서비스 안내 영역)", () => {
    const res = generateBuilderPack({
      project: {
        title: "Receipt organizer",
        productSpec: { ...SPEC, productName: "Receipt organizer", oneLine: "Upload receipt photos", included: ["photo upload"], excluded: [], problem: "receipts pile up", targetUsers: ["owners"], userFlow: [], decisions: [], openQuestions: [] },
        items: [{ id: "r1", title: "Users can upload a receipt photo", status: "not_started", criteria: ["shows in list"] }],
      },
      target: "claude_code",
      format: "json",
      locale: "en",
      userProfile: { data: "firebase", hosting: "netlify" },
    });
    const p = promptOf(res);
    assert.match(p, /console\.firebase\.google\.com/);
    assert.match(p, /this user is on Netlify/i);
    assert.doesNotMatch(p, /https:\/\/supabase\.com/);
    assert.doesNotMatch(p, /[가-힣]/);
  });
});
