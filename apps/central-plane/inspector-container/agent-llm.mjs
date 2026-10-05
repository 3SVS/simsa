/**
 * agent-llm.mjs — agent 엔진의 판단 호출. 컨테이너는 LLM 키를 모른다: Worker의 /internal/inspect-llm/v1/messages에
 * 런 범위 토큰(irt1)으로 묻는다. 예산 소진(402)은 "budget_exhausted"로 던져 실행기가 남은 AC를 정직하게
 * "시간·횟수 한도"로 닫게 한다. 5xx·네트워크 오류는 한 번만 다시 한다(Worker가 이미 벤더 폴백·재시도를 한다).
 */
export function createProxyLlm({ url, token, fetchImpl = fetch }) {
  return async function llm({ system, user, maxTokens = 700 }) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let r;
      try {
        r = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ system, user, maxTokens }),
          signal: AbortSignal.timeout(100_000),
        });
      } catch (err) {
        lastErr = err;
        continue;
      }
      if (r.status === 402) throw new Error("budget_exhausted");
      const body = await r.json().catch(() => null);
      if (r.ok && body && typeof body.text === "string") return body.text;
      lastErr = new Error(`inspect_llm_${r.status}:${body?.error ?? "unknown"}`);
      if (r.status < 500) break;
    }
    throw lastErr ?? new Error("inspect_llm_failed");
  };
}
