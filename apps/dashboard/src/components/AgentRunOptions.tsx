"use client";

/**
 * AgentRunOptions + LiveLoginPanel — agent 엔진 검수 요청 옵션(지금은 스태프 티어에만 보인다, 2026-10-05).
 *
 * 로그인 세 갈래:
 *   - 로그인 없이 · 공개 화면만
 *   - 시험 계정 주기 — 아이디·비밀번호(+로그인 주소). **동의 체크 없이는 보낼 수 없다.** 서버가 암호화해 이번
 *     확인에만 쓰고 끝나면 지운다.
 *   - 직접 로그인해서 넘겨주기 — 카카오·구글·문자 인증처럼 대신 못 하는 로그인. 확인이 시작되면 아래 라이브 화면에서
 *     사용자가 직접 로그인하고 "로그인 끝났어요"를 누른다.
 * 서버가 동의·티어·같은 출처를 다시 확인한다(UI는 편의일 뿐 게이트가 아니다).
 */
import { useEffect, useRef, useState } from "react";
import { CENTRAL_PLANE_URL } from "@/lib/workspace-visual-checks-api";

export type AgentLoginMode = "none" | "credentials" | "handover";
export type AgentRunOptionsValue = {
  loginMode: AgentLoginMode;
  username: string;
  password: string;
  loginUrl: string;
  consent: boolean;
};

export const DEFAULT_AGENT_OPTIONS: AgentRunOptionsValue = { loginMode: "none", username: "", password: "", loginUrl: "", consent: false };

export const AGENT_COPY = {
  ko: {
    title: "기준대로 직접 해 보기 (스태프 시험)",
    desc: "확인한 기준을 하나씩 실제로 해 보고, 모든 화면과 버튼도 한 번씩 점검해요.",
    modes: { none: "로그인 없이 공개 화면만", credentials: "시험 계정 주기", handover: "직접 로그인해서 넘겨주기 (카카오·구글·문자 인증)" },
    username: "아이디(이메일)",
    password: "비밀번호",
    loginUrl: "로그인 주소 (선택, 같은 사이트만)",
    consentCredentials:
      "이 시험 계정으로 Simsa가 제 앱에 로그인해 확인하는 데 동의해요. 계정은 암호화해 이번 확인에만 쓰고, 확인이 끝나면 바로 지워요. 실제 계정이 아닌 시험용 계정을 주세요.",
    consentHandover:
      "제가 직접 로그인한 화면을 이번 확인에 넘겨주는 데 동의해요. 로그인 상태는 이번 확인에만 쓰고 끝나면 버려요. 입력한 글자는 저장하지 않아요.",
    needConsent: "동의해 주셔야 로그인해서 확인할 수 있어요.",
  },
  en: {
    title: "Try each criterion for real (staff trial)",
    desc: "We actually perform each confirmed criterion, and press every screen and button once.",
    modes: { none: "No sign-in — public screens only", credentials: "Give a test account", handover: "Sign in myself and hand it over (Kakao/Google/SMS)" },
    username: "ID (email)",
    password: "Password",
    loginUrl: "Sign-in address (optional, same site only)",
    consentCredentials:
      "I agree that Simsa signs in to my app with this test account to check it. It is stored encrypted, used for this check only, and deleted as soon as the check ends. Please use a test account, not your real one.",
    consentHandover:
      "I agree to hand over the screen I signed in to myself for this check. The signed-in state is used for this check only and discarded afterwards. What I type is not stored.",
    needConsent: "Please agree first so we can sign in and check.",
  },
} as const;

/** 요청 본문·실행 가능 여부 — 순수 함수는 lib(테스트 고정). 동의가 없으면 로그인 갈래를 보내지 않는다. */
export { agentRunBody, agentOptionsReady } from "@/lib/agent-run-body.mjs";

