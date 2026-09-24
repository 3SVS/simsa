/**
 * SI 티어 Train B — B2: S 모드 호스팅 라우터 (dynamic dispatch Worker).
 *
 * `<slug>.<HOSTING_ROOT_DOMAIN>` → dispatch namespace의 유저 Worker `slug`.
 * 판단은 route.ts(순수), 여기는 HTTP 껍데기뿐.
 *
 * 응답 규칙(정직성):
 *  - 도메인 미설정 → 503 hosting_not_configured
 *  - 우리 호스팅이 아닌 주소 → 404
 *  - 네임스페이스에 없는 slug → 404 ("아직 배포 전이거나 삭제됨")
 *  - 정지된 slug → 410 + 신고/정지 안내(B7에서 목록 연결)
 *  - 유저 Worker 예외 → 502 (우리 라우터 오류와 구분)
 * 모든 응답에 `x-simsa-hosted: <slug>`(있을 때) — 검수·영수증이 "Simsa 호스팅 중"을 증거로 읽는다.
 */
import { decideRoute } from "./route.js";

export interface Env {
  DISPATCHER: DispatchNamespace;
  HOSTING_ROOT_DOMAIN?: string;
}

const errorMessage = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/**
 * "없는 앱"을 뜻하는 **디스패치 계층** 오류인가 — `Worker not found`로 시작하는 것만.
 *
 * 2026-09-25 라이브 교훈: 처음엔 "not found|has been deleted"까지 넓게 받았는데, 그러면 **살아 있는 유저
 * 앱**이 던진 "User not found" 같은 오류도 "배포 안 됨 404"로 둔갑해 앱 고장을 가린다. 실제로 본 502는
 * 스크립트 삭제 뒤에도 엣지에서 옛 코드가 한동안 실행되며(API상 script_count 0) 그 앱이 지워진 D1에서
 * 낸 오류였다 — 라우터가 판정할 일이 아니라 **삭제 전파 지연**이다. 즉시 차단은 B7 라우터 차단(410)으로.
 */
export function isMissingWorker(message: string): boolean {
  return /^Worker not found/i.test(message.trim());
}

const text = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } });

export async function handle(request: Request, env: Env, isSuspended: (slug: string) => boolean = () => false): Promise<Response> {
  const url = new URL(request.url);
  const d = decideRoute(url.hostname, env.HOSTING_ROOT_DOMAIN ?? "", isSuspended);
  switch (d.kind) {
    case "not_configured":
      return text(503, "hosting_not_configured");
    case "not_hosted":
      return text(404, "not a Simsa-hosted address");
    case "suspended":
      return text(410, "This app has been suspended by Simsa. If you believe this is a mistake, contact support.", { "x-simsa-hosted": d.slug });
    case "dispatch": {
      let worker: Fetcher;
      try {
        worker = env.DISPATCHER.get(d.slug);
      } catch (e) {
        const message = errorMessage(e);
        console.log(JSON.stringify({ event: "dispatch_get_error", slug: d.slug, message }));
        if (isMissingWorker(message)) return text(404, "app not deployed yet", { "x-simsa-hosted": d.slug });
        return text(502, "hosting router error", { "x-simsa-hosted": d.slug });
      }
      try {
        const res = await worker.fetch(request);
        const out = new Response(res.body, res);
        out.headers.set("x-simsa-hosted", d.slug);
        return out;
      } catch (e) {
        const message = errorMessage(e);
        console.log(JSON.stringify({ event: "dispatch_fetch_error", slug: d.slug, message }));
        if (isMissingWorker(message)) return text(404, "app not deployed yet", { "x-simsa-hosted": d.slug });
        return text(502, "the app failed to respond", { "x-simsa-hosted": d.slug });
      }
    }
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
} satisfies ExportedHandler<Env>;
