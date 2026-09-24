/**
 * workspace/render-dev-spec.ts — T0 개발 지시서 렌더러 (SI 티어 A3, D-1·D-11).
 *
 * DevSpec(JSON 정본) → 사람이 읽는 마크다운 묶음. 결정론·LLM 없음. 빌더 팩(export.ts)이
 * 이 파일들을 `simsa-build-pack/dev-spec/` 아래에 흡수한다(D-1 "빌더 팩은 T0의 렌더링").
 *
 * 규칙:
 *  - EN/KO **같은 파일 목록·같은 순서** (D-11 동등성 — 테스트로 고정).
 *  - 개수는 개수일 뿐 점수가 아니다. 판정 어휘를 만들지 않는다(PRD §5).
 *  - README 첫 화면은 초보자 4줄(D-17). 상세는 그 아래 파일들 — "개발자용".
 */
import type { DevSpec } from "./dev-spec.js";
import { summarizeForBeginner } from "./dev-spec.js";

export type RenderLocale = "ko" | "en";
export type RenderedFile = { path: string; content: string };

export const DEV_SPEC_DIR = "dev-spec";

const T = {
  ko: {
    readme: "개발 지시서",
    what: "무엇을 만들지",
    screens: "화면",
    entities: "저장하는 것",
    excluded: "이번엔 안 만드는 것",
    none: "(없음)",
    toc: "문서 구성",
    forDevs: "아래 문서는 개발자(또는 개발 AI)용입니다. 그대로 넘겨도 됩니다.",
    source: { generated: "브리프에서 생성", inferred: "기존 앱에서 역추론 — 사용자가 확인한 항목만 확정", manual: "직접 편집" },
    req: "요구사항",
    feature: "기능",
    priority: { must: "필수", should: "권장", could: "선택" },
    ac: "수용 기준",
    given: "전제", when: "행동", then: "결과", verifiedBy: "확인 방법",
    vb: { build: "빌드·기동", test: "자동 테스트", browser: "브라우저 관찰", human: "사람 판단" },
    screensDoc: "화면 정의",
    route: "경로", purpose: "목적", components: "구성요소", states: "상태별 문구", entry: "진입", exit: "이탈", features: "관련 기능",
    st: { empty: "비었을 때", loading: "불러오는 중", error: "오류", success: "성공" },
    data: "데이터 모델",
    field: "필드", type: "타입", required: "필수", def: "기본값", relations: "관계", ownership: "소유·열람",
    api: "API 계약",
    request: "요청", response: "응답", errors: "오류", auth: "인증",
    authv: { none: "없음", user: "로그인 사용자", admin: "관리자" },
    nfr: "비기능 요구",
    nfrk: { performance: "성능", security: "보안", accessibility: "접근성", i18n: "다국어", cost: "비용", other: "기타" },
    wbs: "작업 분해",
    order: "순서", dependsOn: "선행", done: "완료 조건(수용 기준)",
    test: "테스트 계획",
    steps: "단계", testName: "테스트 이름",
    assumptions: "가정",
    open: "아직 결정이 필요한 것",
    yes: "예", no: "아니오",
  },
  en: {
    readme: "Development spec",
    what: "What we're building",
    screens: "Screens",
    entities: "Things we store",
    excluded: "Not in this version",
    none: "(none)",
    toc: "Documents",
    forDevs: "The documents below are for a developer (or a coding AI). Hand them over as-is.",
    source: { generated: "generated from the brief", inferred: "inferred from an existing app — only user-confirmed items are final", manual: "edited by hand" },
    req: "Requirements",
    feature: "Feature",
    priority: { must: "must", should: "should", could: "could" },
    ac: "Acceptance criteria",
    given: "Given", when: "When", then: "Then", verifiedBy: "Verified by",
    vb: { build: "build/boot", test: "automated test", browser: "browser observation", human: "human judgment" },
    screensDoc: "Screens",
    route: "Route", purpose: "Purpose", components: "Components", states: "State copy", entry: "Entry from", exit: "Exit to", features: "Features",
    st: { empty: "Empty", loading: "Loading", error: "Error", success: "Success" },
    data: "Data model",
    field: "Field", type: "Type", required: "Required", def: "Default", relations: "Relations", ownership: "Ownership",
    api: "API contracts",
    request: "Request", response: "Response", errors: "Errors", auth: "Auth",
    authv: { none: "none", user: "signed-in user", admin: "admin" },
    nfr: "Non-functional requirements",
    nfrk: { performance: "Performance", security: "Security", accessibility: "Accessibility", i18n: "i18n", cost: "Cost", other: "Other" },
    wbs: "Work breakdown",
    order: "Order", dependsOn: "Depends on", done: "Done when (acceptance ids)",
    test: "Test plan",
    steps: "Steps", testName: "Test name",
    assumptions: "Assumptions",
    open: "Still to decide",
    yes: "yes", no: "no",
  },
} as const;

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const list = (xs: readonly string[], none: string) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : none);

