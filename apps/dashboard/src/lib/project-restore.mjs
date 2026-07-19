/**
 * project-restore.mjs — G8 D-2 (DR-3 LOCKED): 서버 정본 → 로컬 재구성 (pure).
 *
 * 서버 미러(title/idea/productSpec/items)와 ext 스냅샷으로 로컬 Project를
 * 만든다. 서버에 없는 로컬 전용 필드(category/priority/completeness)는 안전한
 * 기본값 — 복원의 목표는 "루프를 계속할 수 있는 상태"지 바이트 복제가 아니다.
 * 상태값은 화이트리스트로 정규화(깨진 서버 값이 UI를 깨지 않게).
 */

const VALID_STATUS = new Set(["passed", "failed", "inconclusive", "needs_decision", "not_started"]);

/**
 * @param {{ id: string, title?: string, idea?: string, productSpec?: any, items?: any[], createdAt?: string }} server
 * @param {import("./workflow-store").ExtendedProjectData | null} serverExt
 * @returns {{ project: import("./mock-data").Project, ext: import("./workflow-store").ExtendedProjectData }}
 */
export function buildLocalProjectFromServer(server, serverExt) {
  const spec = server.productSpec && typeof server.productSpec === "object" ? server.productSpec : {};
  const items = Array.isArray(server.items) ? server.items : [];

  const project = {
    id: server.id,
    name: server.title || spec.productName || "복원된 프로젝트",
    description: spec.oneLine || (server.idea ? String(server.idea).slice(0, 120) : ""),
    createdAt: (server.createdAt || new Date().toISOString()).slice(0, 10),
    spec: {
      completeness: 70,
      goal: spec.problem || spec.oneLine || "",
      included: Array.isArray(spec.included) ? spec.included : [],
      excluded: Array.isArray(spec.excluded) ? spec.excluded : [],
      openDecisions: Array.isArray(spec.openQuestions) ? spec.openQuestions : [],
    },
    requirements: items
      .filter((i) => i && typeof i === "object" && typeof i.id === "string" && i.id.length > 0)
      .map((i) => ({
        id: i.id,
        title: typeof i.title === "string" ? i.title : i.id,
        status: VALID_STATUS.has(i.status) ? i.status : "not_started",
        category: "core",
        priority: "medium",
      })),
  };

  // ext: 서버 스냅샷 우선, productSpec은 미러 값으로 보강(화면들이 의존).
  const ext = {
    ...(serverExt && typeof serverExt === "object" ? serverExt : {}),
  };
  if (!ext.productSpec && spec && Object.keys(spec).length > 0) ext.productSpec = spec;
  if (!ext.entryPath) ext.entryPath = "idea";

  return { project, ext };
}
