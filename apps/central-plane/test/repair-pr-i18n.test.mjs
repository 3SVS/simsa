/**
 * repair-pr-i18n.test.mjs — Train E (2026-07-21): repair PR 산문 EN/KO.
 *
 * Pins:
 *   - buildAutoFixPrContent / buildRepairPrContent / buildBriefOnlyDiagnosis:
 *     locale="en" → 산문에 한글 0 (agent-supplied 입력 제외 — 여기선 EN 입력 사용)
 *   - locale 미지정 → 기존 KO 동작 그대로 (하위호환)
 *   - [skip conclave] 마커·commitMessage 포맷은 locale 무관(기계 계약)
 *   - dispatchRepairJob payload가 locale을 컨테이너로 전달
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAutoFixPrContent } from "../dist/workspace/repair-brief.js";

const { buildRepairPrContent, buildBriefOnlyDiagnosis } = await import(
  "../container/coerce-result.mjs"
);
const { dispatchRepairJob } = await import("../dist/routes/workspace-repair-jobs.js");

const noHangul = (s) => !/[가-힣]/.test(s);

test("buildAutoFixPrContent: en → no Hangul in title/commit/body; ko default unchanged", () => {
  const input = {
    runId: "wvc_x",
    intent: "Applicants can start and complete the application",
    decision: "Needs Fix",
    targetUrl: "https://app.example.com",
    visualCheckId: "wvc_x",
    envCause: true,
    findings: [{ severity: "blocker", severityLabel: "높음", what: "The API base points at localhost", how: "Point it at the deployed URL" }],
    changedFiles: ["index.html"],
    workerCommitMessage: "fix(api): point base at production",
    editedOversizeFiles: ["index.html"],
  };
  const en = buildAutoFixPrContent({ ...input, locale: "en" });
  for (const text of [en.title, en.commitBody, en.body]) {
    assert.ok(noHangul(text), `Hangul leaked in EN output: ${text.slice(0, 120)}`);
  }
  assert.match(en.title, /^Simsa auto-repair: /);
  assert.ok(en.body.includes("Large files were edited in place"));
  assert.ok(en.body.includes("Possible environment cause"));
  assert.ok(en.body.includes("<!-- [skip conclave] -->"), "marker is locale-invariant");
  assert.equal(en.commitMessage, "fix(simsa): apply repair for wvc_x", "commit subject is machine contract");

  const ko = buildAutoFixPrContent(input); // locale omitted
  assert.match(ko.title, /^Simsa 자동 수리: /);
  assert.ok(ko.body.includes("큰 파일은 필요한 부분만 고쳤어요"));
  assert.ok(ko.body.includes("<!-- [skip conclave] -->"));
});

test("buildRepairPrContent: en → no Hangul in title/body/brief; ko default unchanged", () => {
  const payload = {
    intent: "Applicants can apply",
    decision: "Needs Fix",
    targetUrl: "https://app.example.com",
    visualCheckId: "wvc_y",
    agentPrompt: "[Target]\n- URL: https://app.example.com",
    envCause: true,
  };
  const en = buildRepairPrContent({ ...payload, locale: "en" });
  assert.match(en.title, /^Simsa repair starting point: /);
  assert.ok(noHangul(en.title) && noHangul(en.body) && noHangul(en.briefContent));
  assert.ok(en.body.includes("no auto-applied code changes"));
  assert.equal(en.briefFileName, "SIMSA-FIX-BRIEF.md", "file name is machine contract");

  const ko = buildRepairPrContent(payload);
  assert.match(ko.title, /^Simsa 수리 시작점: /);
  assert.ok(ko.body.includes("자동 적용된 코드 수정이 없습니다"));
});

test("buildBriefOnlyDiagnosis: prNote localized; modeReason stays machine-readable", () => {
  const diag = { skippedOversize: [{ path: "index.html", bytes: 398336 }], reason: "worker_returned_no_rewrites" };
  const en = buildBriefOnlyDiagnosis(diag, "en");
  assert.ok(noHangul(en.prNote));
  assert.ok(en.prNote.includes("could not be auto-fixed"));
  assert.equal(en.modeReason, "worker_returned_no_rewrites; oversize_skipped: index.html(389KB)");

  const ko = buildBriefOnlyDiagnosis(diag); // locale omitted → ko
  assert.ok(ko.prNote.includes("자동수정을 시도하지 못한 파일"));
  assert.equal(ko.modeReason, en.modeReason, "modeReason is locale-invariant (API diagnostics)");
});

test("dispatchRepairJob: locale travels in the container payload", async () => {
  const calls = [];
  const env = {
    INTERNAL_CALLBACK_TOKEN: "tok",
    SANDBOX: {
      idFromName: () => "id",
      get: () => ({
        fetch: async (_url, init) => {
          calls.push(JSON.parse(init.body));
          return { ok: true, text: async () => "" };
        },
      }),
    },
  };
  const args = {
    jobId: "wrj_1", projectId: "p", userKey: "u", visualCheckId: "v",
    repo: "acme/site", githubToken: "gho_x", branch: "fix/simsa-v",
    agentPrompt: "brief", intent: "i", targetUrl: "https://x", decision: "Needs Fix",
    envCause: false, locale: "en", publicBaseUrl: "https://base",
  };
  const r = await dispatchRepairJob(env, args);
  assert.equal(r.dispatched, true);
  assert.equal(calls[0].locale, "en");
});