export function AgentRunOptions({ value, onChange, locale }: { value: AgentRunOptionsValue; onChange: (v: AgentRunOptionsValue) => void; locale: "ko" | "en" }) {
  const c = AGENT_COPY[locale === "en" ? "en" : "ko"];
  const set = (patch: Partial<AgentRunOptionsValue>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="mt-4 space-y-2 rounded border border-gray-200 p-3" data-testid="agent-run-options">
      <legend className="px-1 text-xs font-medium text-gray-600">{c.title}</legend>
      <p className="text-xs text-gray-500">{c.desc}</p>
      {(Object.keys(c.modes) as AgentLoginMode[]).map((m) => (
        <label key={m} className="flex items-center gap-2 text-sm text-gray-700">
          <input type="radio" name="agent-login-mode" checked={value.loginMode === m} onChange={() => set({ loginMode: m, consent: false })} />
          {c.modes[m]}
        </label>
      ))}
      {value.loginMode === "credentials" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" autoComplete="off" placeholder={c.username} value={value.username} onChange={(e) => set({ username: e.target.value })} />
          <input className="input" type="password" autoComplete="new-password" placeholder={c.password} value={value.password} onChange={(e) => set({ password: e.target.value })} />
          <input className="input sm:col-span-2" placeholder={c.loginUrl} value={value.loginUrl} onChange={(e) => set({ loginUrl: e.target.value })} />
        </div>
      )}
      {value.loginMode !== "none" && (
        <label className="flex items-start gap-2 text-xs leading-relaxed text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={value.consent} onChange={(e) => set({ consent: e.target.checked })} />
          {value.loginMode === "credentials" ? c.consentCredentials : c.consentHandover}
        </label>
      )}
      {value.loginMode !== "none" && !value.consent && <p className="text-xs text-gray-500">{c.needConsent}</p>}
    </fieldset>
  );
}

const LIVE_COPY = {
  ko: {
    title: "직접 로그인해 주세요",
    desc: "아래는 검사용 브라우저 화면이에요. 화면을 눌러 로그인 버튼을 고르고, 글자는 아래 칸에 써서 보내세요. 다 되면 '로그인 끝났어요'를 눌러 주세요.",
    waiting: "검사용 브라우저를 준비하고 있어요…",
    typePlaceholder: "보낼 글자 (비밀번호도 저장하지 않아요)",
    send: "보내기",
    done: "로그인 끝났어요",
    finished: "넘겨받았어요. 이제 기준대로 확인을 시작해요.",
  },
  en: {
    title: "Please sign in yourself",
    desc: "Below is the checking browser. Click the screen to pick the sign-in button, and type into the box below to send text. When you're in, press 'I'm signed in'.",
    waiting: "Preparing the checking browser…",
    typePlaceholder: "Text to send (passwords are not stored)",
    send: "Send",
    done: "I'm signed in",
    finished: "Got it. We're starting the check now.",
  },
} as const;

/** 라이브 화면: 1초마다 화면, 클릭은 1280×800 좌표로 바꿔 보낸다. 입력 글자는 화면 상태에 남기지 않는다. */
export function LiveLoginPanel({ projectId, runId, token, userKey, locale }: { projectId: string; runId: string; token: string; userKey: string; locale: "ko" | "en" }) {
  const c = LIVE_COPY[locale === "en" ? "en" : "ko"];
  const [state, setState] = useState<string>("starting");
  const [tick, setTick] = useState(0);
  const [text, setText] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const base = `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/live`;
  const q = `userKey=${encodeURIComponent(userKey)}&token=${encodeURIComponent(token)}`;

  useEffect(() => {
    if (state === "running" || state === "finished") return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${base}/state?${q}`, { cache: "no-store" });
        const b = (await r.json().catch(() => null)) as { state?: string } | null;
        if (b?.state) setState(b.state);
      } catch {
        /* 다음 주기에 다시 */
      }
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [base, q, state]);

  const send = async (path: "input" | "done", body: Record<string, unknown>) => {
    await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userKey, token, ...body }) }).catch(() => undefined);
  };

  if (state === "running" || state === "finished") {
    return <p className="card p-3 text-sm text-gray-700">{c.finished}</p>;
  }
  return (
    <section className="card space-y-3 p-4" data-testid="live-login-panel">
      <h3 className="section-title">{c.title}</h3>
      <p className="text-xs leading-relaxed text-gray-500">{c.desc}</p>
      {state === "awaiting_login" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          alt=""
          className="w-full cursor-pointer rounded border border-gray-200"
          src={`${base}/frame?${q}&n=${tick}`}
          onClick={(e) => {
            const rect = imgRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = Math.round(((e.clientX - rect.left) / rect.width) * 1280);
            const y = Math.round(((e.clientY - rect.top) / rect.height) * 800);
            void send("input", { kind: "click", x, y });
          }}
        />
      ) : (
        <p className="text-xs text-gray-500">{c.waiting}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <input className="input flex-1" type="password" autoComplete="off" placeholder={c.typePlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const v = text;
            setText("");
            if (v) void send("input", { kind: "type", text: v });
          }}
        >
          {c.send}
        </button>
        {(["Enter", "Tab", "Backspace"] as const).map((k) => (
          <button key={k} type="button" className="btn-secondary" onClick={() => void send("input", { kind: "key", key: k })}>
            {k}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={async () => {
          await send("done", {});
          setState("finished");
        }}
      >
        {c.done}
      </button>
    </section>
  );
}
