"use client";

// 개발 지시서 화면 (SI 티어 A4 · D-1 T0 · D-17 초보자 4줄 + 접힌 개발자용).
//
// 초보자는 네 줄만 본다: 무엇을 만들지 · 화면 몇 개 · 저장하는 것 몇 가지 · 이번엔 안 만드는 것.
// ERD·API·작업 분해는 "개발자용 보기"에 접혀 있고, 그대로 개발자/개발 AI에게 넘길 수 있다
// (빌더 팩 zip에 dev-spec/ 폴더로 들어간다 — A3).
//
// 정직성: 서버는 무결성 통과본만 돌려준다. 실패하면 이유를 말하고 예시로 대체하지 않는다.
//
// B-8 (D-17 — 아이디어·기획서 문의 "만들기"는 S): 지시서가 있고 **서버가 만들기를 열었다고 확인하면**
// 이 화면의 주 버튼은 "만들기"(MakeAppPanel)다 — 계정 없이 Simsa가 만들고 Simsa 주소에 올린다. "팩으로 받기"는
// 보조로 내려간다(한 화면에 주 버튼 하나). 이미 만든 앱이 있는 문·역추론 지시서·옛 서버(빌드 라우트 없음)·
// ★서버가 열지 않음(#578 검증 결함 2: 라우트는 있어도 실행체가 끝까지 못 하면 안내가 없는 기능을 약속한다)에서는
// 만들기를 내밀지 않고 종전 그대로 팩이 주 버튼이다(makePanelVisible).
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey, loadExtendedProjectData, markProjectSyncFailed } from "@/lib/workflow-store";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import { generateDevSpecApi, getDevSpecApi, type DevSpecApiError } from "@/lib/dev-spec-api";
import { devSpecView, generateButtonState, generateErrorKey } from "@/lib/dev-spec-view.mjs";
import { listBuildJobs, type BuildApiFailure, type BuildJobListOk } from "@/lib/build-job-api";
import { buildAvailability, latestBuildJob, makePanelVisible } from "@/lib/build-job-view.mjs";
import { useAppPresence } from "@/lib/use-app-presence";
import { useBuildOpen } from "@/lib/use-build-open";
import { useDeveloperMode } from "@/lib/use-developer-mode";
import { effectiveConfirmedItemIds } from "@/lib/confirmed-items.mjs";
import { generationCapacityText } from "@/lib/generation-capacity.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import { ProjectNotFound } from "@/components/ProjectNotFound";
import { MakeAppPanel } from "@/components/MakeAppPanel";

type Phase = "idle" | "loading";

