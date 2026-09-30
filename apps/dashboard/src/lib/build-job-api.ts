/**
 * build-job-api.ts — 문 (a) "만들기" API 클라이언트 (SI 티어 Train B — B-8).
 *
 *   POST /workspace/projects/:id/build              → 잡 시작(S 모드, 계정 0)
 *   GET  /workspace/projects/:id/build-jobs         → 최근 잡 목록 + hostRoot
 *   GET  /workspace/projects/:id/build-jobs/:jobId  → 잡 + 타임라인
 *
 * 응답은 여기서 **필드마다** 검사한다(build-job-view.mjs parseBuildJob — 대시보드에는 zod가 없어
 * daily-limit.mjs와 같은 방식). 실패는 HTTP 상태와 본문을 그대로 돌려주고, 문구 결정은
 * startErrorNotice(순수)가 한다 — 화면이 "옛 서버"와 "프로젝트 없음"과 "일시 오류"를 구분해 말해야 한다.
 */
import { parseBuildEvents, parseBuildJob, isRouteMissing, type BuildJobEventView, type BuildJobView } from "./build-job-view.mjs";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";

export type BuildApiFailure = {
  ok: false;
  /** HTTP status, 0 for a network failure. */
  status: number;
  /** The server's error code when the body carried one ("" otherwise). */
  error: string;
  /** Old server: the build routes do not exist at all (global 404, not the route's own not_found). */
  routeMissing: boolean;
  body: unknown;
};

export type BuildJobListOk = { ok: true; jobs: BuildJobView[]; hostRoot: string | null };
export type BuildJobDetailOk = { ok: true; job: BuildJobView; events: BuildJobEventView[] };
export type BuildStartOk = { ok: true; job: BuildJobView; dispatched: boolean };

function projectPath(projectId: string): string {
  return `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}`;
}

async function readBody(resp: Response): Promise<unknown> {
  return resp.json().catch(() => null);
}

function failure(status: number, body: unknown): BuildApiFailure {
  const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? String((body as { error: string }).error) : "";
  return { ok: false, status, error, routeMissing: isRouteMissing(status, body), body };
}

export type BuildAvailabilityOk = { ok: true; open: boolean };

/**
 * GET /workspace/build-availability — 서버가 "만들기가 지금 끝까지 된다"고 확인하는가(#578 검증 결함 2).
 * 프로젝트·userKey와 무관한 서버 사실. 옛 서버는 경로가 없어 전역 404 → 실패로 돌려주고, buildOpenFact가 닫힘으로 본다.
 */
export async function getBuildAvailability(): Promise<BuildAvailabilityOk | BuildApiFailure> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/build-availability`, { signal: AbortSignal.timeout(10000) });
    const body = await readBody(resp);
    if (resp.ok && body && typeof body === "object" && (body as { ok?: unknown }).ok === true) {
      return { ok: true, open: (body as { buildEnabled?: unknown }).buildEnabled === true };
    }
    return failure(resp.status, body);
  } catch {
    return failure(0, null);
  }
}

export async function listBuildJobs(projectId: string, userKey: string): Promise<BuildJobListOk | BuildApiFailure> {
  try {
    const resp = await fetch(`${projectPath(projectId)}/build-jobs?userKey=${encodeURIComponent(userKey)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const body = await readBody(resp);
    if (resp.ok && body && typeof body === "object" && (body as { ok?: unknown }).ok === true) {
      const b = body as { jobs?: unknown; hostRoot?: unknown };
      const jobs = (Array.isArray(b.jobs) ? b.jobs : []).map(parseBuildJob).filter((j): j is BuildJobView => j !== null);
      return { ok: true, jobs, hostRoot: typeof b.hostRoot === "string" && b.hostRoot ? b.hostRoot : null };
    }
    return failure(resp.status, body);
  } catch {
    return failure(0, null);
  }
}

export async function getBuildJob(projectId: string, jobId: string, userKey: string): Promise<BuildJobDetailOk | BuildApiFailure> {
  try {
    const resp = await fetch(
      `${projectPath(projectId)}/build-jobs/${encodeURIComponent(jobId)}?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const body = await readBody(resp);
    if (resp.ok && body && typeof body === "object" && (body as { ok?: unknown }).ok === true) {
      const job = parseBuildJob((body as { job?: unknown }).job);
      if (job) return { ok: true, job, events: parseBuildEvents((body as { events?: unknown }).events) };
    }
    return failure(resp.status, body);
  } catch {
    return failure(0, null);
  }
}

/**
 * 잡 시작. 202(디스패치됨) 또는 200(디스패치 실패 — 잡은 failed로 만들어졌다)은 둘 다 ok로
 * 돌려주고, 화면은 잡 상태로 정직하게 말한다.
 */
export async function startBuild(projectId: string, userKey: string, locale: "ko" | "en"): Promise<BuildStartOk | BuildApiFailure> {
  try {
    const resp = await fetch(`${projectPath(projectId)}/build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, locale }),
      // Worker가 호스팅 자리(D1)를 만들고 컨테이너를 부르는 데까지 — 수십 초가 걸릴 수 있다.
      signal: AbortSignal.timeout(90000),
    });
    const body = await readBody(resp);
    if (resp.ok && body && typeof body === "object" && (body as { ok?: unknown }).ok === true) {
      const job = parseBuildJob((body as { job?: unknown }).job);
      if (job) return { ok: true, job, dispatched: (body as { dispatched?: unknown }).dispatched === true };
    }
    return failure(resp.status, body);
  } catch {
    return failure(0, null);
  }
}
