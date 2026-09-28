/**
 * _daily-caps-fake.mjs — the `workspace_rate_limit` statements of
 * rate-limit.ts consumeDailyCaps, for the route tests' fake D1s.
 *
 * `node --test test/*.test.mjs` 글롭에 잡히지 않는 이름(밑줄 + `.mjs`)이다.
 *
 * Since the PR #561 review the inspection / repair routes take their daily slots
 * with ONE conditional upsert per bucket and read "full" from `meta.changes === 0`.
 * A fake that answers every unknown write with `{ meta: { changes: 0 } }` would
 * therefore say "full" for every request — so a fake that routes requests through
 * those routes must model the statement for real. This is that model: a counter
 * per (hash, day) that stops at the bound limit, and the refund UPDATE.
 *
 * Usage inside a fake's run():  const r = dailyCapsRun(rate, sql, args); if (r) return r;
 */

/** @param {Map<string, number>} rate @param {string} sql @param {unknown[]} args */
export function dailyCapsRun(rate, sql, args) {
  if (sql.includes("INSERT INTO workspace_rate_limit") && sql.includes("WHERE workspace_rate_limit.count < ?")) {
    // Binds: (hash, day, nowIso, nowIso, limit) — DAILY_SLOT_CONSUME_SQL.
    const [hash, day, , , limit] = args;
    const k = `${hash}::${day}`;
    const cur = rate.get(k) ?? 0;
    if (cur >= Number(limit)) return { meta: { changes: 0 } };
    rate.set(k, cur + 1);
    return { meta: { changes: 1 } };
  }
  if (sql.includes("UPDATE workspace_rate_limit") && sql.includes("count = count - 1")) {
    // Binds: (nowIso, hash, day) — the refund.
    const [, hash, day] = args;
    const k = `${hash}::${day}`;
    const cur = rate.get(k) ?? 0;
    if (cur > 0) rate.set(k, cur - 1);
    return { meta: { changes: cur > 0 ? 1 : 0 } };
  }
  return null;
}