export default function DevSpecPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const project = getLocalProject(id) ?? getProject(id);
  const [devSpec, setDevSpec] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<DevSpecApiError | null>(null);
  const [showDev, setShowDev] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // B-8: 만들기를 여기서 쓸 수 있는가 + 최근 잡(진행 중·끝이면 다시 만들라고 하지 않는다).
  const [buildList, setBuildList] = useState<BuildJobListOk | BuildApiFailure | null>(null);
  const presence = useAppPresence(id);
  // #578 결함 2: 서버가 "만들기가 끝까지 된다"고 확인했는가 — 확인 전엔 보류, 확인 못 하면 종전대로 팩이 주 버튼.
  const makeOpen = useBuildOpen();
  const [developerMode] = useDeveloperMode();

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getDevSpecApi(id, getUserKey());
      if (!alive) return;
      if (r.ok) setDevSpec(r.devSpec);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    let alive = true;
    listBuildJobs(id, getUserKey()).then((r) => {
      if (alive) setBuildList(r);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!project) return <ProjectNotFound />;

  const ext = loadExtendedProjectData(id);
  const productSpec = ext?.productSpec ?? null;
  const hasSpec = !!productSpec && typeof productSpec === "object" && Object.keys(productSpec).length > 0;
  const hasItems = project.requirements.length > 0;
  const view = devSpecView(devSpec);
  const btn = generateButtonState({ hasSpec, hasItems, hasDevSpec: !!view, phase });
  const d = t.devSpec;
  const showMake = view
    ? makePanelVisible({
        entryPath: ext?.entryPath ?? null,
        presence,
        specSource: view.source,
        availability: buildAvailability(buildList),
        open: makeOpen,
      })
    : false;
  const latestJob = buildList?.ok ? latestBuildJob(buildList.jobs) : null;

  async function handleGenerate() {
    setError(null);
    setPhase("loading");
    // 서버는 D1의 브리프·항목을 읽는다 — 로컬 우선 저장소를 먼저 미러한다(items 페이지와 같은 페이로드).
    const criteria = ext?.itemCriteria ?? {};
    const mirror = await saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: project!.name,
      idea: project!.description ?? "",
      understood: {},
      productSpec: productSpec ?? {},
      items: project!.requirements.map((r) => ({ id: r.id, title: r.title, status: r.status, criteria: criteria[r.id] ?? [] })),
    });
    if (!mirror.ok) {
      markProjectSyncFailed(id);
      setPhase("idle");
      setError({ ok: false, error: "not_found" });
      return;
    }
    // C-A7 (D-2 amend): 기존 앱 문이면 유저가 확인한 항목 id를 함께 보낸다 — 역추론 지시서의 must는
    // 그 목록에서만 나온다(서버가 entry_path로 역추론 여부를 정한다). 목록 필드가 없는 옛 프로젝트는
    // 지금 항목 전부가 확인된 것이다(confirmed-items.mjs 레거시 폴백) — undefined를 보내면 서버가
    // 확인 0으로 읽고 must를 전부 강등한다(PR #577 리뷰 P2-1).
    const r = await generateDevSpecApi(id, getUserKey(), locale === "en" ? "en" : "ko", {
      confirmedItemIds: effectiveConfirmedItemIds(ext?.intentConfirmedItemIds, project!.requirements.map((req) => req.id)),
    });
    setPhase("idle");
    if (r.ok) {
      setDevSpec(r.devSpec);
      setShowDev(false);
    } else {
      setError(r);
    }
  }

  const errorText = (e: DevSpecApiError): string => {
    const key = generateErrorKey(e);
    // 비용 권고 ③ — today's dev-spec capacity is full: the shared sentence with the reset time.
    if (key === "errCapacity") return generationCapacityText(t, e.error === "generation_capacity" ? e.resetAt : null);
    if (key === "errInvalid" && e.error === "dev_spec_invalid") return d.errInvalid.replace("{n}", String(e.issueCount));
    if (key === "errRateLimited" && e.error === "rate_limited") return d.errRateLimited.replace("{m}", String(Math.max(1, Math.ceil(e.retryAfterSeconds / 60))));
    return d[key];
  };

  return (
    <div className="max-w-3xl">
      <h1 className="page-title">{d.title}</h1>
      <p className="page-subtitle mb-8">{d.subtitle}</p>

      {/* ── 초보자 4줄 (D-17) ─────────────────────────────────────────────── */}
      {view ? (
        <div className="card p-6">
          <dl className="grid gap-3 text-sm">
            <div className="flex gap-3"><dt className="w-36 flex-shrink-0 text-gray-500">{d.what}</dt><dd className="font-medium text-gray-900">{view.what}</dd></div>
            <div className="flex gap-3"><dt className="w-36 flex-shrink-0 text-gray-500">{d.mustFeatures}</dt><dd className="text-gray-900">{view.mustFeatureTitles.join(" · ") || d.none}</dd></div>
            <div className="flex gap-3"><dt className="w-36 flex-shrink-0 text-gray-500">{d.screens}</dt><dd className="text-gray-900">{d.countScreens.replace("{n}", String(view.screenCount))}</dd></div>
            <div className="flex gap-3"><dt className="w-36 flex-shrink-0 text-gray-500">{d.entities}</dt><dd className="text-gray-900">{d.countEntities.replace("{n}", String(view.entityCount))}</dd></div>
            <div className="flex gap-3"><dt className="w-36 flex-shrink-0 text-gray-500">{d.excluded}</dt><dd className="text-gray-900">{view.excluded.join(" · ") || d.none}</dd></div>
          </dl>
          {view.humanOnlyCount > 0 && (
            <p className="mt-4 text-xs text-gray-500">{d.humanOnly.replace("{n}", String(view.humanOnlyCount))}</p>
          )}
          {view.source === "inferred" && <p className="mt-2 text-xs text-gray-500">{d.inferredNote}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {/* 만들기가 보이거나 아직 정해지지 않았으면(보류) 팩은 보조 — 주 버튼은 한 화면에 하나. */}
            <Link href={`/projects/${id}/export`} className={`btn btn-md ${showMake === false ? "btn-primary" : "btn-secondary"}`}>{d.getPack}</Link>
            <button onClick={() => setShowDev((v) => !v)} className="btn btn-md btn-secondary">
              {showDev ? d.hideDev : d.showDev}
            </button>
            <button onClick={handleGenerate} disabled={!btn.enabled} className="btn btn-md btn-secondary">
              {d[btn.labelKey]}
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-6">
          <p className="text-sm font-medium text-gray-700">{loaded ? d.emptyTitle : d.loading}</p>
          {loaded && <p className="mt-1 text-xs text-gray-500">{d.emptyBody}</p>}
          {loaded && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={handleGenerate} disabled={!btn.enabled} className="btn btn-md btn-primary">
                {d[btn.labelKey]}
              </button>
              {btn.hintKey === "needSpec" && <Link href={`/projects/${id}/spec`} className="text-sm text-brand-700 underline">{d.needSpec}</Link>}
              {btn.hintKey === "needItems" && <Link href={`/projects/${id}/items`} className="text-sm text-brand-700 underline">{d.needItems}</Link>}
            </div>
          )}
          {phase === "loading" && <p className="mt-3 text-xs text-gray-500">{d.makingHint}</p>}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{errorText(error)}</p>}

      {/* ── 만들기 (B-8 · S 경로 · 계정 0) ─────────────────────────────────── */}
      {view && showMake === true && (
        <MakeAppPanel
          projectId={id}
          projectTitle={project.name}
          view={view}
          latestJob={latestJob}
          developerMode={developerMode}
          onStarted={() => router.push(`/projects/${encodeURIComponent(id)}/my-app`)}
        />
      )}

      {/* ── 개발자용 보기 (접힘) ───────────────────────────────────────────── */}
      {view && showDev && <DeveloperView devSpec={devSpec as Record<string, unknown>} />}
    </div>
  );
}

