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
  const writes = [];
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
    });
    // A2 탐침: 앱이 서버로 보낸 쓰기 요청(데이터 요청 중 GET이 아닌 것) — 시각과 함께.
    p.on("request", (r) => {
      const t = r.resourceType();
      if ((t === "xhr" || t === "fetch") && r.method() !== "GET" && r.method() !== "OPTIONS" && !isNoiseResource(r.url())) {
        writes.push({ at: Date.now(), line: `${r.method()} ${r.url().slice(0, 140)}` });
      }
    });
    p.on("dialog", (d) => {
      dialogSeen = true;
      d.dismiss().catch(() => {});
    });
    p.setDefaultTimeout(ACT_TIMEOUT);
  }

  async function openContext(storageState) {
    if (context) await context.close().catch(() => {});
    context = await browser.newContext({ ...ctxOpts, ...(storageState ? { storageState } : {}) });
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
    let tag = "";
    for (let i = 0; i < Math.min(count, 20); i += 1) {
      const el = all.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      visible += 1;
      if (chosen) continue;
      if (editable && !(await el.isEditable().catch(() => false))) continue;
      chosen = el;
      tag = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => "?");
    }
    return { el: chosen, diag: `matched=${count} visible=${visible} chosen=${chosen ? tag : "none"}` };
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

  const bodyText = async () => (await page.locator("body").innerText({ timeout: 4000 }).catch(() => "")).replace(/\s+\n/g, "\n").trim();
  const textHash = async () => {
    const t = await bodyText();
    let h = 0;
    for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
    return `${t.length}:${h}`;
  };

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
    html: () => page.content(),
    bodyText,
    crashCount: () => crashes,
    async observe() {
      const aria = await page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "");
      const hasPasswordField = (await page.locator("input[type=password]").count().catch(() => 0)) > 0;
      return {
        url: page.url(),
        title: await page.title().catch(() => ""),
        aria,
        text: (await bodyText()).slice(0, 6000),
        networkErrors: networkErrors.slice(-10),
        consoleErrors: consoleErrors.slice(-10),
        hasPasswordField,
      };
    },
    /** 검증된 행동 하나(안전 판정은 agent-run이 이미 했다). 결과 문장은 기록·LLM에 들어가므로 값을 싣지 않는다. */
    async act(action) {
      try {
        switch (action.type) {
          case "click": {
            const l = await resolveTarget(action.target);
            if (!l) return { ok: false, note: "target_not_found" };
            await l.click({ timeout: ACT_TIMEOUT });
            await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(900);
            return { ok: true, note: `clicked → ${page.url()}` };
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
            await page.keyboard.press(action.key === "Space" ? " " : action.key);
            await page.waitForTimeout(700);
            return { ok: true, note: "pressed" };
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
      const hashBefore = await textHash();
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
      } else if (page.url() === urlBefore && !dialogSeen && (await textHash()) === hashBefore) {
        outcome = "no_reaction";
      }
      if (page.url() !== screenUrl) await this.goto(screenUrl).catch(() => {});
      return detail ? { outcome, detail } : { outcome };
    },
    /** 이 화면에 우리가 만든 기록(시험 데이터 표지)이 그 대상 근처에 있는가 — 내 기록만 취소·삭제 허용. */
    async ownsRecordNear(target, markers) {
      try {
        const l = await resolveTarget(target);
        if (!l) return false;
        const near = await l.evaluate((el) => {
          const box = el.closest("li, tr, article, section, [role=listitem], [role=row], div");
          return box ? box.textContent || "" : "";
        });
        return markers.some((m) => m && near.includes(m));
      } catch {
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
