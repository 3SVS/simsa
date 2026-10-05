/**
 * _agent-fakes.mjs — agent 엔진 테스트용 가짜 브라우저 드라이버·가짜 LLM (글롭에 안 잡히는 이름).
 *
 * 가짜 드라이버는 agent-driver.mjs와 **같은 인터페이스**다. 화면은 site[path] = { status, text, links, buttons,
 * password, buttonEffects } 로 묘사하고, 행동은 onAct(action, state)로 테스트가 앱 동작을 흉내 낸다
 * (예: 예약을 이 브라우저의 localStorage에만 저장 → new_session에서 사라짐).
 */
export function makeFakeDriver(site, { origin = "https://salon.example", onAct = () => null, loginOk = () => true } = {}) {
  const state = { path: "/", session: 1, store: {}, loggedIn: false, clicks: [], fills: [], screenshots: [], crashes: 0, closed: false, logins: [] };
  const page = () => site[state.path] ?? { status: 404, text: "404 Not Found", links: [], buttons: [] };
  const pathOf = (url) => {
    const u = new URL(url, origin);
    return u.pathname;
  };
  const view = () => {
    const p = page();
    return typeof p === "function" ? p(state) : p;
  };
  return {
    state,
    async start() {},
    async goto(url) {
      state.path = pathOf(url);
      const v = view();
      if (v.crashOnOpen) state.crashes += 1;
      return { status: v.status ?? 200, url: origin + state.path };
    },
    url: () => origin + state.path,
    async bodyText() {
      return view().text ?? "";
    },
    crashCount: () => state.crashes,
    async observe() {
      const v = view();
      return {
        url: origin + state.path,
        title: "fake",
        aria: v.aria ?? `- main: ${v.text ?? ""}`,
        text: v.text ?? "",
        networkErrors: v.networkErrors ?? [],
        consoleErrors: v.consoleErrors ?? [],
        hasPasswordField: Boolean(v.password),
      };
    },
    async act(action) {
      if (action.type === "fill") state.fills.push(action.value);
      if (action.type === "click") state.clicks.push(action.target.name ?? action.target.text);
      if (action.type === "goto") state.path = pathOf(action.path);
      if (action.type === "reload") {
        /* 같은 세션 저장소 유지 */
      }
      const r = onAct(action, state);
      return r ?? { ok: true, note: "ok" };
    },
    async newSession(url, storageState = null) {
      state.session += 1;
      state.store = storageState?.store ? { ...storageState.store } : {};
      state.loggedIn = Boolean(storageState?.loggedIn);
      return this.goto(url);
    },
    async markStorage() {
      state.mark = { store: JSON.stringify(state.store), writes: (state.serverWrites ?? []).length };
    },
    async storageProbe() {
      const writes = (state.serverWrites ?? []).slice(state.mark?.writes ?? 0);
      return { serverWrites: writes, localChanged: JSON.stringify(state.store) !== (state.mark?.store ?? "{}"), sessionChanged: false };
    },
    async captureState() {
      return { store: { ...state.store }, loggedIn: state.loggedIn };
    },
    async setClock(iso) {
      state.clock = iso;
      return { ok: true, note: "clock set" };
    },
    async login(creds) {
      state.logins.push(creds.username);
      const ok = loginOk(creds);
      state.loggedIn = ok;
      return ok ? { ok: true } : { ok: false, reason: "login_failed" };
    },
    async signup() {
      return { ok: false, blocker: "no_mail_domain" };
    },
    async screenshot(name) {
      state.screenshots.push(name);
      return { name: `screenshots/${name}`, path: `/tmp/${name}` };
    },
    async links() {
      return (view().links ?? []).map((href) => (typeof href === "string" ? { href, text: href } : href));
    },
    async buttons() {
      return view().buttons ?? [];
    },
    async probeButton(label) {
      const effect = (view().buttonEffects ?? {})[label] ?? "ok";
      state.clicks.push(`probe:${label}`);
      if (effect === "error") {
        state.crashes += 1;
        return { outcome: "error", detail: "Uncaught TypeError: x is undefined" };
      }
      return { outcome: effect };
    },
    async ownsRecordNear(_t, markers) {
      return markers.some((m) => JSON.stringify(state.store).includes(m));
    },
    async liveFrame() {
      return Buffer.from("jpeg");
    },
    async liveInput() {},
    async close() {
      state.closed = true;
    },
  };
}

/**
 * 가짜 LLM: AC id별 대본(행동 JSON 목록). 대본이 끝나면 not_verified 판정. 받은 모든 프롬프트를 prompts에 쌓는다
 * (비밀이 새지 않았는지 검사용). 첫 화면 AC 추정 요청엔 inferred를 돌려준다.
 */
export function makeScriptedLlm(scripts, { inferred = null, review = () => true } = {}) {
  const prompts = [];
  const cursor = new Map();
  const llm = async ({ system, user }) => {
    prompts.push(`${system}\n${user}`);
    if (/skeptical reviewer/i.test(user)) {
      const id = /Criterion ([A-Za-z0-9-]+) \(/.exec(user)?.[1] ?? "?";
      return JSON.stringify({ agree: review(id, user), why: "fake review" });
    }
    if (/write acceptance criteria/i.test(user) || /acceptance criteria/i.test(system)) {
      return JSON.stringify({ acs: inferred ?? [] });
    }
    const m = /Criterion ([A-Za-z0-9-]+) \(/.exec(user);
    const id = m?.[1] ?? "?";
    const list = scripts[id] ?? [];
    const i = cursor.get(id) ?? 0;
    cursor.set(id, i + 1);
    const next = list[i] ?? { type: "judge", verdict: "not_verified", reason: "대본 끝", evidenceQuote: "" };
    // "$NAME"은 실행기가 준 한국어 시험 데이터의 이름(진짜 모델이 하듯 프롬프트에서 읽는다).
    const name = /name=([^,\s]+),/.exec(user)?.[1] ?? "김서연";
    return JSON.stringify({ thought: "t", action: next }).split("$NAME").join(name);
  };
  return { llm, prompts };
}
