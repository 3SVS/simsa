// 정적 정찰 실험 (사전 등록: wt-pr4 docs/pilot-2026-10/static-recon-prereg-2026-10-21.md, d1240c7)
// GET만. 받은 코드는 실행하지 않고 문자열 검사만 한다.
const APPS = [
  { id: "chatgpt", url: "https://cosmic-crostata-7c1265.netlify.app/", must: ["A3", "A4", "A5", "A6", "A7"] },
  { id: "gemini", url: "https://elaborate-crostata-d9b61c.netlify.app/", must: ["A3", "A6"] },
  { id: "v0", url: "https://1-pi-three-qk0pjsjigw.vercel.app/", must: ["A6", "A7"] },
  { id: "bolt", url: "https://hair-salon-booking-w-8vq8.bolt.host/", must: ["A6", "A7"] },
  { id: "claude", url: "https://dreamy-babka-5f07cd.netlify.app/", must: ["A3", "A6"] },
  { id: "lovable", url: "https://my-town-salon.lovable.app/", must: [] },
];
const ALL_AC = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"];
const RULES = [
  { id: "R1", cls: "missing_backend_config", covers: ["A3", "A4", "A5", "A6", "A7"],
    test: (t) => match(t, /YOUR_SUPABASE|SUPABASE_URL\s*[:=]\s*["']\s*["']|config\.js에|연결 정보를 입력|연결 설정을 먼저|your-project\.supabase|<your/g) },
  { id: "R2", cls: "client_only_storage", covers: ["A3", "A6"],
    test: (t) => {
      const store = match(t, /localStorage\.setItem|indexedDB\.open/g);
      const server = match(t, /fetch\(|axios|\.insert\(|\.from\(|method:\s*["']POST|supabase|firebase|firestore|\/api\//gi);
      return store.length && !server.length ? store : [];
    } },
  { id: "R3", cls: "timezone_date", covers: ["A6", "A7"],
    test: (t) => match(t, /toISOString\(\)\.slice\(0,\s*10\)|toISOString\(\)\.split\(["']T["']\)\[0\]|toISOString\(\)\.substring\(0,\s*10\)/g) },
];
function match(t, re) {
  const out = [];
  for (const m of t.matchAll(re)) {
    out.push(t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, " "));
    if (out.length >= 3) break;
  }
  return out;
}
async function get(u) {
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 simsa-static-recon" } });
  return { status: r.status, text: r.ok ? await r.text() : "" };
}
const sameOrigin = (base, src) => { try { const u = new URL(src, base); return u.origin === new URL(base).origin ? u.href : null; } catch { return null; } };
async function collect(url) {
  const files = [];
  const seen = new Set();
  const pages = [url];
  const home = await get(url);
  files.push({ url, len: home.text.length, text: home.text });
  if (/href=["'][^"']*\/admin["']/.test(home.text)) pages.push(new URL("/admin", url).href);
  for (const p of pages.slice(1)) { const h = await get(p); files.push({ url: p, len: h.text.length, text: h.text }); }
  const queue = [];
  for (const f of files) for (const m of f.text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) { const s = sameOrigin(url, m[1]); if (s) queue.push([s, 0]); }
  while (queue.length) {
    const [s, depth] = queue.shift();
    if (seen.has(s)) continue;
    seen.add(s);
    const r = await get(s);
    files.push({ url: s, len: r.text.length, text: r.text });
    if (depth < 1) for (const m of r.text.matchAll(/import\(\s*["']([^"']+\.js)["']\s*\)|from\s*["'](\.{0,2}\/[^"']+\.js)["']/g)) {
      const src = sameOrigin(s, m[1] ?? m[2]);
      if (src) queue.push([src, depth + 1]);
    }
  }
  return files;
}
const report = [];
let hit = 0, total = 0, false_ = 0;
for (const app of APPS) {
  const files = await collect(app.url);
  const all = files.map((f) => f.text).join("\n");
  const fired = [];
  for (const r of RULES) { const ev = r.test(all); if (ev.length) fired.push({ rule: r.id, cls: r.cls, covers: r.covers, evidence: ev }); }
  const covered = new Set(fired.flatMap((f) => f.covers));
  const hits = app.must.filter((a) => covered.has(a));
  const falseCells = [...covered].filter((a) => !app.must.includes(a));
  hit += hits.length; total += app.must.length; false_ += falseCells.length;
  report.push({ app: app.id, files: files.map((f) => `${f.url.replace(app.url, "/")} (${f.len}B)`), fired: fired.map(({ rule, cls, evidence }) => ({ rule, cls, evidence })), must: app.must, hits, falseCells });
}
console.log(JSON.stringify({ hit, total, falseCells: false_, report }, null, 1));
