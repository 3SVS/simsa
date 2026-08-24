"use client";

/**
 * StackProfileRows — "어디에 올렸나 / 어디에 저장하나" 두 축 (스택 불가지 D-1).
 *
 * ## 왜 옮겨졌나 (AF-1, 2026-08-23)
 *
 * 이 두 질문은 새 프로젝트 첫 화면에만 있었다. 제출물-우선 진입(설계 D-1)으로 첫
 * 화면이 칸 하나가 되면서, 여기 머물렀다면 **질문이 통째로 사라졌을 것**이다 —
 * 그러면 빌더팩·MCP 안내가 사용자의 조합을 못 따라가 스택 불가지 작업이 회귀한다.
 *
 * 설계 D-7은 "삭제가 아니라 **이동**"이다. 그래서 컴포넌트로 빼서 두 곳이 같은 것을
 * 쓴다: 새 프로젝트 화면(아이디어 갈래)과 프로젝트 설정(언제든 고칠 수 있는 거처).
 *
 * 답은 여전히 **선택**이다. 비우면 안내가 중립을 유지한다(미응답=중립).
 */
import type { Dictionary } from "@/i18n/dictionary.mjs";

export function InterviewChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<[string, string]>;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <p className="mb-1 text-xs text-gray-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            // 같은 칩을 다시 누르면 해제 — 잘못 고른 답에 갇히지 않는다.
            onClick={() => onChange(value === key ? null : key)}
            aria-pressed={value === key}
            className={`rounded-full border px-3 py-1 text-xs transition-all ${
              value === key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-brand-300"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StackProfileRows({
  t,
  hostingId,
  setHostingId,
  hostingOther,
  setHostingOther,
  dataId,
  setDataId,
  dataOther,
  setDataOther,
}: {
  t: Dictionary;
  hostingId: string | null;
  setHostingId: (v: string | null) => void;
  hostingOther: string;
  setHostingOther: (v: string) => void;
  dataId: string | null;
  setDataId: (v: string | null) => void;
  dataOther: string;
  setDataOther: (v: string) => void;
}) {
  return (
    <>
      <InterviewChipRow
        label={t.np.stackHostingQ}
        options={[
          ["vercel", t.np.stackHostingVercel],
          ["netlify", t.np.stackHostingNetlify],
          ["builder_hosted", t.np.stackHostingBuilder],
          ["none_yet", t.np.stackHostingNone],
          ["unknown", t.np.stackHostingUnknown],
          ["other", t.np.stackHostingOther],
        ]}
        value={hostingId}
        onChange={setHostingId}
      />
      {hostingId === "other" && (
        <input
          type="text"
          value={hostingOther}
          onChange={(e) => setHostingOther(e.target.value)}
          placeholder={t.np.stackHostingOtherPlaceholder}
          className="input mb-2.5 text-sm"
        />
      )}
      <InterviewChipRow
        label={t.np.stackDataQ}
        options={[
          ["supabase", t.np.stackDataSupabase],
          ["firebase", t.np.stackDataFirebase],
          ["builder_managed", t.np.stackDataBuilder],
          ["none", t.np.stackDataNone],
          ["unknown", t.np.stackDataUnknown],
          ["other", t.np.stackDataOther],
        ]}
        value={dataId}
        onChange={setDataId}
      />
      {dataId === "other" && (
        <input
          type="text"
          value={dataOther}
          onChange={(e) => setDataOther(e.target.value)}
          placeholder={t.np.stackDataOtherPlaceholder}
          className="input mb-2.5 text-sm"
        />
      )}
    </>
  );
}