function readme(spec: DevSpec, locale: RenderLocale, files: string[]): string {
  const t = T[locale];
  const s = summarizeForBeginner(spec);
  const lines = [
    `# ${t.readme} — ${spec.brief.productName || s.what}`,
    "",
    `**${t.what}:** ${s.what}`,
    `**${t.screens}:** ${s.screenCount}`,
    `**${t.entities}:** ${s.entityCount}`,
    `**${t.excluded}:** ${s.excluded.length ? s.excluded.join(" · ") : t.none}`,
    "",
    `_${t.source[spec.meta.source]} · ${spec.meta.generatedAt}_`,
    "",
    `## ${t.toc}`,
    "",
    t.forDevs,
    "",
    ...files.map((f) => `- \`${f}\``),
  ];
  return lines.join("\n");
}

function requirements(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.req}`, ""];
  for (const f of spec.features) {
    out.push(`## ${f.id} · ${f.title} — ${t.priority[f.priority]}`, "", f.description, "");
    const acs = spec.acceptance.filter((a) => a.featureId === f.id);
    if (acs.length) {
      out.push(`| ${t.ac} | ${t.given} | ${t.when} | ${t.then} | ${t.verifiedBy} |`, "|---|---|---|---|---|");
      for (const a of acs) out.push(`| ${a.id} | ${esc(a.given)} | ${esc(a.when)} | ${esc(a.then)} | ${t.vb[a.verifiedBy]} |`);
      out.push("");
    }
  }
  return out.join("\n");
}

function screens(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.screensDoc}`, ""];
  if (spec.screens.length === 0) out.push(t.none);
  for (const s of spec.screens) {
    out.push(`## ${s.id} · \`${s.route}\``, "", s.purpose, "");
    out.push(`- **${t.components}:** ${s.components.join(", ") || t.none}`);
    // 기본 4상태는 번역 라벨, 화면 고유 상태(locked·merged…)는 키 그대로.
    const isKnown = (k: string): k is keyof typeof t.st => k in t.st;
    const states = Object.entries(s.states)
      .filter(([, v]) => v)
      .map(([k, v]) => `${isKnown(k) ? t.st[k] : k}: ${v}`);
    out.push(`- **${t.states}:** ${states.join(" / ") || t.none}`);
    out.push(`- **${t.entry}:** ${s.entryFrom.join(", ") || t.none} · **${t.exit}:** ${s.exitTo.join(", ") || t.none}`);
    out.push(`- **${t.features}:** ${s.featureIds.join(", ") || t.none}`, "");
  }
  return out.join("\n");
}

function dataModel(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.data}`, ""];
  if (spec.dataModel.length === 0) out.push(t.none);
  for (const e of spec.dataModel) {
    out.push(`## ${e.name}`, "", `| ${t.field} | ${t.type} | ${t.required} | ${t.def} |`, "|---|---|---|---|");
    for (const f of e.fields) out.push(`| ${esc(f.name)} | ${esc(f.type)} | ${f.required ? t.yes : t.no} | ${f.default !== undefined ? esc(f.default) : ""} |`);
    out.push("");
    out.push(`- **${t.relations}:** ${e.relations.map((r) => `${r.to} (${r.kind})`).join(", ") || t.none}`);
    out.push(`- **${t.ownership}:** ${e.ownership}`, "");
  }
  return out.join("\n");
}

