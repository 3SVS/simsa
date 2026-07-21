import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G11 (docs/simsa-gap-backlog-2026-07-18.md): 스냅샷 공유의 입구 검증 —
// userKey/제목 필수, 크기 캡(60KB) 초과 거부. 내용은 사용자의 것(검열 없음).

const { sanitizeSharePayload } = await import("../dist/routes/shares.js");

describe("sanitizeSharePayload — G11", () => {
  it("valid share → normalized {userKey, projectId, payloadJson}", () => {
    const out = sanitizeSharePayload({
      userKey: " u1 ",
      projectId: "p1",
      payload: { title: "동네 빵집 예약 앱", items: [{ t: "a" }] },
    });
    assert.equal(out.userKey, "u1");
    assert.equal(out.projectId, "p1");
    assert.ok(out.payloadJson.includes("동네 빵집"));
  });

  it("missing userKey or title → rejected", () => {
    assert.equal(sanitizeSharePayload({ payload: { title: "t" } }), null);
    assert.equal(sanitizeSharePayload({ userKey: "u", payload: { title: "  " } }), null);
    assert.equal(sanitizeSharePayload({ userKey: "u", payload: {} }), null);
    assert.equal(sanitizeSharePayload({ userKey: "u" }), null);
    assert.equal(sanitizeSharePayload(null), null);
  });

  it("payload over 60KB → rejected", () => {
    const big = { title: "t", blob: "x".repeat(61_000) };
    assert.equal(sanitizeSharePayload({ userKey: "u", payload: big }), null);
  });

  it("projectId optional → null when absent", () => {
    const out = sanitizeSharePayload({ userKey: "u", payload: { title: "t" } });
    assert.equal(out.projectId, null);
  });
});

// ── Train M-2 (2026-07-21, design locked): result_shared 이벤트 슬롯 ─────────
const { createShareRoutes } = await import("../dist/routes/shares.js");

describe("POST /workspace/shares — result_shared usage event (M-2)", () => {
  function makeDb() {
    const writes = [];
    return {
      writes,
      prepare(sql) {
        let bound = [];
        return {
          bind(...args) {
            bound = args;
            return {
              first: async () => (/COUNT\(\*\)/.test(sql) ? { n: 0 } : null),
              run: async () => {
                writes.push({ sql, bound });
                return { success: true, meta: { changes: 1 } };
              },
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };
  }

  it("share 생성 시 workspace_result_shared 이벤트가 shareId 메타와 함께 기록된다", async () => {
    const app = createShareRoutes();
    const db = makeDb();
    const res = await app.request(
      "/workspace/shares",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey: "u1", projectId: "p1", payload: { title: "빵집 예약" } }),
      },
      { DB: db },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const eventWrite = db.writes.find((w) => /usage_events/i.test(w.sql));
    assert.ok(eventWrite, "usage event insert must fire");
    const flat = JSON.stringify(eventWrite.bound);
    assert.ok(flat.includes("workspace_result_shared"));
    assert.ok(flat.includes(body.shareId), "metadata carries the shareId");
  });
});
