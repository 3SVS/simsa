// D-24.2 — 장비 키. 무료·베이직 새 프로젝트는 하루 1개(같은 네트워크 익명 1개)라, 매 실행
// 새 프로젝트를 만드는 스모크·여정 감사·프로브는 같은 날 두 번째부터 막힌다.
// 운영자가 POST /admin/plan-grants { userKey, action:"grant", plan:"staff" }로 지정한 키를
// SIMSA_STAFF_USER_KEY로 넘기면 장비가 그 키로 움직인다(서비스 비용 천장은 그대로).
// 미설정이면 종전대로 실행마다 새 키 — 하루 첫 실행만 통과한다.

/** @returns {string | null} */
export function staffUserKey() {
  const k = (process.env.SIMSA_STAFF_USER_KEY ?? "").trim();
  return k || null;
}

/** 브라우저 컨텍스트가 앱보다 먼저 장비 키를 심는다(대시보드 getUserKey의 저장 키). */
export async function seedStaffKey(ctx) {
  const key = staffUserKey();
  if (!key) return;
  await ctx.addInitScript((k) => {
    try { window.localStorage.setItem("conclave_user_key", k); } catch {}
  }, key);
}