function apis(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.api}`, ""];
  if (spec.apis.length === 0) out.push(t.none);
  for (const a of spec.apis) {
    out.push(`## ${a.id} · \`${a.method} ${a.path}\``, "");
    out.push(`- **${t.auth}:** ${t.authv[a.auth]}`);
    if (a.request) out.push(`- **${t.request}:** ${a.request}`);
    if (a.response) out.push(`- **${t.response}:** ${a.response}`);
    out.push(`- **${t.errors}:** ${a.errors.join(", ") || t.none}`);
    out.push(`- **${t.features}:** ${a.featureIds.join(", ") || t.none}`, "");
  }
  return out.join("\n");
}

function nonFunctional(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.nfr}`, ""];
  if (spec.nonFunctional.length === 0) out.push(t.none);
  for (const n of spec.nonFunctional) out.push(`- **${t.nfrk[n.kind]}:** ${n.requirement}`);
  return out.join("\n");
}

function workBreakdown(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.wbs}`, "", `| ${t.order} | WBS | | ${t.dependsOn} | ${t.done} |`, "|---|---|---|---|---|"];
  for (const w of [...spec.workBreakdown].sort((a, b) => a.order - b.order)) {
    out.push(`| ${w.order} | ${w.id} | ${esc(w.title)} | ${w.dependsOn.join(", ") || "—"} | ${w.acceptanceIds.join(", ")} |`);
  }
  return out.join("\n");
}

function testPlan(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  const out: string[] = [`# ${t.test}`, ""];
  if (spec.testPlan.length === 0) out.push(t.none);
  for (const p of spec.testPlan) {
    const ac = spec.acceptance.find((a) => a.id === p.acceptanceId);
    out.push(`## ${p.acceptanceId}${ac ? ` — ${esc(ac.then)}` : ""}`, "");
    if (p.kind === "browser") out.push(`**${t.steps}:**`, "", ...p.steps.map((s, i) => `${i + 1}. ${s}`), "");
    else out.push(`**${t.testName}:** \`${p.testName}\``, "");
  }
  return out.join("\n");
}

function assumptions(spec: DevSpec, locale: RenderLocale): string {
  const t = T[locale];
  return [`# ${t.assumptions}`, "", list(spec.assumptions, t.none), "", `# ${t.open}`, "", spec.openQuestions.length ? spec.openQuestions.map((q) => `- [ ] ${q}`).join("\n") : t.none].join("\n");
}

/** 파일 목록은 로케일과 무관하게 고정 — D-11 동등성의 근거. */
export const DEV_SPEC_FILES = [
  "README.md",
  "01-requirements.md",
  "02-screens.md",
  "03-data-model.md",
  "04-api.md",
  "05-non-functional.md",
  "06-work-breakdown.md",
  "07-test-plan.md",
  "08-assumptions.md",
  "dev-spec.json",
] as const;

/** DevSpec → 파일 묶음. `prefix`는 팩 안의 위치(기본 `dev-spec/`). */
export function renderDevSpecFiles(spec: DevSpec, locale: RenderLocale, prefix = `${DEV_SPEC_DIR}/`): RenderedFile[] {
  const names = [...DEV_SPEC_FILES];
  const body: Record<(typeof DEV_SPEC_FILES)[number], string> = {
    "README.md": readme(spec, locale, names.slice(1)),
    "01-requirements.md": requirements(spec, locale),
    "02-screens.md": screens(spec, locale),
    "03-data-model.md": dataModel(spec, locale),
    "04-api.md": apis(spec, locale),
    "05-non-functional.md": nonFunctional(spec, locale),
    "06-work-breakdown.md": workBreakdown(spec, locale),
    "07-test-plan.md": testPlan(spec, locale),
    "08-assumptions.md": assumptions(spec, locale),
    "dev-spec.json": JSON.stringify(spec, null, 2),
  };
  return names.map((n) => ({ path: `${prefix}${n}`, content: body[n] }));
}
