/**
 * workspace/hosted-app-teardown.ts — 프로젝트 삭제 → 그 프로젝트의 빌드가 만든 **호스팅 자원** 정리 (PR #569 S3 검증 결함 2).
 *
 * S3부터 빌드는 실제로 세 가지를 만든다: ① 공개 유저 Worker(`https://<slug>.<HOSTING_ROOT_DOMAIN>`, WfP 스크립트) ② 프로젝트 D1
 * (마이그레이션이 적용되고 **앱 최종 사용자의 행이 쌓이는 곳**) ③ 호스팅 조직 저장소(`<조직>/<slug>`, 소스 커밋). 프로젝트를
 * 지우면(방침: "프로젝트를 삭제하시면 … 함께 삭제") 이 셋도 지운다. 운영 자격은 Worker에만 있다(D-6):
 *   - Worker 스크립트: deleteUserWorker(운영 CF 토큰) — 404는 이미 없음(멱등)
 *   - D1: deleteProjectD1(운영 CF 토큰) — 404는 이미 없음
 *   - 저장소: deleteHostedRepo — **그 저장소 하나 · administration 쓰기만**으로 좁힌 설치 토큰, 쓰고 폐기. 잡 행의 저장소가
 *     `<호스팅 조직>/<slug>`일 때만(push와 같은 규칙 — 다른 저장소는 우리 것이 아니다)
 *
 * 안전(되돌릴 수 없는 삭제):
 *   - **프로젝트 행이 이미 없고**(deleteProject 배치 뒤) 잡 행에 **삭제 표시**(user_key = '')가 있을 때만 — 둘 다 아니면 아무것도
 *     지우지 않는다(project_exists / not_marked).
 *   - 같은 slug·D1을 **다른 프로젝트의 잡도** 쓰면(slug 충돌) 그 자원은 지우지 않는다(shared_with_other_project).
 *   - 하나라도 실패하면 잡 행을 남긴다 → 5분 크론(sweepDeletedProjectHosting)이 다시 시도한다. 다 지우면 잡 행·
 *     타임라인을 지운다. 토큰·키는 로그·결과에 싣지 않는다.
 */
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import {
  BUILD_JOB_UNLINKED_USER_KEY, deleteBuildJobsForProject, hostingResourceSharedWithOtherProject, listBuildJobHostingForProject,
  listDeletedProjectsWithBuildJobs,
} from "./build-job-db.js";
import { SLUG_RE, deleteProjectD1, deleteUserWorker } from "./hosting-provision.js";
import { deleteHostedRepo, hostingOrg } from "./hosting-repo.js";

export type HostedTeardownResult = {
  /** 모든 자원이 지워졌고(또는 없었고) 잡 행도 지웠다. */
  ok: boolean;
  jobs: number;
  deleted: { workers: number; d1: number; repos: number };
  skipped: string[];
  failures: string[];
};

/** [PILOT] 재시도 크론 한 틱에 정리할 삭제된 프로젝트 수(외부 호출이 프로젝트당 최대 ~10). */
export const HOSTED_TEARDOWN_PER_TICK = 5;

async function projectRowExists(env: Env, projectId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM workspace_projects WHERE id = ?`).bind(projectId).first();
  return row !== null && row !== undefined;
}

async function isMarkedDeleted(env: Env, projectId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM build_jobs WHERE project_id = ? AND user_key != ? LIMIT 1`).bind(projectId, BUILD_JOB_UNLINKED_USER_KEY).first();
  return row === null || row === undefined;
}

/**
 * 삭제된 프로젝트 하나의 호스팅 자원 정리. 던지지 않는다.
 */
