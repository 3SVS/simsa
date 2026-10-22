/**
 * agent-driver.mjs — agent 엔진의 브라우저 드라이버(Playwright) (2026-10-05).
 *
 * agent-run.mjs는 이 드라이버의 **인터페이스**만 안다(테스트는 가짜 드라이버로 같은 실행기를 끝까지 돈다).
 * 여기만 Playwright를 안다 — playwright는 동적 import(컨테이너 이미지와 로컬 실측에서만 깔려 있다).
 *
 * 비밀 취급:
 *   - 로그인 칸은 fill로 넣고 값은 어디에도 기록하지 않는다. 채운 아이디 칸·모든 비밀번호 칸은 이후 스크린샷에서 가린다(mask).
 *   - 관찰(접근성 스냅샷·본문)은 agent-run.mjs가 LLM에 보내기 전에 가린다(redactSecrets).
 *   - 직접 로그인(라이브) 입력은 이 프로세스 메모리에서만 지나간다.
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { controlPreference } from "./click-target.mjs";

const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT = 20_000;
const ACT_TIMEOUT = 8_000;

export async function createPlaywrightDriver({ outDir, locale = "ko", isNoiseResource = () => false, attemptSignup = null, chromium = null }) {
  const pw = chromium ? { chromium } : await import("playwright");
  const shotsDir = join(outDir, "screenshots");
  mkdirSync(shotsDir, { recursive: true });
  const browser = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctxOpts = {
    viewport: VIEWPORT,
    locale: locale === "en" ? "en-US" : "ko-KR",
    timezoneId: "Asia/Seoul",
    permissions: ["geolocation"],
    geolocation: { latitude: 37.5665, longitude: 126.978 },
  };

  let context = null;
  let page = null;
  let crashes = 0;
  let net5xx = 0;
  const networkErrors = [];
  const consoleErrors = [];
  /** 로그인 때 채운 칸 — 이후 모든 스크린샷에서 가린다. */
  const maskSelectors = new Set(["input[type=password]"]);
  let dialogSeen = false;
  /**
   * (2026-10-21 §8 후속) 앱이 alert/confirm으로 답한 글자. 종전엔 닫기만 하고 글자를 버려, gemini의 "시술 메뉴를 최소 하나 이상
   * 선택해주세요."가 에이전트에게 "NO VISIBLE CHANGE"로만 보였다(3런 내내 시술 없이 제출 반복). 행동 하나 동안만 모은다.
   */
  const dialogMessages = [];
  /** "dismiss"(기본) | "accept" — 허용된 내 기록 클릭(acceptDialog) 동안만 accept. */
  let dialogPolicy = "dismiss";
  const writes = [];
  /** (v2 S4a) 쓰기 요청의 응답 — { at, line, status }. */
  const writeResults = [];
  let storageMark = { at: Date.now(), local: "", session: "" };
  const readStorage = async () =>
    page
      .evaluate(() => {
        const dump = (s) => {
          try {
            const o = {};
            for (let i = 0; i < s.length; i += 1) {
              const k = s.key(i);
              if (k) o[k] = s.getItem(k);
            }
            return JSON.stringify(o);
          } catch {
            return "";
          }
        };
        return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
      })
      .catch(() => ({ local: "", session: "" }));

  function wire(p) {
    p.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    p.on("pageerror", (e) => {
      crashes += 1;
      consoleErrors.push(`Uncaught ${String(e).slice(0, 300)}`);
    });
    p.on("requestfailed", (r) => {
      const t = r.failure()?.errorText ?? "failed";
      // 사용자가 화면을 떠나며 취소된 요청(ERR_ABORTED)은 고장이 아니다.
      if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(t) || isNoiseResource(r.url())) return;
      networkErrors.push(`${r.method()} ${r.url().slice(0, 160)} (${t})`);
    });
    p.on("response", (r) => {
      if (r.status() >= 500 && !isNoiseResource(r.url())) {
        net5xx += 1;
        networkErrors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
      } else if (r.status() >= 400 && r.request().resourceType() !== "document" && !isNoiseResource(r.url()) && ["xhr", "fetch"].includes(r.request().resourceType())) {
        networkErrors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
      }
      // (2026-10-21 v2 S4a) 쓰기 요청의 응답 코드 — v2 검증기의 "pass = 쓰기 2xx"(V-2)가 이 값을 본다. 요청 기록(writes)과 같은 줄 모양.
      const rq = r.request();
      const rt = rq.resourceType();
      if ((rt === "xhr" || rt === "fetch") && rq.method() !== "GET" && rq.method() !== "OPTIONS" && !isNoiseResource(r.url())) {
        writeResults.push({ at: Date.now(), line: `${rq.method()} ${r.url().slice(0, 140)}`, status: r.status() });
      }
    });
    // A2 탐침: 앱이 서버로 보낸 쓰기 요청(데이터 요청 중 GET이 아닌 것) — 시각과 함께.
    p.on("request", (r) => {
      const t = r.resourceType();
      if ((t === "xhr" || t === "fetch") && r.method() !== "GET" && r.method() !== "OPTIONS" && !isNoiseResource(r.url())) {
        writes.push({ at: Date.now(), line: `${r.method()} ${r.url().slice(0, 140)}` });
      }
    });
    // 2026-10-19(격차 §7 발견 ③): confirm()을 늘 dismiss하면 confirm으로 묻는 앱에서 "취소"가 절대 실행되지 않아 앱 결함처럼
    //  보였다(bolt·gemini 실측). 허용된 내 기록 클릭(acceptDialog) 동안만 accept, 그 밖엔 종전대로 dismiss.
    p.on("dialog", (d) => {
      dialogSeen = true;
      if (dialogMessages.length < 5) dialogMessages.push(`${d.type()}: ${String(d.message() ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
      (dialogPolicy === "accept" ? d.accept() : d.dismiss()).catch(() => {});
    });
    p.setDefaultTimeout(ACT_TIMEOUT);
  }

  /** B5: 고친 단일 파일을 그 주소에 끼워 넣는다(새 컨텍스트에도 이어진다). null이면 원래 파일. */
  let override = null;
  async function applyOverride(ctx) {
    if (!override) return;
    const { url, html } = override;
    const target = new URL(url);
    await ctx.route(
      (u) => u.origin === target.origin && (u.pathname === target.pathname || (target.pathname === "/" && u.pathname === "/index.html")),
      (route) => (route.request().resourceType() === "document" ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }) : route.continue()),
    );
  }

  async function openContext(storageState) {
    if (context) await context.close().catch(() => {});
    context = await browser.newContext({ ...ctxOpts, ...(storageState ? { storageState } : {}) });
    await applyOverride(context);
    page = await context.newPage();
    wire(page);
  }

  function locateAll(target) {
    const n = target.name;
    if (target.label) return page.getByLabel(target.label, { exact: false });
    if (target.placeholder) return page.getByPlaceholder(target.placeholder, { exact: false });
    if (target.role && n) return page.getByRole(target.role, { name: n, exact: false });
    if (target.text) return page.getByText(target.text, { exact: false });
    return null;
  }

  /**
   * 일치 목록에서 **보이는** 첫 요소(입력이면 편집 가능한 요소)를 고른다. 종전 `.first()`는 숨은 사본(모바일/데스크톱
   * 이중 레이아웃·재렌더 전 노드)을 골라 fill이 8초 타임아웃 → "입력이 안 된다" 오판을 만들었다(벤치마크 #1 run-4 v0).
   * 고른 경위를 진단 문자열로 돌려준다(계측: 일치 수·보이는 수·태그).
   */
  async function pickVisible(all, { editable = false } = {}) {
    const count = await all.count().catch(() => 0);
    let visible = 0;
    let chosen = null;
    let chosenScore = -Infinity;
    let chosenIdx = -1;
    let tag = "";
    for (let i = 0; i < Math.min(count, 20); i += 1) {
      const el = all.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      visible += 1;
      if (editable) {
        if (chosen || !(await el.isEditable().catch(() => false))) continue;
        chosen = el;
        chosenIdx = i;
        continue;
      }
      // (§8 후속) 누르기 대상: 같은 이름이 여럿이면 제출 버튼·폼 안을 nav 탭보다 앞에(동점이면 앞쪽 — 종전 동작).
      const s = count > 1 ? await controlPreference(el) : 0;
      if (s > chosenScore) {
        chosen = el;
        chosenScore = s;
        chosenIdx = i;
      }
    }
    if (chosen) tag = await chosen.evaluate((e) => `${e.tagName.toLowerCase()}${e.getAttribute("type") ? `[type=${e.getAttribute("type")}]` : ""}${e.closest("nav, header") ? "@nav" : e.closest("form") ? "@form" : ""}`).catch(() => "?");
    return { el: chosen, diag: `matched=${count} visible=${visible} chosen=${chosen ? `${tag}#${chosenIdx}` : "none"}` };
  }

  /** 이름만 준 경우: 버튼 → 링크 → 아무 글자 순서(누를 수 있는 것 우선 — click-target.mjs와 같은 원칙). */
  async function locateByName(name, editable) {
    const roles = editable ? ["textbox", "combobox", "spinbutton", "searchbox"] : ["button", "link", "tab", "option", "menuitem", "checkbox", "radio"];
    for (const role of roles) {
      const p = await pickVisible(page.getByRole(role, { name, exact: false }), { editable });
      if (p.el) return p;
    }
    if (editable) {
      const p = await pickVisible(page.getByLabel(name, { exact: false }), { editable });
      if (p.el) return p;
      return pickVisible(page.getByPlaceholder(name, { exact: false }), { editable });
    }
    return pickVisible(page.getByText(name, { exact: false }));
  }

  async function resolveTargetDiag(target, editable = false) {
    const all = locateAll(target);
    let p = all ? await pickVisible(all, { editable }) : { el: null, diag: "no_locator" };
    if (p.el) return p;
    const name = target.name ?? target.label ?? target.placeholder ?? target.text;
    if (name) {
      const q = await locateByName(name, editable);
      if (q.el) return { el: q.el, diag: `${p.diag} → byName ${q.diag}` };
      p = { el: null, diag: `${p.diag} → byName ${q.diag}` };
    }
    return p;
  }

  async function resolveTarget(target) {
    return (await resolveTargetDiag(target)).el;
  }

  /**
   * 화면 상태 서명: 주소 + 본문 글자 + 상태 속성(aria-pressed/selected/checked/expanded/current, data-state, disabled,
   * class)·입력값. (F7) 2026-10-06 진단: 시간·시술 칩("10:00", "커트 15,000원")은 눌러도 글자·주소가 그대로고 선택 표시
   * (aria-pressed·class)만 바뀐다 — 글자만 재던 점검이 그걸 "반응 없음"으로 셌다. 상태 속성 변화도 반응이다.
   */
  const stateSignature = async () => {
    const dom = await page
      .evaluate(() => {
        const parts = [];
        const els = document.querySelectorAll("button, a, input, select, textarea, [role], [aria-pressed], [aria-selected], [aria-checked], [data-state]");
        let i = 0;
        for (const el of els) {
          if (i++ > 600) break;
          const a = (n) => el.getAttribute(n) ?? "";
          parts.push(
            [el.tagName, a("aria-pressed"), a("aria-selected"), a("aria-checked"), a("aria-expanded"), a("aria-current"), a("data-state"), el.disabled ? "D" : "", el.className && typeof el.className === "string" ? el.className : "", "value" in el ? String(el.value ?? "") : "", el.checked ? "C" : ""].join("|"),
          );
        }
        return (document.body?.innerText ?? "") + "\n" + parts.join("\n");
      })
      .catch(() => "");
    let h = 0;
    for (let i = 0; i < dom.length; i += 1) h = (h * 31 + dom.charCodeAt(i)) | 0;
    return `${page.url()}#${dom.length}:${h}`;
  };

  const bodyText = async () => (await page.locator("body").innerText({ timeout: 4000 }).catch(() => "")).replace(/\s+\n/g, "\n").trim();

  /**
   * (2026-10-20 격차 §8 c-1) 내 기록 행의 버튼을 결정론으로 고른다. 종전엔 표지 검사·클릭 모두 "보이는 첫 '취소'"(=목록 첫 행,
   * 남의 기록)를 봐서 bolt에서 18/18 차단됐다. 이름이 맞는 보이는 버튼을 전부 돌며, 버튼에서 위로 올라가 번호가 처음 나오는
   * 상자를 그 행으로 본다. 후보 = 행에 내 표지가 있고 · 행의 번호가 **전부 내 번호**이고(남의 번호가 섞이면 행 범위가 넓은 것 →
   * 거부) · 행 안에 같은 이름 버튼이 1개. 후보가 없으면 null(누르지 않는다 — 남은 것은 leftover로 정직하게).
   */
  async function pickOwnRecord(target, markers) {
    const mine = markers.map((m) => String(m ?? "").replace(/\D/g, "")).filter((d) => d.length >= 10);
    const lists = [];
    const all = locateAll(target);
    if (all) lists.push(all);
    const name = target.name ?? target.text ?? target.label;
    if (name) for (const role of ["button", "link"]) lists.push(page.getByRole(role, { name, exact: false }));
    for (const list of lists) {
      const count = await list.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 50); i += 1) {
        const el = list.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        const row = await el
          .evaluate((node) => {
            const PHONE = /01\d[-\s]?\d{3,4}[-\s]?\d{4}/g;
            const label = (node.innerText || node.textContent || "").trim();
            let box = node.parentElement;
            for (let up = 0; box && up < 8; up += 1, box = box.parentElement) {
              const text = box.innerText || box.textContent || "";
              const phones = text.match(PHONE) ?? [];
              if (phones.length === 0) continue;
              const same = [...box.querySelectorAll("button, a, [role=button]")].filter((b) => (b.innerText || b.textContent || "").trim() === label).length;
              return { text: text.slice(0, 2000), phones: phones.map((p) => p.replace(/\D/g, "")), same };
            }
            return null;
          })
          .catch(() => null);
        if (!row) continue;
        const hasMarker = markers.some((m) => m && row.text.includes(m));
        const onlyMine = row.phones.every((p) => mine.includes(p));
        if (hasMarker && onlyMine && row.same === 1) return el;
      }
    }
    return null;
  }
  /** ownsRecordNear가 고른 내 행의 버튼 — 바로 다음 ownRecord 클릭이 같은 요소를 누른다(검사·클릭 대상 일치). */
  let ownPick = null;
  /** 행동 하나 동안 앱이 띄운 팝업 글자 — 결과 문장 끝에 붙인다(관찰·판정 근거가 된다). */
  const popupNote = () => (dialogMessages.length ? ` | app popup: "${dialogMessages.join(" / ")}"` : "");

  return {
    async start(_targetUrl) {
      await openContext(null);
    },
    async goto(url) {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      return { status: resp ? resp.status() : null, url: page.url() };
    },
    url: () => page.url(),
    signature: () => stateSignature(),
    html: () => page.content(),
    /** B5: 서버가 보낸 원본 HTML(렌더 뒤 DOM이 아니라). */
    async fetchSource(url) {
      const r = await context.request.get(url, { timeout: NAV_TIMEOUT }).catch(() => null);
      return r && r.ok() ? r.text() : null;
    },
    /** B5: 고친 파일로 바꿔 끼우고 새 브라우저로 연다(저장소 초기화 — 검증은 깨끗한 상태에서). */
    async serveOverride(url, html) {
      override = html ? { url, html } : null;
      await openContext(null);
    },
    bodyText,
    crashCount: () => crashes,
    async observe() {
      const aria = await page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "");
      const hasPasswordField = (await page.locator("input[type=password]").count().catch(() => 0)) > 0;
      // (v2 S4d F2) 라벨 없는 입력칸은 접근성 트리에 "- spinbutton"뿐이라 모델이 대상을 못 짚는다 — placeholder를 따로 싣는다.
      const fields = await page
        .evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll("input, textarea")) {
            const type = (el.getAttribute("type") ?? "text").toLowerCase();
            if (["hidden", "submit", "button", "checkbox", "radio", "file", "image", "reset", "password"].includes(type)) continue;
            const ph = el.getAttribute("placeholder")?.trim();
            const named = (el.labels && el.labels.length > 0) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title");
            if (!ph || named || el.getClientRects().length === 0) continue;
            const role = type === "number" ? "spinbutton" : type === "search" ? "searchbox" : "textbox";
            out.push(`${role} placeholder="${ph.slice(0, 60)}"`);
            if (out.length >= 10) break;
          }
          return out;
        })
        .catch(() => []);
      return {
        url: page.url(),
        title: await page.title().catch(() => ""),
        aria,
        text: (await bodyText()).slice(0, 6000),
        networkErrors: networkErrors.slice(-10),
        consoleErrors: consoleErrors.slice(-10),
        hasPasswordField,
        fields,
      };
    },
    /** 검증된 행동 하나(안전 판정은 agent-run이 이미 했다). 결과 문장은 기록·LLM에 들어가므로 값을 싣지 않는다. */
    async act(action) {
      try {
        switch (action.type) {
          case "click": {
            // (§8 c-1) 허용된 내 기록 취소는 표지를 검사한 바로 그 요소만 누른다 — 첫 일치로 되돌아가지 않는다.
            const pick = ownPick;
            ownPick = null;
            if (action.acceptDialog === true && !(pick && pick.key === JSON.stringify(action.target))) return { ok: false, note: "own_record_target_lost" };
            const resolved = action.acceptDialog === true ? { el: pick.el, diag: "own_record" } : await resolveTargetDiag(action.target);
            const l = resolved.el;
            if (!l) return { ok: false, note: "target_not_found" };
            dialogPolicy = action.acceptDialog === true ? "accept" : "dismiss";
            dialogMessages.length = 0;
            try {
              await l.click({ timeout: ACT_TIMEOUT });
              await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
              await page.waitForTimeout(900);
            } finally {
              dialogPolicy = "dismiss";
            }
            // 같은 이름이 여럿이었으면 무엇을 눌렀는지 남긴다(§8 후속: claude는 "예약하기"가 nav 탭·제출 버튼 2개였다).
            const which = /matched=([2-9]|\d{2,})/.test(resolved.diag) ? ` [${resolved.diag}]` : "";
            return { ok: true, note: `clicked → ${page.url()}${which}${popupNote()}`, ...(dialogMessages.length ? { dialog: [...dialogMessages] } : {}) };
          }
          case "fill": {
            const { el: l, diag } = await resolveTargetDiag(action.target, true);
            if (!l) return { ok: false, note: `target_not_found (${diag})` };
            const type = await l.getAttribute("type").catch(() => null);
            if (type === "password") return { ok: false, note: "password_field_use_login_action" };
            let how = "fill";
            try {
              await l.fill(action.value, { timeout: ACT_TIMEOUT });
            } catch (err) {
              // fill이 막히면(가려진 오버레이·재렌더) 사람처럼 눌러서 친다.
              how = `fill_failed(${String(err?.message ?? err).split("\n")[0].slice(0, 60)}) → type`;
              await l.click({ timeout: 4000, force: true }).catch(() => {});
              await page.keyboard.type(action.value, { delay: 30 });
            }
            // 화면 재그리기(하이드레이션 불일치 등)로 값이 날아가는 앱이 있다 — 확인하고 사람처럼 한 글자씩 다시 친다.
            if ((await l.inputValue().catch(() => action.value)) !== action.value) {
              how += " → retype";
              await l.click({ timeout: ACT_TIMEOUT }).catch(() => {});
              await l.fill("").catch(() => {});
              await page.keyboard.type(action.value, { delay: 30 });
            }
            const got = await l.inputValue().catch(() => null);
            // 계측: 어떤 칸을 골랐는지·어떻게 넣었는지·결과값이 같은지(값 자체는 시험 데이터라 그대로 둔다 — 비밀은 상위에서 가린다).
            const trace = `${diag}; ${how}; value_ok=${got === null ? "unknown" : got === action.value}`;
            return got === null || got === action.value ? { ok: true, note: `filled (${trace})` } : { ok: false, note: `value did not stick (${trace})` };
          }
          case "select": {
            const l = await resolveTarget(action.target);
            if (!l) return { ok: false, note: "target_not_found" };
            await l.selectOption({ label: action.value }).catch(() => l.selectOption(action.value));
            await page.waitForTimeout(400);
            return { ok: true, note: "selected" };
          }
          case "press":
            dialogMessages.length = 0;
            await page.keyboard.press(action.key === "Space" ? " " : action.key);
            await page.waitForTimeout(700);
            return { ok: true, note: `pressed${popupNote()}`, ...(dialogMessages.length ? { dialog: [...dialogMessages] } : {}) };
          case "goto": {
            const r = await this.goto(action.path);
            return { ok: true, note: `opened (HTTP ${r.status ?? "?"})` };
          }
          case "reload":
            await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
            await page.waitForTimeout(1200);
            return { ok: true, note: "reloaded" };
          case "back":
            await page.goBack({ timeout: NAV_TIMEOUT }).catch(() => null);
            await page.waitForTimeout(800);
            return { ok: true, note: `back → ${page.url()}` };
          case "wait":
            await page.waitForTimeout(action.ms);
            return { ok: true, note: "waited" };
          default:
            return { ok: false, note: "unsupported_in_driver" };
        }
      } catch (err) {
        return { ok: false, note: String(err?.message ?? err).split("\n")[0].slice(0, 160) };
      }
    },
    /** 다른 손님/다른 기기: 쿠키·저장소 없는 새 브라우저(로그인 상태 포함 — 필요하면 agent가 다시 login). */
    async newSession(url, storageState = null) {
      await openContext(storageState);
      return this.goto(url);
    },
    /**
     * C10: 휴대폰 폭(390×844)에서 그 화면을 열어 가로 넘침(px)을 잰다. 같은 쿠키·저장소의 별도 탭 — 진행 중 화면은 그대로.
     */
    async mobileCheck(url) {
      const p = await context.newPage();
      try {
        await p.setViewportSize({ width: 390, height: 844 });
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        await p.waitForTimeout(500);
        const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        return { url, overflowPx: Math.max(0, m.sw - m.cw) };
      } catch {
        return { url, overflowPx: null };
      } finally {
        await p.close().catch(() => {});
      }
    },
    /** A2: 기준 시작 시점 표시 — 이후의 서버 쓰기 요청·브라우저 저장소 변화를 잰다. */
    async markStorage() {
      const s = await readStorage();
      storageMark = { at: Date.now(), ...s };
    },
    async storageProbe() {
      const now = await readStorage();
      return {
        serverWrites: writes.filter((w) => w.at >= storageMark.at).map((w) => w.line),
        localChanged: now.local !== storageMark.local,
        sessionChanged: now.session !== storageMark.session,
      };
    },
    /** (v2 S4a) 표시 이후 쓰기 요청의 응답 코드 — 증거물 request에 status로 붙는다. */
    async writeResults() {
      return writeResults.filter((w) => w.at >= storageMark.at).map((w) => ({ line: w.line, status: w.status }));
    },
    /** 직접 로그인 뒤의 브라우저 상태(쿠키·저장소) — 이 프로세스 메모리에만, 이 런 동안만 쓴다. */
    async captureState() {
      return context.storageState();
    },
    async setClock(iso) {
      await context.clock.install({ time: new Date(iso) }).catch(async () => {
        await page.clock.setSystemTime(new Date(iso));
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(1000);
      return { ok: true, note: "clock set" };
    },
    /** 시험 계정 로그인. 성공 = 비밀번호 칸이 사라졌거나 주소가 바뀌고 오류 문구가 없음. */
    async login({ username, password, loginUrl }) {
      try {
        if (loginUrl) await this.goto(loginUrl);
        let pass = page.locator("input[type=password]").first();
        if ((await pass.count()) === 0) {
          const entry = await locateByName(locale === "en" ? "Log in" : "로그인");
          if (entry) {
            await entry.click().catch(() => {});
            await page.waitForTimeout(1200);
          }
          pass = page.locator("input[type=password]").first();
          if ((await pass.count()) === 0) return { ok: false, reason: "no_login_form" };
        }
        const userSel =
          "input[type=email], input[autocomplete=username], input[name*=user i], input[name*=email i], input[name*=login i], input[id*=user i], input[id*=email i], input[type=text], input[type=tel]";
        const user = page.locator(userSel).first();
        if ((await user.count()) === 0) return { ok: false, reason: "no_username_field" };
        maskSelectors.add(userSel);
        const before = page.url();
        await user.fill(username);
        await pass.fill(password);
        const submit = page.getByRole("button", { name: /로그인|log ?in|sign ?in|continue|계속/i }).first();
        if ((await submit.count()) > 0) await submit.click().catch(() => pass.press("Enter"));
        else await pass.press("Enter");
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const stillPassword = (await page.locator("input[type=password]").count()) > 0;
        const text = await bodyText();
        const errorText = /(잘못|일치하지|올바르지|invalid|incorrect|wrong password|failed)/i.test(text);
        if ((!stillPassword || page.url() !== before) && !errorText) return { ok: true };
        return { ok: false, reason: "login_failed" };
      } catch {
        return { ok: false, reason: "login_failed" };
      }
    },
    async signup(opts) {
      if (!attemptSignup) return { ok: false, blocker: "unsupported" };
      return attemptSignup({ page, ...opts });
    },
    async screenshot(name) {
      const p = join(shotsDir, name);
      try {
        await page.screenshot({ path: p, fullPage: false, mask: [...maskSelectors].map((s) => page.locator(s)) });
        return { name: `screenshots/${name}`, path: p };
      } catch {
        return null;
      }
    },
    async links() {
      return page
        .$$eval("a[href], [role=link][href], nav a", (els) =>
          els.slice(0, 300).map((e) => ({ href: e.getAttribute("href") || "", text: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 80) })),
        )
        .catch(() => []);
    },
    async buttons() {
      return page
        .$$eval("button, [role=button], input[type=submit], input[type=button]", (els) =>
          els
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.disabled;
            })
            .slice(0, 120)
            .map((el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")),
        )
        .catch(() => []);
    },
    /** 버튼 한 번 누르고 반응 측정. 화면을 떠났으면 그 화면으로 돌아온다. */
    async probeButton(label, screenUrl) {
      const crashBefore = crashes;
      const net5xxBefore = net5xx;
      const urlBefore = page.url();
      const sigBefore = await stateSignature();
      dialogSeen = false;
      try {
        let l = page.getByRole("button", { name: label, exact: true }).first();
        if ((await l.count()) === 0) l = page.getByText(label, { exact: true }).first();
        if ((await l.count()) === 0) return { outcome: "no_reaction", detail: "not_found_again" };
        await l.click({ timeout: 5000 });
      } catch (err) {
        return { outcome: "no_reaction", detail: `click_failed: ${String(err?.message ?? err).split("\n")[0].slice(0, 80)}` };
      }
      await page.waitForTimeout(900);
      let outcome = "ok";
      let detail;
      if (crashes > crashBefore) {
        outcome = "error";
        detail = consoleErrors[consoleErrors.length - 1];
      } else if (net5xx > net5xxBefore) {
        outcome = "error";
        detail = networkErrors[networkErrors.length - 1];
      } else if (page.url() === urlBefore && !dialogSeen && (await stateSignature()) === sigBefore) {
        outcome = "no_reaction";
      }
      if (page.url() !== screenUrl) await this.goto(screenUrl).catch(() => {});
      return detail ? { outcome, detail } : { outcome };
    },
    /** 이 화면에 우리가 만든 기록(시험 데이터 표지)이 그 대상 근처에 있는가 — 내 기록만 취소·삭제 허용. */
    async ownsRecordNear(target, markers) {
      try {
        const el = await pickOwnRecord(target, markers);
        ownPick = el ? { key: JSON.stringify(target), el } : null;
        return Boolean(el);
      } catch {
        ownPick = null;
        return false;
      }
    },
    // ── 직접 로그인 라이브 화면 ──
    async liveFrame() {
      return page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
    },
    async liveInput(input) {
      if (input.kind === "click" && typeof input.x === "number" && typeof input.y === "number") await page.mouse.click(input.x, input.y);
      else if (input.kind === "type" && typeof input.text === "string") await page.keyboard.type(input.text, { delay: 20 });
      else if (input.kind === "key" && input.key) await page.keyboard.press(input.key);
      else if (input.kind === "scroll") await page.mouse.wheel(0, input.deltaY ?? 400);
      await page.waitForTimeout(250);
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}
