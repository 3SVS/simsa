/**
 * 여정 감사 P2 잔여 (프로덕션 2026-10-04, P2=3) — 고정하는 계약:
 *  ① 수리 결과 영역의 기본(비개발자) 문구에 개발 용어(PR·브랜치·머지·배포 / branch·merge·deploy)가 없다.
 *     같은 뜻의 기술 문장은 개발자 모드 전용 키(recheckExplainerDev)로만.
 *  ② 검수 화면의 [지금 검수하기]가 꺼질 때는 '일하는 중'(aria-busy)이고, 이유 문장에 묶여 있다(aria-describedby).
 * 두 테스트 모두 고치기 전 코드에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDictionary } from "../src/i18n/dictionary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 감사 도구(beginner-terms)와 같은 경계 규칙: 짧은 라틴 낱말은 단어 경계, 한글 조사는 경계로 본다.
const JARGON = [/(^|[^A-Za-z0-9가-힣])PR(?=$|[^A-Za-z0-9])/, /브랜치/, /머지/, /배포/, /\bbranch\b/i, /\bmerge\b/i, /\bdeploy/i];
// 기본 화면에 실제로 보이는 수리 영역 문구(개발자 모드 전용·오류 표 제외).
const PLAIN_KEYS = ["doneTitle", "doneBody", "noPrNote", "failedBody", "recheckExplainer", "openPr"];

describe("① 수리 결과 문구 — 비개발자 기본 화면에 개발 용어 없음", () => {
  for (const locale of ["ko", "en"]) {
    const r = getDictionary(locale).visualChecks.repair;
    for (const key of PLAIN_KEYS) {
      it(`${locale}.${key}`, () => {
        const text = r[key];
        assert.equal(typeof text, "string", key);
        for (const re of JARGON) assert.doesNotMatch(text, re, `${locale}.${key}: "${text}"`);
      });
    }
    it(`${locale}: 기술 문장은 개발자 모드 전용 키로 남는다`, () => {
      assert.match(r.recheckExplainerDev, locale === "ko" ? /PR/ : /PR branch/);
    });
  }

  it("화면은 개발자 모드일 때만 기술 문장을 쓴다", () => {
    const page = readFileSync(path.join(ROOT, "src/app/projects/[id]/visual-checks/[runId]/page.tsx"), "utf8");
    assert.match(page, /developerMode \? s\.recheckExplainerDev : s\.recheckExplainer/);
  });
});

describe("② [지금 검수하기] — 꺼질 때 이유가 묶여 있다", () => {
  const page = readFileSync(path.join(ROOT, "src/app/projects/[id]/visual-checks/page.tsx"), "utf8");
  it("aria-busy(보내는 중·앞선 검수 진행 중) + 이유 문장 id 연결", () => {
    assert.match(page, /aria-busy=\{submitting \|\| hasActiveRun\}/);
    assert.match(page, /aria-describedby=\{hasActiveRun \? "vc-run-active-notice" : undefined\}/);
    assert.match(page, /id="vc-run-active-notice"/);
  });
});
