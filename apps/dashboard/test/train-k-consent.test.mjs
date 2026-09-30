/**
 * Train K — 동의·프라이버시 대시보드 (계약 5 · 동의 계획 2026-09-27 §4 · §5.2 K-1·K-2).
 *
 * 고치는 결함(코드 확인된 사실):
 *   ① 거절한 사람이 새 브라우저에서 다시 초대됐다(서버 결함 — 서버 PR). 대시보드는 서버가 말하는
 *      training.state만 믿고, "undecided"일 때만 묻는다.
 *   ② 압박 카피("무료 베타는 이 참여로 운영돼요", "나중에") — 삭제.
 *   ③ 비대칭 버튼(btn-primary 참여 vs btn-ghost 나중에 + ✕) — 같은 클래스 하나의 두 버튼, 닫기 없음.
 *   + 떠다니는 팝업(ImproveSimsaPrompt, layout 마운트) → 첫 완료 결과 화면의 인라인 카드.
 *   + 운영 정보(ⓐ) 고지 한 줄 + 끄기, 설정 토글 두 개, 방침 문구 = 서버가 실제로 하는 일.
 *
 * 표시 규칙(#558 규칙 계승 — 회귀 증거를 부풀리지 않는다):
 *   [서버 사실]  서버 소스를 읽어 문구의 전제를 고정 — 옛 코드에서도 통과, 회귀 증거 아님.
 *   [서버 K]     Train K 서버 PR(0071·privacy-prefs)이 main에 들어오기 전에는 todo. 들어온 뒤 이 PR의 CI를
 *                다시 돌리면 자동으로 켜진다(머지 순서: 서버 PR → 이 PR 재검증 → 머지).
 *   [가드]       하네스 자체 검사 — 회귀 증거 아님.
 *   표시 없음    고치기 전 코드(origin/main 3a1ca07)에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const SRC = path.resolve(HERE, "../src");
const CP = path.join(REPO, "apps/central-plane/src");
const MIGRATIONS_DIR = path.join(REPO, "apps/central-plane/migrations");

const K = await import("../src/lib/privacy-prefs.mjs").catch(() => ({}));
const ops = await import("../src/lib/privacy-ops-info.mjs").catch(() => ({}));
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

function read(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

const cardSrc = read(path.join(SRC, "components/TrainingConsentCard.tsx"));
const resultSectionSrc = read(path.join(SRC, "components/ResultPrivacySection.tsx"));
const settingsSectionSrc = read(path.join(SRC, "components/PrivacySettingsSection.tsx"));
const runPageSrc = read(path.join(SRC, "app/projects/[id]/visual-checks/[runId]/page.tsx"));
const settingsPageSrc = read(path.join(SRC, "app/projects/[id]/settings/page.tsx"));
const layoutSrc = read(path.join(SRC, "app/layout.tsx"));
const privacyPageSrc = read(path.join(SRC, "app/legal/privacy/page.tsx"));

const VALID = {
  ok: true,
  opsMeta: "on",
  opsMetaSource: "default",
  region: "KR",
  training: { state: "undecided", version: "2026-07-03", decidedAt: null },
};

// ─── 1. 카드 노출 조건 ────────────────────────────────────────────────────────
describe("학습 카드 노출 조건 표 (trainingCardVisible)", () => {
  const rows = [
    // [이유, resultDone, state, seenRuns, runId, 기대]
    ["첫 완료 결과 — 아직 정하지 않음", true, "undecided", [], "r1", true],
    ["같은 결과를 다시 열어도 새 노출로 세지 않는다", true, "undecided", ["r1"], "r1", true],
    ["다음 완료 결과에서 1회만 다시", true, "undecided", ["r1"], "r2", true],
    ["그 뒤로는 설정에서만", true, "undecided", ["r1", "r2"], "r3", false],
    ["이미 보여 준 두 번째 결과를 다시 열 때는 그대로", true, "undecided", ["r1", "r2"], "r2", true],
    ["허용한 사람에게는 묻지 않는다", true, "consented", [], "r1", false],
    ["거절한 사람에게도 다시 묻지 않는다 (결함 ①)", true, "declined", [], "r1", false],
    ["서버를 모르면(옛 서버·네트워크) 숨긴다", true, null, [], "r1", false],
    ["진행 중·실패 결과에는 없다", false, "undecided", [], "r1", false],
    ["runId 없음", true, "undecided", [], "", false],
  ];
  for (const [why, resultDone, trainingState, seenRuns, runId, want] of rows) {
    it(`${why} → ${want}`, () => {
      assert.equal(K.trainingCardVisible({ resultDone, trainingState, seenRuns, runId }), want);
    });
  }

  it("결정 없이 떠나는 흐름: 결과 1·2에서 보이고 3부터는 안 보인다 (브라우저 기억 = rememberTrainingCardSeen)", () => {
    let seen = [];
    const shown = [];
    for (const runId of ["r1", "r2", "r3", "r4"]) {
      const v = K.trainingCardVisible({ resultDone: true, trainingState: "undecided", seenRuns: seen, runId });
      shown.push(v);
      if (v) seen = K.rememberTrainingCardSeen(seen, runId);
    }
    assert.deepEqual(shown, [true, true, false, false]);
    assert.equal(K.TRAINING_CARD_MAX_EXPOSURES, 2);
  });

  it("브라우저 기억은 망가진 값을 빈 목록으로 읽고, 상한을 넘겨 쌓지 않는다", () => {
    assert.deepEqual(K.parseSeenRuns(null), []);
    assert.deepEqual(K.parseSeenRuns("not json"), []);
    assert.deepEqual(K.parseSeenRuns('{"a":1}'), []);
    assert.deepEqual(K.parseSeenRuns('["a","a",3,"b","c"]'), ["a", "b"]);
    assert.deepEqual(K.rememberTrainingCardSeen(["a", "b"], "c"), ["a", "b"]);
    assert.deepEqual(K.rememberTrainingCardSeen(["a"], "a"), ["a"]);
  });
});

// ─── 2. 옛 서버 방어 ──────────────────────────────────────────────────────────
describe("옛 서버 방어 — 응답 경계 검사와 화면 상태", () => {
  it("계약 모양이면 정규화, 아니면 null (옛 서버 notFound·빈 응답·반쪽 응답)", () => {
    assert.deepEqual(K.normalizePrivacyPrefs(VALID), {
      opsMeta: "on",
      opsMetaSource: "default",
      region: "KR",
      training: { state: "undecided", version: "2026-07-03", decidedAt: null },
    });
    assert.equal(K.normalizePrivacyPrefs({ error: "not found", path: "/workspace/privacy-prefs" }), null);
    assert.equal(K.normalizePrivacyPrefs(null), null);
    assert.equal(K.normalizePrivacyPrefs({ ok: true }), null);
    assert.equal(K.normalizePrivacyPrefs({ ...VALID, ok: false }), null);
    assert.equal(K.normalizePrivacyPrefs({ ...VALID, opsMeta: "maybe" }), null);
    assert.equal(K.normalizePrivacyPrefs({ ...VALID, opsMetaSource: "admin" }), null);
    assert.equal(K.normalizePrivacyPrefs({ ...VALID, training: { state: "yes" } }), null);
    assert.equal(K.normalizePrivacyPrefs({ ...VALID, training: null }), null);
    assert.equal(K.normalizePrivacyPrefs({ ...VALID, region: "kr" })?.region, null, "bad region → null, rest kept");
  });

  it("옛 training-consent 응답은 {ok, active, storageConfigured}로만 읽는다", () => {
    assert.deepEqual(
      K.normalizeTrainingConsent({ ok: true, consented: true, consentVersion: "v", currentVersion: "v", active: true, storageConfigured: true }),
      { ok: true, active: true, storageConfigured: true },
    );
    assert.deepEqual(K.normalizeTrainingConsent({ ok: false, error: "db_error" }), { ok: false, active: false, storageConfigured: false });
    assert.deepEqual(K.normalizeTrainingConsent({ ok: true }), { ok: false, active: false, storageConfigured: false });
  });

  it("설정 토글: 서버를 모르면 운영 정보 토글은 비활성, 학습 토글은 옛 경로로(끄면 '지워요'라고 하지 않음)", () => {
    assert.deepEqual(K.privacySettingsState({ prefs: null, legacy: null }), {
      opsMeta: { available: false, on: false, defaultOff: false },
      training: { available: false, on: false, offDeletes: false },
    });
    assert.deepEqual(K.privacySettingsState({ prefs: null, legacy: { ok: true, active: true } }).training, {
      available: true,
      on: true,
      offDeletes: false,
    });
    const k = K.privacySettingsState({
      prefs: K.normalizePrivacyPrefs({ ...VALID, opsMeta: "off", training: { state: "declined", version: "v", decidedAt: "t" } }),
      legacy: { ok: true, active: false },
    });
    assert.deepEqual(k, {
      opsMeta: { available: true, on: false, defaultOff: true },
      training: { available: true, on: false, offDeletes: true },
    });
  });

  it("운영 정보 한 줄: 모름이면 그리지 않고, 켬·기본 끔(EU/UK/CH)·직접 끔을 구분한다", () => {
    const n = (o) => K.normalizePrivacyPrefs({ ...VALID, ...o });
    assert.equal(K.opsInfoLineVariant(null), null);
    assert.equal(K.opsInfoLineVariant(n({ opsMeta: "on", opsMetaSource: "default" })), "recording");
    assert.equal(K.opsInfoLineVariant(n({ opsMeta: "on", opsMetaSource: "user" })), "recording");
    assert.equal(K.opsInfoLineVariant(n({ opsMeta: "off", opsMetaSource: "default", region: "DE" })), "off_default");
    assert.equal(K.opsInfoLineVariant(n({ opsMeta: "off", opsMetaSource: "user" })), "off_user");
    for (const loc of ["ko", "en"]) {
      const p = DICTIONARIES[loc].privacyPrefs;
      assert.deepEqual(K.opsInfoLineCopy("recording", p), { text: p.lineRecording, action: p.turnOff, next: "off" });
      assert.deepEqual(K.opsInfoLineCopy("off_default", p), { text: p.lineOffDefault, action: p.turnOn, next: "on" });
      assert.deepEqual(K.opsInfoLineCopy("off_user", p), { text: p.lineOffUser, action: p.turnOnAgain, next: "on" });
      assert.equal(K.opsInfoLineCopy(null, p), null);
    }
  });

  it("저장 결과: 요청대로 저장됐을 때만 '저장됨'", () => {
    assert.equal(K.trainingSaveOutcome(true, { ok: true, active: true }), "consented");
    assert.equal(K.trainingSaveOutcome(false, { ok: true, active: false }), "declined");
    assert.equal(K.trainingSaveOutcome(true, { ok: true, active: false }), "error");
    assert.equal(K.trainingSaveOutcome(false, { ok: true, active: true }), "error");
    assert.equal(K.trainingSaveOutcome(true, { ok: false, active: false }), "error");
  });

  it("API 클라이언트는 응답을 정규화 함수로만 읽는다 (as 캐스트 없음) — 404·네트워크는 null", () => {
    const prefsApi = read(path.join(SRC, "lib/workspace-privacy-prefs-api.ts"));
    const consentApi = read(path.join(SRC, "lib/workspace-training-consent-api.ts"));
    assert.match(prefsApi, /normalizePrivacyPrefs\(raw\)/);
    assert.match(prefsApi, /if \(!res\.ok\) return null;/);
    assert.match(consentApi, /normalizeTrainingConsent\(raw\)/);
    for (const src of [prefsApi, consentApi]) assert.ok(!/\) as \w/.test(src), "no `as` cast of the wire value");
  });
});

// ─── 3. 동등 버튼 · 인라인 · 사전 선택 없음 ──────────────────────────────────
describe("학습 카드 — 동등 버튼 2개, 사전 선택·닫기·오버레이 없음 (결함 ③)", () => {
  it("묻는 동안 버튼은 정확히 2개, 카드의 모든 버튼(철회 포함)은 같은 클래스 상수 하나를 쓴다", () => {
    assert.ok(cardSrc, "TrainingConsentCard.tsx exists");
    // 여는 태그 안에 화살표 함수(`=>`)가 있어 `[^>]*`로는 못 자른다 — `<button`부터 `</button>`까지를 본다.
    const buttons = cardSrc.split("<button").slice(1).map((c) => c.slice(0, c.indexOf("</button>")));
    // 허용하지 않기·허용하기 + 허용 저장 뒤의 허용 철회(#573 검증 3) = 3
    assert.equal(buttons.length, 3, buttons.join("\n---\n"));
    for (const b of buttons) {
      const classes = [...b.matchAll(/className=(\{[^}]+\}|"[^"]*")/g)].map((m) => m[1]);
      assert.deepEqual(classes, ["{CONSENT_CHOICE_CLASS}"], b);
    }
    const askStart = cardSrc.indexOf('{choice === "ask" && (');
    assert.ok(askStart > 0, "ask block");
    const askRest = cardSrc.slice(askStart + 1);
    const askBlock = askRest.slice(0, askRest.search(/\{\(?choice === /));
    assert.equal(askBlock.split("<button").length - 1, 2, askBlock);
  });

  it("그 클래스에는 강조가 없다 (primary·색 배경·색 글자 없음)", () => {
    const cls = /const CONSENT_CHOICE_CLASS = "([^"]+)";/.exec(cardSrc)?.[1] ?? "";
    assert.ok(cls, "CONSENT_CHOICE_CLASS");
    assert.ok(!/primary|\bbg-(?!white)|text-(red|green|brand|emerald|blue)/.test(cls), cls);
  });

  it("순서는 [허용하지 않기] [허용하기] — 허용이 먼저 눈에 띄지 않는다", () => {
    const decline = cardSrc.indexOf("{s.decline}");
    const allow = cardSrc.indexOf("{s.allow}");
    assert.ok(decline > 0 && allow > decline, `decline@${decline} allow@${allow}`);
    assert.match(cardSrc, /onClick=\{\(\) => void choose\(false\)\}[^>]*>\s*\{s\.decline\}/);
    assert.match(cardSrc, /onClick=\{\(\) => void choose\(true\)\}[^>]*>\s*\{s\.allow\}/);
  });

  it("닫기(X)·체크박스 사전 선택·모달/오버레이가 없다 (옛 팝업: ✕ + fixed z-50)", () => {
    assert.ok(cardSrc && resultSectionSrc, "inline card + result section exist");
    // 옛 팝업 파일이 남아 있으면 그것도 검사 대상이다 — 옛 코드에서는 여기서 실패한다.
    const popupSrc = read(path.join(SRC, "components/ImproveSimsaPrompt.tsx"));
    for (const src of [cardSrc, resultSectionSrc, popupSrc]) {
      assert.ok(!/✕|×|aria-label=\{t\.common\.dismiss\}|onClose|dismiss\(/.test(src), "no close button");
      assert.ok(!/type="checkbox"|defaultChecked/.test(src), "no pre-checked box");
      assert.ok(!/\bfixed\b|z-50|aria-modal|role="dialog"/.test(src), "inline only");
    }
  });

  it("'자세히'는 방침의 학습 데이터 문단(#training-data), 만 14세 표기를 함께 둔다", () => {
    assert.match(cardSrc, /href="\/legal\/privacy#training-data"/);
    assert.match(cardSrc, /\{s\.ageNote\}/);
    assert.match(cardSrc, /\{s\.equalNote\}/);
  });
});

// ─── 4. 팝업 제거 ────────────────────────────────────────────────────────────
describe("떠다니는 참여 팝업 제거 (ImproveSimsaPrompt)", () => {
  it("컴포넌트 파일이 없고 layout이 마운트하지 않는다", () => {
    assert.ok(!existsSync(path.join(SRC, "components/ImproveSimsaPrompt.tsx")), "component file removed");
    assert.ok(!/ImproveSimsaPrompt/.test(layoutSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "layout no longer mounts it");
  });

  it("어느 화면도 옛 팝업 기억 키를 쓰지 않는다", () => {
    const hits = walk(SRC, /\.(tsx|ts|mjs)$/).filter((f) => read(f).includes("simsa:improve-prompt-dismissed"));
    assert.deepEqual(hits.map((f) => path.relative(SRC, f)), []);
  });

  it("압박 카피 키가 사전에서 사라졌다 (betaNote·joinCta·laterCta·manageInSettings)", () => {
    for (const loc of ["en", "ko"]) {
      const tc = DICTIONARIES[loc].trainingConsent;
      for (const k of ["betaNote", "joinCta", "laterCta", "manageInSettings"]) {
        assert.ok(!(k in tc), `${loc}.trainingConsent.${k} still present`);
      }
    }
  });
});

// ─── 5. 사전 — 파리티·금칙어·압박 카피 ───────────────────────────────────────
function leafStrings(obj) {
  return Object.values(obj).flatMap((v) => (v && typeof v === "object" ? leafStrings(v) : [v]));
}

describe("사전 — KO/EN 파리티·초보자 금칙어 0·압박 카피 0", () => {
  it("trainingConsent·privacyPrefs 키가 두 언어에서 같다", () => {
    for (const block of ["trainingConsent", "privacyPrefs"]) {
      const en = Object.keys(DICTIONARIES.en[block] ?? {}).sort();
      const ko = Object.keys(DICTIONARIES.ko[block] ?? {}).sort();
      assert.ok(en.length > 0, `${block} exists`);
      assert.deepEqual(ko, en, block);
    }
  });

  for (const loc of ["ko", "en"]) {
    it(`[${loc}] 두 블록의 모든 문구에 개발 용어 0 (beginner-terms)`, () => {
      const d = DICTIONARIES[loc];
      for (const s of [...leafStrings(d.trainingConsent), ...leafStrings(d.privacyPrefs)]) {
        assert.equal(typeof s, "string");
        assert.deepEqual(devTermHits(s), [], s);
      }
    });

    it(`[${loc}] 압박·지연 카피가 없다 (무료 베타는 이 참여로 운영 · 나중에 · Maybe later · Join in)`, () => {
      const all = [...leafStrings(DICTIONARIES[loc].trainingConsent), ...leafStrings(DICTIONARIES[loc].privacyPrefs)].join("\n");
      assert.ok(!/무료 베타|이 참여로 운영|나중에|free beta|runs on this|maybe later|join in|smarter for everyone/i.test(all), all);
    });
  }

  it("계약 문구 그대로: 무차별 보장·운영 정보 고지 줄(KO)", () => {
    const ko = DICTIONARIES.ko;
    assert.equal(ko.trainingConsent.equalNote, "어느 쪽을 선택해도 모든 기능을 똑같이 쓸 수 있어요.");
    assert.equal(ko.privacyPrefs.lineRecording, "이 확인에는 접속 국가 코드·화면 언어·만든 도구·실패 유형 같은 비식별 운영 정보가 기록됩니다");
    assert.match(ko.privacyPrefs.lineOffDefault, /기록하지 않고 있어요$/);
    assert.equal(ko.privacyPrefs.turnOff, "기록 끄기");
    assert.equal(ko.privacyPrefs.turnOn, "켜기");
    assert.equal(ko.trainingConsent.allow, "허용하기");
    assert.equal(ko.trainingConsent.decline, "허용하지 않기");
  });

  it("만 14세 표기가 두 언어에 있다", () => {
    assert.match(DICTIONARIES.ko.trainingConsent.ageNote, /만 14세/);
    assert.match(DICTIONARIES.en.trainingConsent.ageNote, /14/);
  });
});

// ─── 6. 화면 배선 ────────────────────────────────────────────────────────────
describe("배선 — 결과 화면(인라인)·설정 화면(두 토글)", () => {
  it("완료된 확인 결과 화면: '이번 결과, 어떠셨어요?' 다음에 ResultPrivacySection (결과 done일 때만)", () => {
    assert.match(runPageSrc, /import \{ ResultPrivacySection \} from "@\/components\/ResultPrivacySection";/);
    const verdictAt = runPageSrc.indexOf("<UserVerdictSection");
    const privacyAt = runPageSrc.indexOf("<ResultPrivacySection");
    assert.ok(verdictAt > 0 && privacyAt > verdictAt, `verdict@${verdictAt} privacy@${privacyAt}`);
    assert.match(runPageSrc, /<ResultPrivacySection runId=\{runId\} resultDone=\{check\.status === "done"\}/);
  });

  it("결과 화면 섹션은 서버 상태로만 카드를 띄우고, 운영 정보 '자세히'는 #ops-info", () => {
    assert.match(resultSectionSrc, /fetchPrivacyPrefs\(userKey\)/);
    assert.match(resultSectionSrc, /cardVisibleFromPrefs\(/); // → trainingCardVisible (#573 검증 6)
    assert.match(resultSectionSrc, /rememberTrainingCardSeen\(/);
    assert.match(resultSectionSrc, /opsInfoLineCopy\(opsInfoLineVariant\(prefs\), p\)/);
    assert.match(resultSectionSrc, /href="\/legal\/privacy#ops-info"/);
  });

  it("설정 화면: PrivacySettingsSection 하나로 두 토글, 옛 학습 섹션(베타 문구)은 없다", () => {
    assert.match(settingsPageSrc, /<PrivacySettingsSection userKey=\{userKey\} t=\{t\} \/>/);
    assert.ok(!/betaNote|trainConsented|handleToggleTrainingConsent/.test(settingsPageSrc));
    assert.match(settingsSectionSrc, /id="ops-meta"/);
    assert.match(settingsSectionSrc, /id="train-consent"/);
  });

  it("설정 화면 옛 서버 방어: 모르면 토글 비활성 + 설명, 끄기 안내는 서버가 하는 일만", () => {
    assert.match(settingsSectionSrc, /disabled=\{!state\.opsMeta\.available \|\| opsPhase === "saving"\}/);
    assert.match(settingsSectionSrc, /disabled=\{!state\.training\.available \|\| trainPhase === "saving"\}/);
    assert.match(settingsSectionSrc, /!state\.opsMeta\.available && <p[^>]*>\{p\.unavailable\}/);
    assert.match(settingsSectionSrc, /!state\.training\.available && <p[^>]*>\{s\.unavailable\}/);
    assert.match(settingsSectionSrc, /state\.training\.offDeletes \? s\.offNoteDeletes : s\.offNoteStops/);
  });
});

// ─── 7. 방침 문구 = 계약 4의 실제 동작 ───────────────────────────────────────
describe("방침·카드 문구 = 서버가 실제로 하는 일 (계약 4: 색인 삭제 · 과거분 예외)", () => {
  it("TRAINING_COPY_NOTE: 철회·프로젝트 삭제 시 색인된 사본 삭제 + 색인 전 사본은 자동 삭제 불가·문의 처리", () => {
    const s = ops.TRAINING_COPY_NOTE ?? "";
    assert.match(s, /동의를 철회하시거나 그 프로젝트를 삭제하시면 색인된 사본을 지웁니다/, s);
    assert.match(s, /삭제 기능이 생기기 전에 저장된 일부 사본은[^.]*자동으로 지우지 못할 수 있습니다/, s);
    assert.match(s, /문의 이메일로 요청하시면 찾을 수 있는 범위에서 지워 드립니다/, s);
    assert.ok(!/지워지지 않습니다/.test(s), "old 'never deleted' sentence");
    assert.ok(!/모두 지웁니다|전부 지웁니다/.test(s), "must not over-promise");
  });

  it("카드의 '바꾸기'는 지금 허용한 뒤 저장되는 사본만 약속한다 (색인이 있는 사본)", () => {
    assert.match(DICTIONARIES.ko.trainingConsent.pointControl, /지금 허용하시면, 그 뒤 저장되는 학습 사본은 철회하시거나 프로젝트를 삭제하실 때 지워요/);
    assert.match(DICTIONARIES.en.trainingConsent.pointControl, /If you allow now, the training copies saved from then on are deleted when you withdraw or delete the project/);
  });

  it("설정의 끄기 안내는 과거분 예외를 숨기지 않는다", () => {
    assert.match(DICTIONARIES.ko.trainingConsent.offNoteDeletes, /삭제 기능이 생기기 전에 저장된 일부 사본은 자동으로 지워지지 않을 수 있어요/);
    assert.match(DICTIONARIES.en.trainingConsent.offNoteDeletes, /before deletion was available may not be removed automatically/);
  });

  it("방침 페이지: §2 학습 데이터 문단(#training-data)과 §1 운영 정보(#ops-info) 앵커가 있다", () => {
    assert.match(privacyPageSrc, /id="training-data"/);
    assert.match(privacyPageSrc, /id="ops-info"/);
    for (const k of ["TRAINING_DATA_TITLE", "TRAINING_DATA_SCOPE", "TRAINING_DATA_PURPOSE", "TRAINING_DATA_BASIS", "TRAINING_DATA_CHOICE"]) {
      assert.match(privacyPageSrc, new RegExp(`\\{${k}\\}`), k);
      assert.equal(typeof ops[k], "string", k);
    }
    const s2 = privacyPageSrc.slice(privacyPageSrc.indexOf("2. AI 처리 위탁"), privacyPageSrc.indexOf("3. 보관과 파기"));
    assert.ok(s2.includes("{TRAINING_COPY_NOTE}"), "§2 carries the same withdrawal/deletion sentence");
  });

  it("학습 데이터 문단: 동의 근거·무차별·만 14세·팔거나 넘기지 않음", () => {
    assert.match(ops.TRAINING_DATA_BASIS ?? "", /동의/);
    assert.match(ops.TRAINING_DATA_BASIS ?? "", /제15조 제1항 제1호/);
    assert.match(ops.TRAINING_DATA_CHOICE ?? "", /모든 기능을 똑같이/);
    assert.match(ops.TRAINING_DATA_CHOICE ?? "", /만 14세 이상/);
    assert.match(ops.TRAINING_DATA_PURPOSE ?? "", /팔거나 다른 곳에 넘기지 않/);
  });

  it("변경 이력 새 줄(시행일 상수, 게시일 2026-09-30 이후): 기록 끄기·학습 데이터·만 14세를 말한다", () => {
    const last = (ops.PRIVACY_CHANGE_LOG ?? []).at(-1);
    assert.ok(last, "change log");
    assert.equal(last.date, ops.PRIVACY_EFFECTIVE_DATE);
    assert.ok(last.date > "2026-09-30", `new line must be after the published 2026-09-30 line: ${last.date}`);
    assert.match(last.summary, /기록 끄기/);
    assert.match(last.summary, /학습 데이터/);
    assert.match(last.summary, /만 14세/);
  });

  it("끄기 표: 고지된 모든 칸이 '끄면 멈춤' 또는 '끄셔도 남음' 중 정확히 하나다", () => {
    const stops = new Set(ops.OPS_META_OFF_STOPS ?? []);
    const keeps = new Set(ops.OPS_META_OFF_KEEPS ?? []);
    assert.ok(stops.size > 0 && keeps.size > 0);
    const overlap = [...stops].filter((c) => keeps.has(c));
    assert.deepEqual(overlap, [], "a column cannot be both stopped and kept");
    const disclosed = new Set((ops.OPS_INFO_ITEMS ?? []).flatMap((i) => i.columns ?? []));
    disclosed.add("envelope_json");
    const unclassified = [...disclosed].filter((c) => !stops.has(c) && !keeps.has(c));
    assert.deepEqual(unclassified, [], `끄기 표에 없는 고지 칸: ${unclassified.join(", ")}`);
    // 계약 3: 끄기 대상은 0069 통계용 운영 정보 4칸.
    assert.deepEqual([...stops].sort(), ["envelope_json", "finding_codes_json", "region", "region_at_create"]);
  });
});

// ─── 8. [서버 사실] 학습 사본 문구의 전제 (지금 main에 있는 서버) ─────────────
const trainingStoreTs = read(path.join(CP, "workspace/training-store.ts"));
const journeyStoreTs = read(path.join(CP, "workspace/journey-store.ts"));

describe("[서버 사실] 학습 사본 문구의 전제", () => {
  it("[서버 사실] 학습 사본을 만드는 곳은 연결한 코드 확인 경로 하나 (화면 확인 경로에는 캡처가 없다)", () => {
    const callers = walk(CP, /\.ts$/)
      .filter((f) => !/workspace[\\/](training|journey)-store\.ts$/.test(f))
      .filter((f) => /\bcapture(TrainingRecord|JourneyEvent)\(/.test(read(f)))
      .map((f) => path.relative(CP, f).replace(/\\/g, "/"));
    assert.deepEqual(callers, ["routes/workspace-github.ts"], "a new capture site → update pointWhat / TRAINING_DATA_SCOPE");
  });

  it("→ 그래서 카드와 방침이 '주소로 하는 화면 확인 결과는 담기지 않는다'고 적는다", () => {
    assert.match(DICTIONARIES.ko.trainingConsent.pointWhat, /주소로 하는 화면 확인 결과는 담기지 않아요/);
    assert.match(DICTIONARIES.en.trainingConsent.pointWhat, /Checks of an app by its web address are not included/);
    assert.match(ops.TRAINING_DATA_SCOPE ?? "", /주소로 하는 화면 확인 결과는 담지 않습니다/);
  });

  it("[서버 사실] 저장 전 비밀 키 지우기(redactSecrets) — 두 저장소 모두", () => {
    assert.match(trainingStoreTs, /import \{ redactSecrets \} from "@simsa\/secret-guard";/);
    assert.match(journeyStoreTs, /import \{ redactSecrets \} from "@simsa\/secret-guard";/);
  });

  it("[서버 사실] 기록에 제품 설명·저장소 이름·sha256(userKey)(비밀 키 없음)가 들어간다", () => {
    assert.match(trainingStoreTs, /product_spec: scrubJson\(input\.productSpec\)/);
    assert.match(trainingStoreTs, /repo_full_name: input\.repoFullName/);
    assert.match(trainingStoreTs, /subjectHash \?\? \(await sha256Hex\(input\.userKey\)\)/);
  });

  it("→ 그래서 카드도 제품 설명·저장소 이름을 적고, '이름을 담지 않는다'고 하지 않는다(저장소 이름에 계정 이름이 들어갈 수 있다)", () => {
    const ko = DICTIONARIES.ko.trainingConsent.pointWhat;
    const en = DICTIONARIES.en.trainingConsent.pointWhat;
    assert.match(ko, /제품 설명/);
    assert.match(ko, /저장소 이름/);
    assert.ok(!/이름·이메일은 담지 않/.test(ko), ko);
    assert.match(en, /product description/);
    assert.match(en, /code project's name/);
    assert.ok(!/name and email are never included/.test(en), en);
  });

  it("→ 그래서 방침이 제품 설명·저장소 이름을 적고, '되돌릴 수 없게'가 아니라 '연결할 수 있다'고 적는다", () => {
    const scope = ops.TRAINING_DATA_SCOPE ?? "";
    assert.match(scope, /제품 설명/);
    assert.match(scope, /저장소 이름/);
    assert.match(scope, /연결할 수 있습니다/);
    assert.ok(!/되돌릴 수 없/.test(scope), scope);
  });
});

// ─── 9. [서버 K] Train K 서버 PR — 머지 전에는 todo ──────────────────────────
const k0071 = readdirSync(MIGRATIONS_DIR).find((f) => /^0071_.+\.sql$/.test(f)) ?? null;
const SERVER_K = k0071
  ? {}
  : { todo: "Train K 서버 PR(0071·privacy-prefs) 머지 전 — 서버 PR 머지 후 이 PR의 CI를 다시 돌리면 켜진다" };
const cpFiles = walk(CP, /\.ts$/);
const cpText = (re) => cpFiles.filter((f) => re.test(read(f)));
// 서버 PR이 색인 쓰기·지우기를 어느 파일에 두든(같은 파일이든 새 모듈이든) 잡는다: 테이블 이름을 직접 쓰거나,
// 테이블 이름을 쓰는 모듈을 가져오면 "색인을 쓴다"로 본다 — 이름 추측으로 거짓 실패하지 않게.
const indexModules = () =>
  cpText(/training_records_index/).map((f) => path.basename(f).replace(/\.ts$/, ""));
const usesIndex = (src) =>
  /training_records_index/.test(src) ||
  indexModules().some((m) => new RegExp(`from\\s+["'][^"']*/${m}(\\.js)?["']`).test(src));

describe("[서버 K] 이 PR의 문구가 기대는 서버 사실 (계약 1~4)", () => {
  it("[서버 K] 0071 = 계약 1: decided_at · privacy_prefs(ops_meta on/off) · training_records_index(r2_key·user_key·project_id)", SERVER_K, () => {
    const sql = k0071 ? read(path.join(MIGRATIONS_DIR, k0071)) : "";
    assert.match(sql, /ADD COLUMN\s+decided_at\s+TEXT/i);
    assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)?\s+privacy_prefs/i);
    assert.match(sql, /ops_meta\s+IN\s*\(\s*'on'\s*,\s*'off'\s*\)/i);
    assert.match(sql, /CREATE TABLE(?: IF NOT EXISTS)?\s+training_records_index/i);
    for (const c of ["r2_key", "user_key", "project_id", "deleted_at"]) assert.match(sql, new RegExp(`\\b${c}\\b`), c);
  });

  it("[서버 K] GET/POST /workspace/privacy-prefs 경로가 있다 (설정·결과 화면 끄기의 서버)", SERVER_K, () => {
    assert.ok(cpText(/["'`]\/workspace\/privacy-prefs["'`]/).length > 0);
  });

  it("[서버 K] 거절은 버전을 지우지 않는다 (재초대 결함 ①)", SERVER_K, () => {
    const db = read(path.join(CP, "workspace/training-consent-db.ts"));
    assert.ok(!/consented \? TRAINING_CONSENT_VERSION : null/.test(db), "decline still clears consent_version");
    assert.ok(cpText(/decided_at/).length > 0, "decided_at is written somewhere");
  });

  it("[서버 K] 프로젝트 삭제가 학습 사본 색인을 정리한다 (계약 4b → TRAINING_COPY_NOTE '프로젝트를 삭제하시면')", SERVER_K, () => {
    assert.ok(usesIndex(read(path.join(CP, "workspace/db.ts"))), "db.ts deleteProject does not touch training_records_index");
  });

  it("[서버 K] 학습 사본 캡처가 색인을 쓴다 (계약 3 → '색인된 사본')", SERVER_K, () => {
    assert.ok(usesIndex(trainingStoreTs), "training-store.ts");
    assert.ok(usesIndex(journeyStoreTs), "journey-store.ts");
  });

  it("[서버 K] EU/EEA·영국·스위스 기본 off 목록 (계약 2 → 방침 '켜시기 전까지 기록하지 않습니다')", SERVER_K, () => {
    const codes = ["DE", "FR", "IS", "LI", "NO", "GB", "CH"];
    const owners = cpFiles
      .map(read)
      .filter((src) => /ops_?meta|opsMeta|privacy/i.test(src))
      .filter((src) => codes.every((cc) => new RegExp(`["']${cc}["']`).test(src)));
    assert.ok(owners.length > 0, `no server file lists ${codes.join(",")} next to the ops-meta default`);
  });
});

// ─── 10. PR #573 검증 1 [P1] — '끔'이 실제로 멈추는 것만 말한다 ──────────────────
// 서버(#574 privacy-prefs.ts 머리말 '끄지 않는 것'): locale(검수 0065·빌드 잡 0068)과 프로젝트 행의
// built_with_json(0055)은 '끔'이어도 계속 저장된다 — 끄면 멈추는 것은 region·region_at_create·envelope_json·
// finding_codes_json(와 학습 사본의 region)뿐. 옛 문구는 EU/UK/CH 기본 off 사용자에게 "화면 언어·만든 도구를
// 기록하지 않고 있어요"라고 했다(거짓).
const KEEP_WORDS = {
  // KEEPS 칸 → 방침(KO)·설정 안내(KO/EN)에서 그 칸을 가리키는 말.
  ko: {
    locale: "화면 언어",
    built_with_json: "만든 도구",
    topic_tags_json: "앱 유형",
    entry_path: "진입 경로",
    acquisition_json: "유입 경로",
    user_verdict: "결과 판정 선택",
    user_verdict_at: "결과 판정 선택",
    source_check_id: "다시 확인 연결",
    resolved: "해결 여부",
    verify_check_id: "해결 여부",
    "table:llm_usage": "AI 사용량",
    "table:workspace_rate_limit": "요청 횟수 제한",
    "table:demo_rate_limit": "요청 횟수 제한",
  },
  en: {
    locale: "screen language",
    built_with_json: "build tool",
    topic_tags_json: "app type",
    entry_path: "entry",
    acquisition_json: "source",
    user_verdict: "answers about results",
    user_verdict_at: "answers about results",
    source_check_id: "re-check links",
    resolved: "whether a fix worked",
    verify_check_id: "whether a fix worked",
    "table:llm_usage": "AI usage",
    "table:workspace_rate_limit": "request-limit",
    "table:demo_rate_limit": "request-limit",
  },
};
// '기록하지 않는다'고 말하는 줄에 나오면 거짓이 되는 말(끄셔도 남는 값).
const KEPT_NOUNS = {
  ko: ["화면 언어", "만든 도구", "앱 유형", "진입 경로", "유입 경로", "AI 사용량", "요청 횟수"],
  en: ["screen language", "built with", "build tool", "app type", "AI usage", "request-limit"],
};

describe("#573 검증 1 [P1] — 끄기 문구 = 서버가 실제로 멈추는 것", () => {
  for (const loc of ["ko", "en"]) {
    const p = DICTIONARIES[loc].privacyPrefs;
    for (const key of ["lineOffDefault", "lineOffUser", "opsSavedOff"]) {
      it(`[${loc}] ${key}: 끄셔도 남는 값(화면 언어·만든 도구 …)을 '기록하지 않는다'에 넣지 않고, 멈추는 것(국가 코드·실패 유형)을 이름으로 말한다`, () => {
        const s = p[key] ?? "";
        for (const w of KEPT_NOUNS[loc]) assert.ok(!s.includes(w), `${loc}.${key} says it stops "${w}": ${s}`);
        if (loc === "ko") {
          assert.match(s, /국가 코드/, s);
          assert.match(s, /실패 유형/, s);
        } else {
          assert.match(s, /country code/, s);
          assert.match(s, /failure types/, s);
        }
      });
    }
    it(`[${loc}] 줄·토글은 '통계용' 운영 정보로 범위를 한정한다 (서버 머리말: 토글 문구는 통계용 운영 정보로)`, () => {
      const word = loc === "ko" ? /통계용/ : /for statistics/;
      for (const key of ["lineOffDefault", "lineOffUser", "opsToggle"]) assert.match(p[key] ?? "", word, `${loc}.${key}`);
    });
  }

  it("KEEPS에 locale(화면 언어 — 검수 0065·빌드 잡 0068)이 있고, 방침 '화면 언어' 항목이 그 칸을 가리킨다", () => {
    assert.ok((ops.OPS_META_OFF_KEEPS ?? []).includes("locale"), JSON.stringify(ops.OPS_META_OFF_KEEPS));
    assert.ok(!(ops.OPS_META_OFF_STOPS ?? []).includes("locale"));
    const item = (ops.OPS_INFO_ITEMS ?? []).find((i) => i.label === "화면 언어");
    assert.ok(item && (item.columns ?? []).includes("locale"), JSON.stringify(item));
    // 기준선(서버 사실): 검수 런 행(0065 ADD COLUMN)과 빌드 잡 행(0068 CREATE TABLE)에 locale 칸이 있다.
    assert.match(read(path.join(MIGRATIONS_DIR, "0065_visual_check_locale.sql")), /^ALTER TABLE workspace_visual_checks ADD COLUMN locale TEXT;/m);
    assert.match(read(path.join(MIGRATIONS_DIR, "0068_build_jobs.sql")), /^\s+locale TEXT,/m);
  });

  it("KEEPS의 모든 칸이 방침 '끄셔도 계속 기록되는 것'(KO)과 설정 안내 opsKeepNote(KO/EN)에 나온다", () => {
    const optOut = ops.OPS_INFO_OPT_OUT ?? "";
    const keepSentence = optOut.slice(optOut.indexOf("끄셔도 계속 기록되는 것"));
    assert.ok(keepSentence.length > 0, optOut);
    assert.match(keepSentence, /확인 결과를 보여 줄 화면 언어/, keepSentence);
    for (const c of ops.OPS_META_OFF_KEEPS ?? []) {
      assert.ok(KEEP_WORDS.ko[c], `KEEP_WORDS.ko has no word for ${c} — add one`);
      assert.ok(keepSentence.includes(KEEP_WORDS.ko[c]), `방침 keep 문장에 ${c}(${KEEP_WORDS.ko[c]}) 없음`);
      for (const loc of ["ko", "en"]) {
        const note = DICTIONARIES[loc].privacyPrefs.opsKeepNote ?? "";
        assert.ok(note.includes(KEEP_WORDS[loc][c]), `${loc}.opsKeepNote에 ${c}(${KEEP_WORDS[loc][c]}) 없음: ${note}`);
      }
    }
  });
});

// ─── 11. PR #573 검증 2 — EN은 'anonymous'가 아니라 'non-identifying' (KO '비식별'과 같은 말) ──────
// 운영 정보는 사용자 키로 그 이용자의 다른 기록과 연결되는 프로젝트·검수 행에 함께 저장된다 → 'anonymous'
// (익명)는 KO '비식별'보다 센 주장이다. 두 블록 EN 전체에서 금지하고, 기록 줄은 어디에 저장되는지 말한다.
describe("#573 검증 2 — EN 운영 정보 문구: non-identifying, anonymous 금지", () => {
  it("privacyPrefs·trainingConsent EN 어디에도 'anonymous'가 없다", () => {
    for (const block of ["privacyPrefs", "trainingConsent"]) {
      for (const s of leafStrings(DICTIONARIES.en[block])) assert.ok(!/anonym/i.test(s), `${block}: ${s}`);
    }
  });

  it("EN 기록 줄·토글은 'non-identifying'(KO '비식별')이고, 기록 줄은 프로젝트 기록과 함께 저장된다고 말한다", () => {
    const p = DICTIONARIES.en.privacyPrefs;
    assert.match(DICTIONARIES.ko.privacyPrefs.lineRecording, /비식별/);
    assert.match(p.lineRecording, /non-identifying/);
    assert.match(p.lineRecording, /stored with your project records/);
    assert.match(p.opsToggle, /non-identifying/);
  });
});

// ─── 12. 서버 PR #574 수정 후(head 22da76c) 바뀐 사실을 문구에 반영 ─────────────────────────────
//  ① defaultOpsMetaForRegion(null) = "off" — 접속 국가를 모르면(XX·T1과 같게) 켜기 전까지 기록하지 않는다.
//     GET privacy-prefs가 region:null·opsMeta:"off"·opsMetaSource:"default"를 돌려주면 결과 화면은
//     off_default 줄 + 설정의 opsDefaultOffNote를 보인다 → "접속하신 나라의 규칙에 따라"만으로는 틀린 이유.
//  ② 0071 이전 사본: 본문 subject_hash=sha256(userKey)로 찾을 수는 있지만(백필 도구 — 실행은 Bae 승인 대기),
//     그 전까지는 "자동으로 지우지 못할 수 있다(문의 시 처리)"가 사실 — '색인이 없어 못 지운다'는 단정은 틀림.
describe("#574 수정 반영 — 국가 모름 = 기본 off · 0071 이전 사본은 '못할 수 있다'", () => {
  it("opsDefaultOffNote(KO/EN)는 '나라를 알 수 없는 경우'도 이유로 말한다", () => {
    assert.match(DICTIONARIES.ko.privacyPrefs.opsDefaultOffNote, /알 수 없/);
    assert.match(DICTIONARIES.en.privacyPrefs.opsDefaultOffNote, /can't tell/);
  });

  it("방침 끄기 문단: 유럽연합 등 + 접속 나라를 알 수 없는 경우도 켜기 전까지 기록하지 않는다", () => {
    assert.match(ops.OPS_INFO_OPT_OUT ?? "", /유럽연합·유럽경제지역·영국·스위스[^.]*알 수 없는 경우[^.]*켜시기 전까지[^.]*기록하지 않/);
    assert.match((ops.PRIVACY_CHANGE_LOG ?? []).at(-1)?.summary ?? "", /알 수 없/);
  });

  it("TRAINING_COPY_NOTE: 0071 이전 사본은 '지우지 못할 수 있습니다' — '색인이 없어 못 지운다'고 단정하지 않는다", () => {
    const s = ops.TRAINING_COPY_NOTE ?? "";
    assert.match(s, /삭제 기능이 생기기 전에 저장된 일부 사본은 자동으로 지우지 못할 수 있습니다/, s);
    assert.ok(!/색인이 없어/.test(s), s);
    assert.ok(!/지우지 못합니다/.test(s), s);
  });
});

// ─── 13. PR #573 검증 5 — 학습 사본 '담기는 것' = 서버 TrainingRecord·JourneyRecord 칸 전부 ─────────
// 옛 고지는 제품 설명·확인 항목·결과·변경 내용·저장소 이름·진행 기록만 말했지만, 사본(training-store
// buildTrainingRecord)에는 만든 도구·앱 유형·진입 경로·유입 경로·화면/입력 언어·프로젝트 수·요금제·AI 사용량·
// PR 번호·커밋 해시(와 운영 정보 기록이 켜져 있으면 접속 국가 코드)도 담긴다. 서버 레코드 타입의 칸마다
// '고지하는 말' 또는 '내용이 아닌 이유'를 정하게 강제한다 — 서버에 칸이 늘면 여기서 실패한다.
const TRAINING_FIELD_WORDS = {
  // 칸: [방침 TRAINING_DATA_SCOPE(KO), 카드 pointWhat KO, 카드 pointWhat EN] — null = 그 자리에서는 생략(이유 주석)
  product_spec: ["제품 설명", "제품 설명", "product description"],
  acceptance_items: ["확인 항목", "확인 항목", "checklist"],
  pr_files: ["변경 내용", "변경 내용", "changes"],
  results: ["확인 결과", "결과", "result"],
  summary: ["확인 결과", "결과", "result"],
  final_status: ["확인 결과", "결과", "result"],
  outcome: ["확인 결과", "결과", "result"],
  repo_full_name: ["저장소 이름", "저장소 이름", "code project's name"],
  pr_number: ["변경 요청 번호", "변경 요청 번호", "change request number"],
  head_sha: ["코드 버전 식별값", "코드 버전 식별값", "code version ID"],
  region: ["접속 국가 코드", "접속 국가 코드", "country code"],
  locale: ["화면 언어", "화면 언어", "screen language"],
  content_lang: ["입력 언어", "입력 언어", "input language"],
  entry_path: ["진입 경로", "진입 경로", "entry"],
  built_with: ["만든 도구", "만든 도구", "build tool"],
  topic_tags: ["앱 유형", "앱 유형", "app type"],
  acquisition: ["유입 경로", "유입 경로", "source"],
  user_context: ["프로젝트 수", "프로젝트 수", "number of projects"],
  commercial: ["요금제", "요금제", "plan"],
  cost_meta: ["AI 사용량", "AI 사용량", "AI usage"],
  event_type: ["진행 기록", "진행 기록", "record of the steps"],
  payload: ["진행 기록", "진행 기록", "record of the steps"],
  // 카드는 짧게 — 사용자 키 변환값은 방침('자세히')에서 말한다.
  subject_hash: ["변환한 값", null, null],
};
/** 사람·앱에 대한 내용이 아닌 칸 — 이유를 적는다. */
const TRAINING_FIELD_NOT_CONTENT = new Map([
  ["event_id", "사본 번호(확인 실행 번호와 같음) — 내부 식별자"],
  ["captured_at", "저장 시각"],
  ["schema_version", "사본 형식 버전"],
  ["consent_version", "동의한 조항 버전"],
  ["project_id", "프로젝트 내부 번호 — 프로젝트 삭제 때 사본을 찾아 지우는 데 쓴다"],
  ["review_run_id", "확인 실행 내부 번호"],
  ["rerun_of_review_run_id", "다시 확인한 원래 실행의 내부 번호"],
  ["workspace_hash", "빈 칸 — 캡처 호출이 값을 넣지 않는다(workspaceHash 없음)"],
  ["timezone", "빈 칸 — buildTrainingRecord가 항상 null"],
  ["assistance", "안내 기능 여부 — 안내 기능이 없어 항상 wild"],
  ["channel", "들어온 경로 — 웹 확인 경로라 항상 web"],
  ["mcp_client", "빈 칸 — 웹 경로에서는 항상 null"],
  ["payload_scrub_state", "비밀 키 지우기 처리 상태"],
  ["review_source", "어느 확인 엔진이 판정했는지"],
  ["device_context", "예약 칸 — 항상 null"],
  ["experiment_arm", "예약 칸 — 항상 null"],
  ["quality_signals", "예약 칸 — 항상 null"],
]);

function recordTypeFields(src, typeName) {
  const start = src.indexOf(`export type ${typeName} = {`);
  if (start < 0) return null;
  const body = src.slice(start, src.indexOf("\n};", start));
  return [...body.matchAll(/^ {2}(\w+)\s*:/gm)].map((m) => m[1]);
}

describe("#573 검증 5 — 학습 사본 '담기는 것' = 서버 기록 칸", () => {
  const trainingFields = recordTypeFields(trainingStoreTs, "TrainingRecord");
  const journeyFields = recordTypeFields(journeyStoreTs, "JourneyRecord");

  it("[가드] 서버 TrainingRecord·JourneyRecord 칸을 읽었다 (파서가 조용히 0개를 읽지 않게)", () => {
    assert.ok(trainingFields && trainingFields.length >= 30, JSON.stringify(trainingFields));
    assert.ok(journeyFields && journeyFields.length >= 6, JSON.stringify(journeyFields));
    for (const f of ["built_with", "cost_meta", "pr_number", "head_sha", "region"]) assert.ok(trainingFields.includes(f), f);
  });

  it("[서버 사실] 서버 기록의 모든 칸이 '고지하는 말' 또는 '내용이 아닌 이유' 중 정확히 하나에 있다", () => {
    const all = [...new Set([...(trainingFields ?? []), ...(journeyFields ?? [])])];
    const unclassified = all.filter((f) => !(f in TRAINING_FIELD_WORDS) && !TRAINING_FIELD_NOT_CONTENT.has(f));
    assert.deepEqual(unclassified, [], `새 칸 — 고지 문구(TRAINING_DATA_SCOPE·pointWhat)와 이 표를 함께 고치세요: ${unclassified.join(", ")}`);
    const both = all.filter((f) => f in TRAINING_FIELD_WORDS && TRAINING_FIELD_NOT_CONTENT.has(f));
    assert.deepEqual(both, []);
  });

  it("방침 TRAINING_DATA_SCOPE와 카드 pointWhat(KO/EN)이 담기는 칸을 모두 말한다", () => {
    const scope = ops.TRAINING_DATA_SCOPE ?? "";
    const ko = DICTIONARIES.ko.trainingConsent.pointWhat;
    const en = DICTIONARIES.en.trainingConsent.pointWhat;
    const missing = [];
    for (const [field, [policyWord, koWord, enWord]] of Object.entries(TRAINING_FIELD_WORDS)) {
      if (policyWord && !scope.includes(policyWord)) missing.push(`policy:${field}(${policyWord})`);
      if (koWord && !ko.includes(koWord)) missing.push(`ko:${field}(${koWord})`);
      if (enWord && !en.includes(enWord)) missing.push(`en:${field}(${enWord})`);
    }
    assert.deepEqual(missing, []);
  });

  it("접속 국가 코드는 운영 정보 기록이 켜져 있을 때만 담긴다고 조건을 붙인다 (서버: 끄면 사본 region도 null)", () => {
    assert.match(ops.TRAINING_DATA_SCOPE ?? "", /운영 정보 기록을 켜 두셨으면 접속 국가 코드/);
    assert.match(DICTIONARIES.ko.trainingConsent.pointWhat, /운영 정보 기록이 켜져 있으면 접속 국가 코드/);
    assert.match(DICTIONARIES.en.trainingConsent.pointWhat, /country code if operating info recording is on/);
  });
});

// ─── 14. PR #573 검증 6 — 옛 서버 방어 배선: 카드 노출은 prefs(null 포함)에서 곧바로 ───────────────
// 옛 배선(ResultPrivacySection `trainingState: loaded?.training.state ?? null`)은 `?? "undecided"`로 바뀌어도
// 테스트가 통과했다 — 옛 서버(prefs=null)에서 카드가 뜨는 회귀를 못 잡았다. 판단을 순수 함수로 옮기고
// prefs=null 행을 표에 넣는다.
describe("#573 검증 6 — cardVisibleFromPrefs(prefs, seen, runId, resultDone) 표", () => {
  const P = (state) => K.normalizePrivacyPrefs({ ...VALID, training: { state, version: "v", decidedAt: null } });
  const rows = [
    // [이유, prefs, seen, runId, resultDone, 기대]
    ["옛 서버·네트워크(prefs=null) → 숨김 (추측으로 '아직 정하지 않음'이라 보지 않는다)", null, [], "r1", true, false],
    ["계약 밖 모양(training 없음) → 숨김", { opsMeta: "on" }, [], "r1", true, false],
    ["아직 정하지 않음 + 첫 완료 결과 → 보임", P("undecided"), [], "r1", true, true],
    ["아직 정하지 않음 + 진행 중 결과 → 숨김", P("undecided"), [], "r1", false, false],
    ["아직 정하지 않음 + 이미 두 결과에서 봄 → 숨김", P("undecided"), ["r1", "r2"], "r3", true, false],
    ["허용함 → 숨김", P("consented"), [], "r1", true, false],
    ["거절함 → 숨김", P("declined"), [], "r1", true, false],
  ];
  for (const [why, prefs, seen, runId, resultDone, want] of rows) {
    it(`${why} → ${want}`, () => {
      assert.equal(typeof K.cardVisibleFromPrefs, "function", "cardVisibleFromPrefs exported");
      assert.equal(K.cardVisibleFromPrefs(prefs, seen, runId, resultDone), want);
    });
  }

  it("결과 화면은 그 함수 하나로 판단한다 — 컴포넌트가 training.state를 직접 풀지 않는다", () => {
    assert.match(resultSectionSrc, /cardVisibleFromPrefs\(loaded, seen, runId, resultDone\)/);
    assert.ok(!/trainingState:/.test(resultSectionSrc), "component re-derives trainingState inline");
    assert.ok(!/\?\?\s*"undecided"/.test(resultSectionSrc + read(path.join(SRC, "lib/privacy-prefs.mjs"))), "no guessed 'undecided'");
  });
});

// ─── 15. PR #573 검증 3 — 철회는 동의와 같은 화면·같은 클릭 수 (계획 §4 · GDPR 7(3)) ─────────────────
// 옛 카드는 허용으로 저장되면 버튼이 사라지고 "프로젝트 설정에서 철회"만 남았다 — 동의는 결과 화면 1클릭,
// 철회는 다른 화면으로 이동 + 토글. 이제: 같은 카드에 같은 클래스의 [허용 철회](1클릭, 같은 API), 그 뒤의
// 결과 화면에서도 허용한 사람에게 '학습 데이터 제공 중 · 철회' 1클릭.
const buttonChunks = (src) => src.split("<button").slice(1).map((c) => c.slice(0, c.indexOf("</button>")));

describe("#573 검증 3 — 철회 = 동의와 같은 화면·같은 클릭 수", () => {
  it("카드: 허용으로 저장된 상태에도 같은 클래스(CONSENT_CHOICE_CLASS)의 [허용 철회] 버튼이 있고, 같은 저장 함수(choose(false))를 부른다", () => {
    const withdraw = buttonChunks(cardSrc).find((b) => b.includes("{s.withdraw}"));
    assert.ok(withdraw, "no withdraw button in the card");
    assert.match(withdraw, /onClick=\{\(\) => void choose\(false\)\}/);
    assert.match(withdraw, /className=\{CONSENT_CHOICE_CLASS\}/);
    // 허용 저장 상태 블록(`{choice === "consented" && (` … 다음 `{(choice ===` 또는 `{choice ===` 전) 안에 있다.
    const start = cardSrc.indexOf('{choice === "consented" && (');
    assert.ok(start > 0, "consented block");
    const rest = cardSrc.slice(start + 1);
    const next = rest.search(/\{\(?choice === /);
    const consentedBlock = next >= 0 ? rest.slice(0, next) : rest;
    assert.ok(consentedBlock.includes("{s.withdraw}"), `withdraw sits inside the consented block: ${consentedBlock}`);
    assert.ok(consentedBlock.includes("{s.savedAllowed}"), "the saved-allowed status is in the same block");
  });

  it("카드 상태 전이 표 (trainingCardNextChoice) — 허용 뒤 철회는 'withdrawn', 저장 실패는 'error'", () => {
    assert.equal(typeof K.trainingCardNextChoice, "function");
    const ok = (active) => ({ ok: true, active });
    assert.equal(K.trainingCardNextChoice("ask", true, ok(true)), "consented");
    assert.equal(K.trainingCardNextChoice("ask", false, ok(false)), "declined");
    assert.equal(K.trainingCardNextChoice("consented", false, ok(false)), "withdrawn");
    assert.equal(K.trainingCardNextChoice("consented", false, ok(true)), "error");
    assert.equal(K.trainingCardNextChoice("ask", true, { ok: false, active: false }), "error");
    assert.equal(K.trainingCardNextChoice("consented", false, { ok: false, active: false }), "error");
  });

  it("결과 화면 줄 노출 (trainingWithdrawLineVisible) — 허용한 사람에게만, 카드가 떠 있으면 카드 버튼으로", () => {
    assert.equal(typeof K.trainingWithdrawLineVisible, "function");
    const P = (state) => K.normalizePrivacyPrefs({ ...VALID, training: { state, version: "v", decidedAt: "t" } });
    assert.equal(K.trainingWithdrawLineVisible(null, false), false, "unknown server → no claim");
    assert.equal(K.trainingWithdrawLineVisible(P("consented"), false), true);
    assert.equal(K.trainingWithdrawLineVisible(P("consented"), true), false, "card already offers withdraw");
    assert.equal(K.trainingWithdrawLineVisible(P("declined"), false), false);
    assert.equal(K.trainingWithdrawLineVisible(P("undecided"), false), false);
  });

  it("결과 화면: '학습 데이터 제공 중 · 철회'는 1클릭(확인 창 없음)이고, 카드와 같은 API(saveTrainingConsent(userKey, false))", () => {
    assert.match(resultSectionSrc, /trainingWithdrawLineVisible\(prefs, showCard\)/);
    assert.match(resultSectionSrc, /\{s\.lineSharing\}/);
    const btn = buttonChunks(resultSectionSrc).find((b) => b.includes("{s.lineWithdraw}"));
    assert.ok(btn, "withdraw button on the result line");
    assert.match(btn, /onClick=\{\(\) => void withdrawTraining\(\)\}/);
    assert.match(resultSectionSrc, /saveTrainingConsent\(userKey, false\)/);
    assert.match(cardSrc, /saveTrainingConsent\(userKey, allow\)/);
    assert.ok(!/confirm\(|window\.confirm/.test(resultSectionSrc + cardSrc), "no extra confirmation step");
    assert.match(resultSectionSrc, /\{s\.savedOffDeletes\}/, "after withdrawal, say what happened");
  });

  it("사전: 철회 문구 KO/EN — 허용 저장 안내는 '여기서' 철회할 수 있다고, 카드 '바꾸기'는 한 번에 철회를 말한다", () => {
    const ko = DICTIONARIES.ko.trainingConsent;
    const en = DICTIONARIES.en.trainingConsent;
    assert.equal(ko.withdraw, "허용 철회");
    assert.equal(ko.lineSharing, "학습 데이터 제공 중");
    assert.equal(ko.lineWithdraw, "철회");
    assert.match(ko.savedAllowed, /여기서/);
    assert.match(en.savedAllowed, /here/);
    assert.match(ko.pointControl, /한 번에 철회/);
    assert.match(en.pointControl, /one click/);
    // 철회 뒤 안내는 0071 이전 사본 예외를 숨기지 않는다(결과 화면에서도 옛 동의자가 철회할 수 있다).
    assert.match(ko.savedOffDeletes, /자동으로 지워지지 않을 수 있어요/);
    assert.match(en.savedOffDeletes, /may not be removed automatically/);
  });

  it("방침: 철회는 설정 화면이나 확인 결과 화면에서 (§6 · 학습 데이터 '선택')", () => {
    const s6 = privacyPageSrc.slice(privacyPageSrc.indexOf("6. 이용자의 권리"), privacyPageSrc.indexOf("7. 개인정보 보호책임자"));
    assert.match(s6, /학습 데이터 제공 동의는[^.]*확인 결과 화면에서[^.]*철회/, s6);
    assert.match(ops.TRAINING_DATA_CHOICE ?? "", /확인 결과 화면에서도 한 번에 철회/);
  });
});

// [서버 사실] 서버 privacy-prefs.ts 머리말의 '무엇을 끄는가'·'끄지 않는 것' 표 = 대시보드 STOPS·KEEPS.
// 서버 파일이 이 트리에 없으면(서버 PR #574가 base에 없음) todo — 머지 순서는 아래 [서버 K 게이트]가 강제한다.
const serverPrefsTs = read(path.join(CP, "workspace/privacy-prefs.ts"));
const MIGRATION_TABLES = new Set(
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .flatMap((f) => [...read(path.join(MIGRATIONS_DIR, f)).matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1])),
);

/** 머리말 한 덩어리에서 칸·테이블 이름을 대시보드 표기(table:이름)로. "(0070, …)" 같은 곁말은 뺀다. */
function serverNames(block) {
  const out = new Set();
  const text = block.replace(/\(\d[^)]*\)/g, "");
  for (const m of text.matchAll(/\b(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.)?([a-z][a-z0-9]*(?:_[a-z0-9]+)+|locale|resolved|region)\b(\(\+at\))?/g)) {
    const name = MIGRATION_TABLES.has(m[1]) ? `table:${m[1]}` : m[1];
    if (/^table:workspace_(visual_checks|repair_jobs|projects)$/.test(name)) continue; // "테이블.칸"의 테이블 쪽
    out.add(name);
    if (m[2]) out.add(`${m[1]}_at`);
  }
  return out;
}

function serverOffTable(src) {
  const head = src.slice(0, src.indexOf("*/"));
  const stopsAt = head.indexOf("무엇을 끄는가");
  const keepsAt = head.indexOf("끄지 않는 것");
  const endAt = head.indexOf("기본값:");
  if (stopsAt < 0 || keepsAt < stopsAt || endAt < keepsAt) return null;
  return { stops: serverNames(head.slice(stopsAt, keepsAt)), keeps: serverNames(head.slice(keepsAt, endAt)) };
}

describe("[서버 사실] 끄기 표 — 서버 privacy-prefs.ts 머리말 = 대시보드 OPS_META_OFF_STOPS·KEEPS", () => {
  const opt = serverPrefsTs ? {} : { todo: "서버 privacy-prefs.ts가 이 트리에 없음(서버 PR #574가 base에 들어오면 켜진다)" };
  it("[서버 사실] '무엇을 끄는가' = STOPS, '끄지 않는 것' = KEEPS (양방향)", opt, () => {
    const table = serverOffTable(serverPrefsTs);
    assert.ok(table, "privacy-prefs.ts 머리말에서 '무엇을 끄는가'·'끄지 않는 것'·'기본값:'을 찾지 못함");
    assert.ok(table.stops.size >= 4 && table.keeps.size >= 10, `parsed stops=${[...table.stops]} keeps=${[...table.keeps]}`);
    assert.deepEqual([...table.stops].sort(), [...(ops.OPS_META_OFF_STOPS ?? [])].sort(), "STOPS");
    assert.deepEqual([...table.keeps].sort(), [...(ops.OPS_META_OFF_KEEPS ?? [])].sort(), "KEEPS");
  });

  it("[가드] 파서가 서버 머리말 모양을 읽는다 (가상 머리말)", () => {
    const fake = [
      "/**",
      " * 무엇을 끄는가: 0069 —",
      " *   workspace_visual_checks.region · envelope_json · finding_codes_json",
      " *   workspace_projects.region_at_create",
      " * 끄지 않는 것:",
      " *   - 기능 데이터: user_verdict(+at)·source_check_id·resolved·verify_check_id·locale.",
      " *   - llm_usage(0070, user_key_hash·project_id) — 원장.",
      " *   - workspace_rate_limit·demo_rate_limit — 제한.",
      " *   - 0055·0056 프로젝트 행(built_with_json·entry_path·topic_tags_json·acquisition_json).",
      " * 기본값: …",
      " */",
    ].join("\n");
    const t = serverOffTable(fake);
    assert.deepEqual([...t.stops].sort(), ["envelope_json", "finding_codes_json", "region", "region_at_create"]);
    assert.deepEqual([...t.keeps].sort(), [
      "acquisition_json", "built_with_json", "entry_path", "locale", "resolved", "source_check_id",
      "table:demo_rate_limit", "table:llm_usage", "table:workspace_rate_limit", "topic_tags_json",
      "user_verdict", "user_verdict_at", "verify_check_id",
    ]);
  });
});
