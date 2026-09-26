import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REPAIR_POLL_INTERVAL_MS,
  canRepair,
  isRepairActive,
  isEnvCause,
  nextRepairPollMs,
  repairErrorKey,
  repairFailureKind,
  repairEntryMode,
} from "../src/lib/repair-state.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";
import { DEV_TERMS, devTermHits, accountCtaLabels } from "../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs";

// PR #552 검증 P2: 감사 도구의 DEV_TERMS는 '저장소/repository'를 안 잡는다(코드 갈래 화면에서는
// 사용자 자신의 말이라 P2 정보성). 주소만 앱 = 초보자 기본 경로이므로 이 카드의 카피에는
// 그 단어도 금칙어로 센다 — 도구 목록은 건드리지 않고(여정 감사 기준선 보존) 여기서만 확장.
const BEGINNER_TERMS = [...DEV_TERMS, "저장소", "리포지토리", "repository", "repositories"];

// Train C — C2a (재정렬 §1 끊김 #4·#5, D-17 amend): 주소만 있는 앱(Lovable·Base44 …)에는
// "고치기"(GitHub 저장소 전제) 대신 빌더 채팅 붙여넣기 → 다시 확인 안내를 보인다.
// 이 describe는 고치기 전 코드에서 실패한다(repairEntryMode가 없다).
describe("repair-state: repairEntryMode (C2a — 저장소 유무로 진입이 갈린다)", () => {
  const broken = { status: "done", works: false };

  it("고칠 수 있는 런 + 저장소 연결됨 → repair (종전 '고치기' 흐름)", () => {
    assert.equal(repairEntryMode(broken, true), "repair");
    assert.equal(repairEntryMode({ status: "done", works: null }, true), "repair");
  });

  it("고칠 수 있는 런 + 저장소 없음(확인됨) → builder_paste (기본 흐름에 외부 계정 CTA 없음)", () => {
    assert.equal(repairEntryMode(broken, false), "builder_paste");
  });

  it("저장소 여부를 모름(null: 조회 실패) → builder_paste — 초보자 기본 경로를 먼저, 연결은 선택 문구로", () => {
    assert.equal(repairEntryMode(broken, null), "builder_paste");
    assert.equal(repairEntryMode(broken, undefined), "builder_paste");
  });

  it("고칠 수 없는 런(작동함·진행 중·실패·없음)은 저장소가 있어도 none", () => {
    assert.equal(repairEntryMode({ status: "done", works: true }, true), "none");
    assert.equal(repairEntryMode({ status: "running", works: false }, true), "none");
    assert.equal(repairEntryMode({ status: "failed", works: false }, false), "none");
    assert.equal(repairEntryMode(null, true), "none");
    assert.equal(repairEntryMode(undefined, false), "none");
  });

  it("canRepair와 일관: canRepair가 false면 언제나 none", () => {
    for (const c of [{ status: "done", works: true }, { status: "queued" }, null]) {
      for (const hasRepo of [true, false, null]) {
        if (!canRepair(c)) assert.equal(repairEntryMode(c, hasRepo), "none");
      }
    }
  });

  // PR #552 검증 P2: 저장소 사실이 false/null(조회 실패·8초 타임아웃)이면 RepairSection이 통째로
  // 사라져 진행 중·완료된 수리 잡(PR 링크)이 안 보였다 — 종전에는 canRepair면 항상 렌더·마운트
  // GET으로 기존 잡을 복원했다. 이미 수리 잡이 있는 런은 저장소 사실과 무관하게 repair 카드다.
  // 이 it은 고치기 전 코드에서 실패한다(세 번째 인자를 무시하고 builder_paste).
  it("이미 수리 잡이 있으면(hasRepairJob) 저장소 사실이 false/null이어도 repair — 있는 PR 링크를 숨기지 않는다", () => {
    assert.equal(repairEntryMode(broken, false, { hasRepairJob: true }), "repair");
    assert.equal(repairEntryMode(broken, null, { hasRepairJob: true }), "repair");
    assert.equal(repairEntryMode(broken, undefined, { hasRepairJob: true }), "repair");
    // 잡이 없다고 확인됐거나 모르면 종전 규칙.
    assert.equal(repairEntryMode(broken, null, { hasRepairJob: false }), "builder_paste");
    assert.equal(repairEntryMode(broken, null, {}), "builder_paste");
    // 고칠 수 없는 런은 잡이 있어도 none(작동함 → 수리 카드가 설 자리가 없다).
    assert.equal(repairEntryMode({ status: "done", works: true }, false, { hasRepairJob: true }), "none");
  });
});