export async function teardownHostedAppsForProject(env: Env, projectId: string, fetchImpl: FetchLike): Promise<HostedTeardownResult> {
  const result: HostedTeardownResult = { ok: false, jobs: 0, deleted: { workers: 0, d1: 0, repos: 0 }, skipped: [], failures: [] };
  try {
    const rows = await listBuildJobHostingForProject(env, projectId);
    result.jobs = rows.length;
    if (rows.length === 0) {
      result.ok = true;
      return result;
    }
    if (await projectRowExists(env, projectId)) {
      result.failures.push("project_exists");
      return result;
    }
    if (!(await isMarkedDeleted(env, projectId))) {
      result.failures.push("not_marked");
      return result;
    }
    const org = hostingOrg(env).toLowerCase();
    const slugs = [...new Set(rows.map((r) => r.slug))];
    const d1Ids = [...new Set(rows.map((r) => r.d1Id).filter((x): x is string => typeof x === "string" && x.length > 0))];
    const repoNames = [...new Set(rows.filter((r) => r.repoFullName && r.repoFullName.toLowerCase() === `${org}/${r.slug}`.toLowerCase()).map((r) => r.slug))];
    for (const r of rows) {
      if (r.repoFullName && r.repoFullName.toLowerCase() !== `${org}/${r.slug}`.toLowerCase()) result.skipped.push(`repo_not_ours:${r.id}`);
    }

    for (const slug of slugs) {
      if (!SLUG_RE.test(slug)) {
        result.skipped.push(`invalid_slug:${slug.slice(0, 40)}`);
        continue;
      }
      if (await hostingResourceSharedWithOtherProject(env, projectId, { slug })) {
        result.skipped.push(`shared_with_other_project:${slug}`);
        continue;
      }
      const w = await deleteUserWorker(env, slug, fetchImpl);
      if (w.ok) result.deleted.workers += w.value.existed ? 1 : 0;
      else result.failures.push(`worker:${slug}:${w.error}${w.status ? `_${w.status}` : ""}`);
      if (repoNames.includes(slug)) {
        const g = await deleteHostedRepo(env, slug, fetchImpl);
        if (g.ok) result.deleted.repos += g.value.existed ? 1 : 0;
        else result.failures.push(`repo:${slug}:${g.error}${g.status ? `_${g.status}` : ""}`);
      }
    }
    for (const d1Id of d1Ids) {
      if (await hostingResourceSharedWithOtherProject(env, projectId, { d1Id })) {
        result.skipped.push(`shared_with_other_project:d1`);
        continue;
      }
      const d = await deleteProjectD1(env, d1Id, fetchImpl);
      if (d.ok) result.deleted.d1 += d.value.existed ? 1 : 0;
      else result.failures.push(`d1:${d.error}${d.status ? `_${d.status}` : ""}`);
    }
    if (result.failures.length === 0) {
      await deleteBuildJobsForProject(env, projectId);
      result.ok = true;
    }
  } catch (err) {
    result.failures.push(`crashed:${String((err as Error)?.message ?? err).slice(0, 80)}`);
  }
  console.log(JSON.stringify({ event: "hosted_app_teardown", project: projectId, ok: result.ok, jobs: result.jobs, deleted: result.deleted, skipped: result.skipped.slice(0, 10), failures: result.failures.slice(0, 10) }));
  return result;
}

/**
 * 재시도 크론(5분 틱): 삭제 표시가 있고 프로젝트 행도 없는 잡의 프로젝트를 몇 개씩 다시 정리한다 — deleteProject 안의 첫 시도가
 * 네트워크·자격 문제로 실패했을 때 자원이 영원히 남지 않게.
 */
export async function sweepDeletedProjectHosting(env: Env, fetchImpl: FetchLike, limit = HOSTED_TEARDOWN_PER_TICK): Promise<{ projects: number; cleaned: number; failed: number }> {
  const ids = await listDeletedProjectsWithBuildJobs(env, limit);
  let cleaned = 0;
  let failed = 0;
  for (const id of ids) {
    const r = await teardownHostedAppsForProject(env, id, fetchImpl);
    if (r.ok) cleaned += 1;
    else failed += 1;
  }
  return { projects: ids.length, cleaned, failed };
}
