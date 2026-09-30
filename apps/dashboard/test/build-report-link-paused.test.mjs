/**
 * B-8 #578 — 스위치 단일화 뒤 대시보드 쪽 두 가지.
 *
 *  1) 내 앱 카드의 [이 앱 신고하기]는 B-7(#575) 신고 사이트로 **직행**: `https://report.<루트>/?app=<slug>`.
 *     B-7은 신고 폼을 유저 앱과 다른 origin(report.<루트>)에 두고, 앱 주소의 /.well-known/simsa-report는 그리로
 *     302만 한다. 앱 origin 경로를 링크하면 그 앱이 등록한 서비스 워커가 요청을 가로챌 수 있다(B-7 route.ts 주석) —
 *     그래서 카드는 앱 origin을 거치지 않는다. 규칙(slug 형식·예약어·라벨·주소 모양)은 hosting-dispatch와 대조한다.
 *  2) 시작 오류 `build_disabled`(503) → "잠시 멈췄어요" 문구는 **약속도 비용 말도 없다**(프로덕션은 스위치 "off"라
 *     여는 때가 정해지지 않았다).
 *
 * 네임스페이스 import — 옛 모듈에 없는 export는 undefined라 파일이 통째로 죽지 않고 테스트마다 제 이유로 실패한다.
 * Rule 6: 한글 호스트명(IDN)·"(주)트루픽셀 예약 앱" slug.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const view = await import("../src/lib/build-job-view.mjs");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROUTE_SRC_PATH = path.join(REPO, "apps/hosting-dispatch/src/route.ts");
const routeSrc = readFileSync(ROUTE_SRC_PATH, "utf8");
const APP = "https://app-7x9k2m1q.simsa.page/";

// ─── 1) 신고 링크 ─────────────────────────────────────────────────────────────

describe("내 앱 카드 신고 링크 — B-7 신고 사이트 직행", () => {
  it("★앱 주소 → https://report.<루트>/?app=<slug> (앱 origin의 /.well-known/simsa-report가 아님)", () => {
    assert.equal(view.hostedReportUrl(APP), "https://report.simsa.page/?app=app-7x9k2m1q");
    // 경로·쿼리·대문자 호스트·끝 점은 slug를 바꾸지 않는다.
    assert.equal(view.hostedReportUrl("https://app-7x9k2m1q.simsa.page/예약?x=1#top"), "https://report.simsa.page/?app=app-7x9k2m1q");
    assert.equal(view.hostedReportUrl("https://APP-7x9k2m1q.Simsa.Page"), "https://report.simsa.page/?app=app-7x9k2m1q");
    assert.equal(view.hostedReportUrl("https://truepixel-booking.simsa.page./"), "https://report.simsa.page/?app=truepixel-booking");
    assert.ok(!String(view.hostedReportUrl(APP)).includes("/.well-known/"), "카드는 앱 origin을 거치지 않는다");
  });

  it("Rule 6: 한글 호스트(IDN → xn--…)는 slug가 될 수 없다 — 앱 지정 없이 신고 사이트로(깨진 app= 없음)", () => {
    assert.equal(view.hostedReportUrl("https://트루픽셀예약.simsa.page/"), "https://report.simsa.page/");
    assert.equal(view.hostedReportUrl("https://xn--2s2bq6m9rd4pan12cvrd.simsa.page"), "https://report.simsa.page/");
  });

  it("호스팅 주소 모양이 아니면(https 아님·서브도메인 없음) 링크를 만들지 않는다 → 카드도 없다", () => {
    for (const bad of ["javascript:alert(1)", "http://app-7x9k2m1q.simsa.page/", "https://simsa.page/", "https://localhost/", null, undefined, ""]) {
      assert.equal(view.hostedReportUrl(bad), null, String(bad));
    }
    assert.equal(view.appCardView({ status: "done", deployedUrl: "https://simsa.page/" }, []), null);
  });

  it("★내 앱 카드의 reportUrl이 그 링크다", () => {
    assert.equal(view.appCardView({ status: "done", deployedUrl: APP }, [])?.reportUrl, "https://report.simsa.page/?app=app-7x9k2m1q");
  });

  it("옛 앱 origin 경로 상수는 없다(한 곳 — 헬퍼만)", () => {
    assert.equal(view.HOSTED_REPORT_PATH, undefined);
  });
});

// ─── B-7 대조 ─────────────────────────────────────────────────────────────────

/** hosting-dispatch route.ts의 SLUG_RE 소스 · RESERVED_SLUGS 목록(빌드 없이 소스에서). */
function dispatchRules() {
  const re = /export const SLUG_RE = \/(.+)\/;/.exec(routeSrc);
  const set = /export const RESERVED_SLUGS[^=]*= new Set\(\[([\s\S]*?)\]\)/.exec(routeSrc);
  assert.ok(re && set, "hosting-dispatch route.ts의 SLUG_RE · RESERVED_SLUGS를 찾지 못함");
  return { slugSource: re[1], reserved: [...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort() };
}

/** B-7 hostingReportUrl — 빌드된 dist가 있고 export가 있으면 그 함수, 아니면 null. */
async function b7Helper() {
  try {
    const mod = await import(pathToFileURL(path.join(REPO, "apps/hosting-dispatch/dist/route.js")).href);
    return typeof mod.hostingReportUrl === "function" ? mod.hostingReportUrl : null;
  } catch {
    return null;
  }
}

// B-7 자신의 테스트가 고정한 입력·기대(hosting-dispatch/test/hosting-duties.test.mjs "hostingReportUrl · hostingRulesUrl 헬퍼")
// + 우리 카드가 실제로 받는 slug(toHostedSlug 모양)·경계.
const B7_TABLE = [
  ["app-abc", "simsa.page", "https://report.simsa.page/?app=app-abc"],
  ["www", "simsa.page", "https://report.simsa.page/"],
  ["app-7x9k2m1q", "simsa.page", "https://report.simsa.page/?app=app-7x9k2m1q"],
  ["truepixel-booking", " Simsa.Page. ", "https://report.simsa.page/?app=truepixel-booking"],
  ["report", "simsa.page", "https://report.simsa.page/"],
  ["xn--2s2bq6m9rd4pan12cvrd", "simsa.page", "https://report.simsa.page/"],
  ["-bad", "simsa.page", "https://report.simsa.page/"],
  ["ab", "simsa.page", "https://report.simsa.page/"],
];

describe("B-7(#575) 헬퍼와 같은 모양", () => {
  it("★slug 규칙·예약어는 hosting-dispatch와 같다(라우터가 받는 slug만 app=로 싣는다)", () => {
    const { slugSource, reserved } = dispatchRules();
    assert.equal(view.HOSTED_SLUG_RE?.source, slugSource);
    assert.deepEqual([...(view.HOSTED_RESERVED_SLUGS ?? [])].sort(), reserved);
    assert.equal(view.HOSTED_REPORT_HOST_LABEL, "report");
    assert.ok(reserved.includes(view.HOSTED_REPORT_HOST_LABEL), "신고 라벨은 유저 앱이 가질 수 없다");
  });

  it("★hostingReportUrlFor(slug, 루트) = B-7 hostingReportUrl(slug, 루트) — B-7이 빌드돼 있으면 함수끼리, 아니면 B-7 테스트의 고정값으로", async () => {
    assert.equal(typeof view.hostingReportUrlFor, "function", "hostingReportUrlFor");
    const b7 = await b7Helper();
    const b7InSource = /export function hostingReportUrl\(/.test(routeSrc);
    for (const [slug, root, expected] of B7_TABLE) {
      const ours = view.hostingReportUrlFor(slug, root);
      assert.equal(ours, expected, `${slug} @ ${root}`);
      if (b7) assert.equal(ours, b7(slug, root), `B-7 dist와 다름: ${slug} @ ${root}`);
    }
    if (b7InSource && !b7) {
      // B-7이 들어왔지만 dist가 아직 빌드되지 않았다 — 소스의 주소 모양으로 대조한다(조용히 넘어가지 않는다).
      assert.match(routeSrc, /export const REPORT_HOST_LABEL = "report";/);
      assert.match(routeSrc, /`https:\/\/\$\{REPORT_HOST_LABEL\}\.\$\{normalizeRootDomain\(rootDomain\)\}\/`/);
      assert.match(routeSrc, /isValidSlug\(slug\) \? `\$\{base\}\?app=\$\{slug\}` : base/);
    }
  });

  it("앱 주소에서 뽑은 slug·루트로 만든 링크 = hostingReportUrlFor(slug, 루트)", () => {
    for (const slug of ["app-7x9k2m1q", "truepixel-booking", "abc"]) {
      assert.equal(view.hostedReportUrl(`https://${slug}.simsa.page/`), view.hostingReportUrlFor?.(slug, "simsa.page"), slug);
    }
  });
});

// ─── 2) build_disabled 문구 ───────────────────────────────────────────────────

describe("시작 오류 build_disabled(503) → 잠시 멈춤 — 약속·비용 말 없음", () => {
  it("매핑: 503 build_disabled → paused(안내 어조 · 지시서 받아가기 함께)", () => {
    assert.equal(view.START_ERROR_CODES.build_disabled, "paused");
    assert.equal(view.startErrorNotice(503, { ok: false, error: "build_disabled" }).errorKey, "paused");
    assert.equal(view.startErrorTone("paused"), "info");
    assert.equal(view.startNoticeOffersTakeSpec?.("paused"), true);
  });

  it("★KO/EN 문구: '잠시 멈췄어요' — 다시 여는 때를 약속하지 않고 비용 말도 없다", () => {
    const ko = DICTIONARIES.ko.makeApp.startErrors.paused;
    const en = DICTIONARIES.en.makeApp.startErrors.paused;
    assert.match(ko, /지금은 만들기를 잠시 멈췄어요/);
    assert.match(en, /paused/i);
    assert.doesNotMatch(ko, /곧|다시 열|열게요|비용|무료|요금/, ko);
    assert.doesNotMatch(en, /soon|reopen|we'll|charge|free|cost|pay/i, en);
  });
});