describe("repair-state: builderPaste 사전 (C2a 안내 블록) — KO/EN, 초보자 금칙어 0, 계정 CTA 0", () => {
  const KEYS = ["title", "body", "step1", "step2", "recheckButton", "repoOptional", "repoOptionalLink"];
  for (const loc of ["ko", "en"]) {
    it(`${loc}: 키가 모두 있고, GitHub·PR·Lovable 같은 개발 용어가 없고, 링크 라벨이 계정 CTA로 읽히지 않는다`, () => {
      const b = getDictionary(loc).visualChecks.builderPaste;
      for (const k of KEYS) assert.ok(typeof b?.[k] === "string" && b[k].trim().length > 0, `${loc}.visualChecks.builderPaste.${k}`);
      for (const k of KEYS) {
        // PR #552 검증 P2: '저장소/repository'까지 금칙어 — 옛 repoOptional("코드 저장소를 연결해" /
        // "connect a code repository")에서 실패한다.
        const hits = devTermHits(b[k], { terms: BEGINNER_TERMS });
        assert.deepEqual(hits, [], `"${b[k]}" → ${JSON.stringify(hits)}`);
      }
      assert.deepEqual(accountCtaLabels([b.recheckButton, b.repoOptionalLink]), []);
    });
  }
  it("코드 연결은 '선택'으로만 말한다 (KO '원하시면' / EN 'If you like')", () => {
    assert.match(getDictionary("ko").visualChecks.builderPaste.repoOptional, /원하시면/);
    assert.match(getDictionary("en").visualChecks.builderPaste.repoOptional, /if you like/i);
  });
});

describe("repair-state: repairFailureKind (auto_fix 성숙 2026-07-20)", () => {
  it("failed job with the container's repo_access_denied prefix → repoAccessDenied", () => {
    assert.equal(
      repairFailureKind({ status: "failed", error: "repo_access_denied: acme/x 저장소를 읽을 수 없어요 (비공개 저장소이거나 접근 권한이 없음)" }),
      "repoAccessDenied",
    );
  });

  it("failed job with any other error → generic; access text WITHOUT the prefix stays generic", () => {
    assert.equal(repairFailureKind({ status: "failed", error: "callback returned 500" }), "generic");
    assert.equal(repairFailureKind({ status: "failed", error: null }), "generic");
    // 프리픽스 계약: 본문에 403이 있어도 프리픽스가 없으면 일반 실패 카드.
    assert.equal(repairFailureKind({ status: "failed", error: "clone exited 403" }), "generic");
  });

  it("non-failed / absent jobs → null (card renders nothing)", () => {
    assert.equal(repairFailureKind({ status: "done" }), null);
    assert.equal(repairFailureKind({ status: "running", error: "repo_access_denied: x" }), null);
    assert.equal(repairFailureKind(null), null);
  });

  it("dictionary carries the guidance copy in both locales", () => {
    for (const locale of ["ko", "en"]) {
      const d = getDictionary(locale).visualChecks.repair;
      assert.equal(typeof d.failedRepoAccessTitle, "string");
      assert.ok(d.failedRepoAccessBody.length > 20);
    }
  });
});

describe("repair-state: canRepair", () => {
  it("done + not working (false) and done + unverified (null) are repairable", () => {
    assert.equal(canRepair({ status: "done", works: false }), true);
    assert.equal(canRepair({ status: "done", works: null }), true);
  });

  it("a done run that verified as working is NOT repairable", () => {
    assert.equal(canRepair({ status: "done", works: true }), false);
  });

  it("non-done statuses are never repairable, whatever works says", () => {
    assert.equal(canRepair({ status: "queued", works: false }), false);
    assert.equal(canRepair({ status: "running", works: false }), false);
    assert.equal(canRepair({ status: "failed", works: false }), false);
    assert.equal(canRepair({ status: "uploaded", works: null }), false);
  });

  it("null/undefined/garbage checks are defensively not repairable", () => {
    assert.equal(canRepair(null), false);
    assert.equal(canRepair(undefined), false);
    assert.equal(canRepair("done"), false);
  });
});

describe("repair-state: isRepairActive", () => {
  it("queued and running jobs are active", () => {
    assert.equal(isRepairActive({ status: "queued" }), true);
    assert.equal(isRepairActive({ status: "running" }), true);
  });

  it("done, failed, unknown and missing jobs are inactive", () => {
    assert.equal(isRepairActive({ status: "done" }), false);
    assert.equal(isRepairActive({ status: "failed" }), false);
    assert.equal(isRepairActive({ status: "weird_status" }), false);
    assert.equal(isRepairActive(null), false);
    assert.equal(isRepairActive(undefined), false);
  });
});

