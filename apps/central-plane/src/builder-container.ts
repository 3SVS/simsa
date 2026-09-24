/**
 * SI 티어 Train B — B1: SimsaBuilder Cloudflare Container Durable Object.
 *
 * T1 빌드 잡(설치·구현·빌드·테스트·S 배포)을 실행하는 컨테이너
 * (builder-container/Dockerfile)를 감싼다. ConclaveSandbox·SimsaInspector와
 * 같은 패턴:
 *   - extends Container<Env>
 *   - wrangler.toml의 세 번째 [[containers]] 블록
 *   - Durable Object 바인딩 BUILDER — 잡 하나당 인스턴스 하나(`build-<jobId>`)
 *   - src/index.ts에서만 export — router.ts에는 절대 import하지 않는다
 *     (node --test 소비자가 `cloudflare:workers`를 끌어오지 않도록).
 *
 * sleepAfter 50m: 잡 전체 상한이 45분(D-4 [PILOT])이라 콜백·정리 여유를 둔다.
 * 자가점검(`/selfcheck`)만 도는 인스턴스도 같은 값 — 비용은 실제 실행 시간에만 붙는다.
 * defaultPort는 builder-container/Dockerfile의 EXPOSE와 일치(불변식 테스트).
 */
import { Container } from "@cloudflare/containers";
import type { Env } from "./env.js";

export class SimsaBuilder extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "50m";
  override envVars = {
    NODE_ENV: "production",
    WORK_ROOT: "/var/lib/simsa-build",
  };

  override onStart() {
    console.log("simsa-builder container started");
  }

  override onStop() {
    console.log("simsa-builder container stopped");
  }

  override onError(err: unknown) {
    console.error("simsa-builder container error:", err);
  }
}
