/**
 * agent-run-body.mjs — agent 엔진 검수 요청 본문 (2026-10-05). 화면(AgentRunOptions)과 테스트가 같이 쓴다.
 *
 * 계약: 동의 체크가 없으면 로그인 갈래(시험 계정·직접 로그인)를 **보내지 않는다**. 시험 계정은 아이디 3자·비밀번호
 * 4자 이상일 때만. 서버도 같은 것을 다시 확인한다(consent_required · invalid_test_credentials).
 */

/** @param {{loginMode:"none"|"credentials"|"handover", username:string, password:string, loginUrl:string, consent:boolean}} v */
export function agentRunBody(v) {
  const base = { engine: "agent" };
  if (v.loginMode === "credentials" && v.consent && v.username && v.password) {
    const loginUrl = v.loginUrl.trim();
    return {
      ...base,
      loginMode: "credentials",
      testCredentials: { username: v.username, password: v.password, ...(loginUrl ? { loginUrl } : {}), consent: true },
    };
  }
  if (v.loginMode === "handover" && v.consent) return { ...base, loginMode: "handover", handoverConsent: true };
  return base;
}

/** 실행 버튼을 켤 수 있는가: 로그인 없음은 항상, 로그인 갈래는 동의 + (시험 계정이면) 값이 찼을 때. */
export function agentOptionsReady(v) {
  if (v.loginMode === "none") return true;
  if (!v.consent) return false;
  return v.loginMode === "handover" || (v.username.trim().length >= 3 && v.password.length >= 4);
}