// 개발자용 — DevSpec을 그대로 표로. 판정·점수 없음, 있는 그대로.
function DeveloperView({ devSpec }: { devSpec: Record<string, unknown> }) {
  const { t } = useI18n();
  const d = t.devSpec;
  const arr = <T,>(k: string): T[] => (Array.isArray(devSpec[k]) ? (devSpec[k] as T[]) : []);
  type FR = { id: string; title: string; description: string; priority: string };
  type AC = { id: string; featureId: string; given: string; when: string; then: string; verifiedBy: string };
  type SCR = { id: string; route: string; purpose: string; components: string[]; featureIds: string[] };
  type ENT = { name: string; fields: Array<{ name: string; type: string; required: boolean }>; ownership: string };
  type API = { id: string; method: string; path: string; auth: string; featureIds: string[] };
  type WBS = { id: string; title: string; order: number; dependsOn: string[]; acceptanceIds: string[] };
  type TP = { kind: "browser" | "test"; acceptanceId: string; steps?: string[]; testName?: string };
  const features = arr<FR>("features");
  const acceptance = arr<AC>("acceptance");
  const screens = arr<SCR>("screens");
  const entities = arr<ENT>("dataModel");
  const apis = arr<API>("apis");
  const wbs = [...arr<WBS>("workBreakdown")].sort((a, b) => a.order - b.order);
  const tests = arr<TP>("testPlan");
  const assumptions = arr<string>("assumptions");
  const openQuestions = arr<string>("openQuestions");

  return (
    <div className="mt-6 space-y-6 text-sm">
      <p className="text-xs text-gray-500">{d.devIntro}</p>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-900">{d.secRequirements}</h2>
        {features.map((f) => (
          <div key={f.id} className="mb-4">
            <p className="font-medium text-gray-900">{f.id} · {f.title} <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{f.priority}</span></p>
            <p className="mt-0.5 text-gray-600">{f.description}</p>
            <ul className="mt-2 space-y-1">
              {acceptance.filter((a) => a.featureId === f.id).map((a) => (
                <li key={a.id} className="rounded border border-gray-200 p-2 text-xs text-gray-700">
                  <span className="font-mono text-gray-500">{a.id}</span> · <b>{d.given}</b> {a.given} · <b>{d.when}</b> {a.when} · <b>{d.then}</b> {a.then} · <span className="text-gray-500">{a.verifiedBy}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-900">{d.secScreens}</h2>
        {screens.length === 0 && <p className="text-gray-500">{d.none}</p>}
        {screens.map((s) => (
          <p key={s.id} className="mb-1 text-gray-700"><span className="font-mono text-gray-500">{s.id}</span> <code className="rounded bg-gray-100 px-1">{s.route}</code> — {s.purpose} <span className="text-xs text-gray-500">({s.components.join(", ")})</span></p>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-900">{d.secData}</h2>
        {entities.length === 0 && <p className="text-gray-500">{d.none}</p>}
        {entities.map((e) => (
          <p key={e.name} className="mb-1 text-gray-700"><b>{e.name}</b>: {e.fields.map((f) => `${f.name}:${f.type}${f.required ? "" : "?"}`).join(", ")} <span className="text-xs text-gray-500">· {e.ownership}</span></p>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-900">{d.secApi}</h2>
        {apis.length === 0 && <p className="text-gray-500">{d.none}</p>}
        {apis.map((a) => (
          <p key={a.id} className="mb-1 text-gray-700"><span className="font-mono text-gray-500">{a.id}</span> <code className="rounded bg-gray-100 px-1">{a.method} {a.path}</code> <span className="text-xs text-gray-500">· {a.auth} · {a.featureIds.join(", ")}</span></p>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-900">{d.secWbs}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-gray-700">
          {wbs.map((w) => (
            <li key={w.id}><span className="font-mono text-gray-500">{w.id}</span> {w.title} <span className="text-xs text-gray-500">· {w.dependsOn.length ? `← ${w.dependsOn.join(", ")}` : ""} · {w.acceptanceIds.join(", ")}</span></li>
          ))}
        </ol>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-gray-900">{d.secTests}</h2>
        {tests.length === 0 && <p className="text-gray-500">{d.none}</p>}
        {tests.map((p) => (
          <p key={p.acceptanceId} className="mb-1 text-gray-700"><span className="font-mono text-gray-500">{p.acceptanceId}</span> {p.kind === "browser" ? (p.steps ?? []).join(" → ") : p.testName}</p>
        ))}
      </section>

      {(assumptions.length > 0 || openQuestions.length > 0) && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold text-gray-900">{d.secAssumptions}</h2>
          <ul className="list-disc space-y-1 pl-5 text-gray-700">{assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          {openQuestions.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 font-medium text-gray-900">{d.secOpen}</h3>
              <ul className="list-disc space-y-1 pl-5 text-gray-700">{openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
