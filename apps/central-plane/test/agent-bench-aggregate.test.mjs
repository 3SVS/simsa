/**
 * H4: 벤치 하네스 --repeat — 런별 지표와 여러 런의 평균·최소·최대. 하네스는 tools/에 있고 Playwright 라이브러리를
 * 읽으므로(spike 폴더), 없으면 건너뛴다(= 미측정).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, "..", "..", "..", "tools");
const skip = existsSync(join(tools, "simsa-completion-loop-spike", "node_modules", "playwright")) ? false : "playwright(spike) 없음 — 미측정";

describe("벤치 하네스 집계", { skip }, () => {
  it("런 지표 → 평균·최소·최대", async () => {
    const { summarize, aggregate } = await import(pathToFileURL(join(tools, "simsa-inspection-fixtures", "agent-bench1.mjs")).href);
    const apps = [{ id: "a", mustFailed: ["A1", "A2"] }, { id: "b", mustFailed: [] }];
    const r1 = summarize(apps, [
      { app: "a", decision: "Needs Fix", match: true, opposite: false, mustIdentified: ["A1"], costUsd: 0.3 },
      { app: "b", decision: "Ready", match: true, opposite: false, mustIdentified: [], costUsd: 0.2 },
    ]);
    assert.deepEqual(r1, { oppositeErrors: 0, appMatch: 2, apps: 2, mustIdentified: 1, mustTotal: 2, costPerRunMean: 0.25, costPerRunMax: 0.3, errors: 0 });
    const r2 = { ...r1, mustIdentified: 2, costPerRunMean: 0.35, appMatch: 1 };
    const agg = aggregate([r1, r2]);
    assert.deepEqual(agg.mustIdentified, { mean: 1.5, min: 1, max: 2 });
    assert.deepEqual(agg.appMatch, { mean: 1.5, min: 1, max: 2 });
    assert.equal(agg.runs, 2);
  });
});
