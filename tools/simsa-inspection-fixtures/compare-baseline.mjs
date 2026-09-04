/**
 * compare-baseline.mjs — 이번 실행을 7월 기준선과 대조한다.
 *
 * 왜: 폴백 이후 **판정하는 모델이 Anthropic Haiku → OpenAI로 바뀌었다.** 검수의
 * 핵심 가치는 "제대로 판정하는가"인데 그 판정자가 조용히 교체됐고 다시 재지 않았다.
 * 7월 숫자는 지금 시스템에 대한 증거가 아니다.
 *
 * 기준선은 7월 파일들에서 **픽스처별 가장 최근 결과**를 모아 만든다(부분 실행이 많음).
 * Usage: node compare-baseline.mjs [새결과파일]
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(DIR).filter((f) => f.startsWith("eval-results-") && f.endsWith(".json"));
const newest = process.argv[2] ?? files.map((f) => join(DIR, f)).sort().pop();

const july = new Map();
for (const f of files.filter((f) => f.includes("2026-07")).sort()) {
  const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  for (const r of j.results ?? []) july.set(r.id, { ...r, from: f.replace("eval-results-", "").replace(".json", "") });
}

const now = JSON.parse(readFileSync(newest, "utf8"));
const label = (r) => (r ? `${r.works === true ? "작동" : r.works === false ? "고장" : "판단보류"}(${r.score ?? "-"})` : "—");
/**
 * ★"못 쟀다"와 "틀렸다"를 절대 뭉뜽그리지 않는다 (증거 규칙 R2·R3).
 * 첫 판(2026-08-24)에서 이 도구가 컨테이너 상한으로 인한 no-result를 **퇴행**으로
 * 셌다 — 측정 실패를 품질 저하로 보고할 뻔했다. 도구가 규칙을 어기면 결과가 거짓말이 된다.
 * @returns {true|false|null} null = 측정 안 됨(판정 불가)
 */
const correct = (r) => {
  if (!r) return null;
  if (r.score === "no-result" || r.works === undefined) return null;
  if (r.expected === "working") return r.works === true || (r.nullOk && r.works === null);
  return r.works === false;
};

console.log(`기준선: 7월 (판정자 = Anthropic Haiku)\n이번:   ${now.date ?? "?"} (판정자 = OpenAI gpt-5.4 폴백)\n`);
console.log("픽스처  정답     7월                지금               변화");
let okNow = 0, okJuly = 0, n = 0;
for (const r of now.results ?? []) {
  const j = july.get(r.id);
  const cN = correct(r), cJ = correct(j);
  if (cN !== null) { n++; if (cN) okNow++; }
  if (cJ === true) okJuly++;
  const change =
    cN === null || cJ === null ? "— 측정불가" : cJ === cN ? (cN ? "유지 ✅" : "유지 ❌") : cN ? "개선 ⬆" : "★퇴행 ⬇";
  console.log(
    `${r.id.padEnd(6)} ${String(r.expected).padEnd(8)} ${label(j).padEnd(18)} ${label(r).padEnd(18)} ${change}`,
  );
}
console.log(`\n정답률: 7월 ${okJuly}/${n} → 지금 ${okNow}/${n}`);
const regressions = (now.results ?? []).filter((r) => correct(july.get(r.id)) === true && correct(r) === false);
if (regressions.length) {
  console.log(`\n★퇴행 ${regressions.length}건 — 모델 교체로 판정 품질이 떨어진 지점:`);
  for (const r of regressions) console.log(`  ${r.id}: 기대 ${r.expected} / 판정 ${r.verdict ?? r.decision} :: ${(r.oneLine ?? "").slice(0, 80)}`);
}
