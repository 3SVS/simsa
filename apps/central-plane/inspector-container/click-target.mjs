/**
 * click-target.mjs — 글자로 고른 CTA를 **누를 수 있는 요소**에서 먼저 찾는다 (2026-10-04, H5).
 *
 * 파일럿 Claude 앱('돌아가나'): 단계 제목 "3 점검 시작"과 버튼 "점검 시작"이 같은 글자였다. 종전
 * `getByText(text, { exact: true }).first()`는 문서 순서상 먼저인 **제목**을 눌렀고, 아무 일도 일어나지 않아
 * "동작 후 화면에 아무 변화가 없음"으로 오판했다. 버튼 → 링크 순으로 접근성 이름이 정확히 같은 보이는
 * 요소를 먼저 누르고, 없을 때만 종전대로 글자로 찾는다(기존 동작 보존).
 */

/** @param {import("playwright").Locator} loc */
async function firstVisible(loc) {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 5); i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
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