describe("repair-state: nextRepairPollMs", () => {
  it("active statuses poll on the shared 5s cadence", () => {
    assert.equal(REPAIR_POLL_INTERVAL_MS, 5000);
    assert.equal(nextRepairPollMs("queued"), REPAIR_POLL_INTERVAL_MS);
    assert.equal(nextRepairPollMs("running"), REPAIR_POLL_INTERVAL_MS);
  });

  it("terminal/unknown statuses return null (stop polling)", () => {
    assert.equal(nextRepairPollMs("done"), null);
    assert.equal(nextRepairPollMs("failed"), null);
    assert.equal(nextRepairPollMs("weird"), null);
    assert.equal(nextRepairPollMs(undefined), null);
  });
});

describe("repair-state: isEnvCause", () => {
  it("normalizes the wire value: boolean true and D1 integer 1 both flag", () => {
    assert.equal(isEnvCause({ envCause: true }), true);
    assert.equal(isEnvCause({ envCause: 1 }), true);
  });

  it("false, 0, missing field and missing job all mean no env cause", () => {
    assert.equal(isEnvCause({ envCause: false }), false);
    assert.equal(isEnvCause({ envCause: 0 }), false);
    assert.equal(isEnvCause({}), false);
    assert.equal(isEnvCause(null), false);
    assert.equal(isEnvCause(undefined), false);
  });
});

describe("repair-state: repairErrorKey", () => {
  it("maps the Stage 268 400 codes", () => {
    assert.equal(repairErrorKey("run_not_repairable"), "notRepairable");
    assert.equal(repairErrorKey("github_repo_required"), "repoRequired");
    assert.equal(repairErrorKey("github_token_required"), "tokenRequired");
  });

  it("maps repair_already_active and the bare 409 status alike", () => {
    assert.equal(repairErrorKey("repair_already_active"), "alreadyActive");
    assert.equal(repairErrorKey(409), "alreadyActive");
    assert.equal(repairErrorKey("HTTP 409"), "alreadyActive");
  });

  it("maps ownership errors (404/403) by code and by status", () => {
    assert.equal(repairErrorKey("run_not_found"), "notFound");
    assert.equal(repairErrorKey("project_not_found"), "notFound");
    assert.equal(repairErrorKey(404), "notFound");
    assert.equal(repairErrorKey("HTTP 404"), "notFound");
    assert.equal(repairErrorKey("forbidden"), "forbidden");
    assert.equal(repairErrorKey(403), "forbidden");
  });

  it("unknown codes / statuses / garbage all fall back to generic", () => {
    assert.equal(repairErrorKey("save_failed"), "generic");
    assert.equal(repairErrorKey(400), "generic");
    assert.equal(repairErrorKey(500), "generic");
    assert.equal(repairErrorKey("HTTP 500"), "generic");
    assert.equal(repairErrorKey(null), "generic");
    assert.equal(repairErrorKey(undefined), "generic");
    assert.equal(repairErrorKey("TypeError: fetch failed"), "generic");
  });

  it("every mapped key resolves to non-empty copy in both locales", () => {
    const keys = [
      repairErrorKey("run_not_repairable"),
      repairErrorKey("github_repo_required"),
      repairErrorKey("github_token_required"),
      repairErrorKey("repair_already_active"),
      repairErrorKey("run_not_found"),
      repairErrorKey("forbidden"),
      repairErrorKey("anything_else"),
    ];
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      for (const key of keys) {
        assert.ok(
          typeof d.visualChecks.repair.errors[key] === "string" &&
            d.visualChecks.repair.errors[key].length > 0,
          `${loc}.visualChecks.repair.errors.${key} missing`,
        );
      }
    }
  });
});

describe("repair-state: repair dictionary copy", () => {
  it("button, progress, done, failed and link keys exist in both locales", () => {
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      for (const k of [
        "title", "desc", "button", "submitting",
        "progressTitle", "progressBody", "statusQueued", "statusRunning",
        "doneTitle", "doneBody", "openPr", "branchLabel", "noPrNote",
        "envCauseWarning", "failedTitle", "failedBody", "detailsLabel",
        "goToRepo", "goToGithubSettings",
      ]) {
        assert.ok(
          typeof d.visualChecks.repair[k] === "string" && d.visualChecks.repair[k].length > 0,
          `${loc}.visualChecks.repair.${k} missing`,
        );
      }
    }
  });

  it("the honest draft-PR boundary is spelled out (no auto-applied code claim)", () => {
    // v1 opens a DRAFT PR carrying the fix brief — the copy must mention the
    // brief file and must not promise applied code changes.
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      assert.ok(d.visualChecks.repair.desc.includes("SIMSA-FIX-BRIEF.md"));
      assert.ok(d.visualChecks.repair.doneBody.includes("SIMSA-FIX-BRIEF.md"));
    }
  });
});
