import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTopics, detectContentLang } from "../dist/workspace/topic-tags.js";

test("classifies domain from KR + EN keywords", () => {
  assert.equal(classifyTopics("회의 녹음을 요약하는 생산성 앱").domain, "productivity");
  assert.equal(classifyTopics("an online store with checkout").domain, "commerce");
  assert.equal(classifyTopics("가계부 예산 관리").domain, "finance");
});

test("detects integrations by name", () => {
  const t = classifyTopics("send tasks to Linear and charge with Stripe");
  assert.ok(t.integrations.includes("Linear"));
  assert.ok(t.integrations.includes("Stripe"));
});

test("detects ai_feature", () => {
  assert.equal(classifyTopics("자동으로 요약해주는 도구").ai_feature, "summarization");
  assert.equal(classifyTopics("recommend products to users").ai_feature, "recommendation");
});

test("pattern heuristic: upload -> ai -> export", () => {
  const t = classifyTopics("파일 업로드하면 요약해서 Linear로 전송");
  assert.equal(t.pattern, "upload->ai->export");
});

test("no match → nulls / empty (no invention)", () => {
  const t = classifyTopics("zxcv qwer asdf");
  assert.equal(t.domain, null);
  assert.equal(t.ai_feature, null);
  assert.deepEqual(t.integrations, []);
});

test("detectContentLang: Hangul → ko, Latin → en, empty → null", () => {
  assert.equal(detectContentLang("안녕하세요 앱 만들래요"), "ko");
  assert.equal(detectContentLang("I want to build an app"), "en");
  assert.equal(detectContentLang("   "), null);
});
