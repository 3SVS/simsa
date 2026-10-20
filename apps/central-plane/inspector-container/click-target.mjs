/**
 * click-target.mjs — 글자로 고른 CTA를 **누를 수 있는 요소**에서 먼저 찾는다 (2026-10-04, H5).
 *
 * 파일럿 Claude 앱('돌아가나'): 단계 제목 "3 점검 시작"과 버튼 "점검 시작"이 같은 글자였다. 종전
 * `getByText(text, { exact: true }).first()`는 문서 순서상 먼저인 **제목**을 눌렀고, 아무 일도 일어나지 않아
 * "동작 후 화면에 아무 변화가 없음"으로 오판했다. 버튼 → 링크 순으로 접근성 이름이 정확히 같은 보이는
 * 요소를 먼저 누르고, 없을 때만 종전대로 글자로 찾는다(기존 동작 보존).
 */

/**
 * (2026-10-21 §8 후속) 같은 이름의 보이는 컨트롤이 여럿일 때의 선호 점수. 벤치 #1 claude 앱은 "예약하기"가 상단 화면 전환 탭
 * (`nav`, aria-current=page, 문서 앞쪽)과 폼 제출 버튼(type=submit) 두 개였고, 첫 요소를 누르던 해석이 3런 내내 탭만 눌러
 * 제출에 한 번도 닿지 못했다. 점수: 제출 버튼·폼 안 +2, nav/header 안·aria-current -2. 동점이면 문서 순서(종전 동작).
 * agent-driver.mjs의 pickVisible도 이 점수를 쓴다(같은 결함, 같은 고침).
 * @param {import("playwright").Locator} el
 */
export async function controlPreference(el) {
  return el
    .evaluate((e) => {
      let s = 0;
      const type = (e.getAttribute("type") || "").toLowerCase();
      if (type === "submit" || e.closest("form")) s += 2;
      if (e.closest("nav, header, [role=navigation], [role=tablist]") || e.hasAttribute("aria-current")) s -= 2;
      return s;
    })
    .catch(() => 0);
}

/**
 * 보이는 일치 중 선호 점수가 가장 높은 것(동점이면 앞쪽). 하나뿐이면 그것.
 * @param {import("playwright").Locator} loc
 */
async function firstVisible(loc) {
  const n = await loc.count().catch(() => 0);
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(n, 5); i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const s = n > 1 ? await controlPreference(el) : 0;
    if (s > bestScore) {
      best = el;
      bestScore = s;
    }
  }
  return best;
}

/**
 * @param {import("playwright").Page} page
 * @param {string} text
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<"button" | "link" | "text">} 무엇으로 눌렀는지(로그용)
 */
export async function clickControlByText(page, text, opts = {}) {
  const timeout = opts.timeout ?? 8000;
  const button = await firstVisible(page.getByRole("button", { name: text, exact: true }));
  if (button) {
    await button.click({ timeout });
    return "button";
  }
  const link = await firstVisible(page.getByRole("link", { name: text, exact: true }));
  if (link) {
    await link.click({ timeout });
    return "link";
  }
  await page.getByText(text, { exact: true }).first().click({ timeout });
  return "text";
}
