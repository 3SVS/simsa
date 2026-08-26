/**
 * probe-mailbox.ts — 검수용 일회용 메일함 (2026-08-26).
 *
 * ## 왜 이게 있나
 *
 * 로그인 뒤 화면을 검수하려면 계정이 필요하다. 두 가지 길이 있는데:
 *
 *   ① 사용자에게 아이디·비밀번호를 받는다 — **하지 않는다.** 유출되면 그 앱뿐 아니라
 *      비밀번호를 재사용한 다른 계정까지 열리고, 무엇보다 비개발자에게 "검수 도구에
 *      비밀번호를 주는 습관"을 가르치게 된다. 우리가 안전하게 다뤄도 그 습관이
 *      다음번에 다른 곳에서 그 사람을 다치게 한다. 소셜 로그인 앱에는 애초에 못 쓴다.
 *
 *   ② **우리가 일회용 계정을 만든다** — 이쪽. 남의 자격증명을 보관하지 않는다.
 *      그러려면 앱이 보내는 확인 메일을 받아야 하고, 그 수신구가 이 모듈이다.
 *
 * 역할 계정(관리자·기업)처럼 자가 가입이 막힌 경우도 같은 구조로 푼다 — 사용자가
 * **자기 앱에서 우리 주소로 초대를 보내면** 우리가 받아서 가입을 완주한다.
 * **초대는 자격증명이 아니다**: 사용자가 통제권을 계속 쥐고, 언제든 그 계정을 지울 수 있다.
 *
 * ## 정직성·최소수집
 *
 * 남의 앱이 보낸 메일에는 그 앱 사용자의 정보가 담길 수 있다. 그래서 **본문을
 * 저장하지 않는다.** 제목과 **링크만** 남기고, 그것도 검수가 끝나면 지운다.
 */
import type { Env } from "./env.js";

/** Email Workers가 넘겨주는 메시지의 우리가 쓰는 부분만. */
export type IncomingEmail = {
  from: string;
  to: string;
  headers: { get(name: string): string | null };
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
};

/** 주소에서 검수 실행 id를 꺼낸다. `probe-<runId>@…` 형태만 받는다. */
export function runIdFromAddress(addr: string): string | null {
  const local = String(addr ?? "").trim().toLowerCase().split("@")[0] ?? "";
  const m = /^probe-([a-z0-9_-]{6,64})$/.exec(local);
  return m?.[1] ?? null;
}

/**
 * 메일 본문에서 링크를 뽑는다. HTML과 평문 둘 다 훑는다.
 *
 * 확인·초대 링크는 보통 하나가 아니다(푸터의 도움말·수신거부까지 섞인다).
 * 그래서 **거르지 않고 다 넘긴다** — 어느 것이 확인 링크인지는 실제로 열어보는
 * 쪽(컨테이너)이 판단한다. 여기서 똑똑한 척 고르면 앱마다 다른 문구에 걸려 넘어진다.
 * 다만 수신거부·구독취소는 누르면 되돌리기 어려우므로 **여기서 뺀다.**
 */
export function extractLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const url = raw.replace(/[)\]>"'.,;]+$/, "").replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return;
    // 누르면 되돌리기 어려운 것은 아예 넘기지 않는다.
    if (/unsubscribe|수신거부|opt[-_]?out|구독\s*취소/i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  for (const m of body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) push(m[1] ?? "");
  for (const m of body.matchAll(/https?:\/\/[^\s<>"']+/gi)) push(m[0]);
  return out.slice(0, 25);
}

/**
 * 메일 원문에서 사람이 읽는 본문만 성기게 뽑는다.
 *
 * 완전한 MIME 파서를 들이지 않는 이유: 우리는 **링크만** 필요하고, 링크는 인코딩을
 * 거의 타지 않는다. quoted-printable의 줄바꿈(`=\r\n`)만 풀어주면 대부분 잡힌다.
 */
export function decodeBodyForLinks(raw: string): string {
  return raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=");
}

export type StoredProbeEmail = {
  id: string;
  runId: string;
  toAddr: string;
  fromAddr: string;
  subject: string;
  links: string[];
  receivedAt: string;
};

/** 받은 메일을 저장한다. 본문은 넣지 않는다(최소수집). */
export async function storeProbeEmail(
  env: Env,
  mail: { runId: string; toAddr: string; fromAddr: string; subject: string; links: string[] },
): Promise<void> {
  const id = `pm_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await env.DB.prepare(
    `INSERT INTO probe_emails (id, run_id, to_addr, from_addr, subject, links, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      mail.runId,
      mail.toAddr.slice(0, 200),
      mail.fromAddr.slice(0, 200),
      mail.subject.slice(0, 300),
      JSON.stringify(mail.links),
      new Date().toISOString(),
    )
    .run();
}

/** 한 검수 실행의 메일함을 읽는다(오래된 것부터). */
export async function listProbeEmails(env: Env, runId: string): Promise<StoredProbeEmail[]> {
  const res = await env.DB.prepare(
    `SELECT id, run_id, to_addr, from_addr, subject, links, received_at
       FROM probe_emails WHERE run_id = ? ORDER BY received_at ASC LIMIT 50`,
  )
    .bind(runId)
    .all<{ id: string; run_id: string; to_addr: string; from_addr: string; subject: string; links: string; received_at: string }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    runId: r.run_id,
    toAddr: r.to_addr,
    fromAddr: r.from_addr ?? "",
    subject: r.subject ?? "",
    links: safeParseLinks(r.links),
    receivedAt: r.received_at,
  }));
}

function safeParseLinks(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 검수가 끝나면 지운다 — 남의 앱 메일을 오래 들고 있을 이유가 없다. */
export async function deleteProbeEmails(env: Env, runId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM probe_emails WHERE run_id = ?`).bind(runId).run();
}

/**
 * Email Workers 진입점이 부르는 처리기.
 *
 * **모르는 주소는 조용히 버린다.** 우리 수신 도메인으로 오는 스팸을 D1에 쌓지 않는다.
 * 던지지 않는다 — 메일 처리 실패가 워커를 깨뜨리면 안 된다.
 */
export async function handleProbeEmail(env: Env, message: IncomingEmail): Promise<"stored" | "ignored"> {
  const runId = runIdFromAddress(message.to);
  if (!runId) return "ignored";
  try {
    const raw = await new Response(message.raw).text();
    const links = extractLinks(decodeBodyForLinks(raw.slice(0, 500_000)));
    await storeProbeEmail(env, {
      runId,
      toAddr: message.to,
      fromAddr: message.from,
      subject: message.headers.get("subject") ?? "",
      links,
    });
    return "stored";
  } catch (err) {
    console.error("[probe-mailbox] store failed:", err);
    return "ignored";
  }
}
