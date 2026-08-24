/**
 * source-evidence.test.mjs — AF-3 증거 수집 (설계 D-3).
 *
 * 고정하는 계약:
 *   ① 스택은 **결정론적**으로 읽는다 — 확인 가능한 사실을 LLM 추측에 맡기지 않는다
 *   ② 증거가 없으면 **빈 아이디어**를 돌려준다 → 호출부가 생성을 건너뛴다.
 *      빈 증거로 LLM을 부르면 의도를 지어내고, 잘못된 의도는 잘못된 기준이 된다
 *   ③ 읽기 실패는 던지지 않는다 — 빈 증거이지 예외가 아니다
 *   ④ 무엇을 읽었는지 남긴다(readSources) — 초안이 빈약할 때 이유를 설명하려고
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  stackFromPackageJson,
  hostingFromHeaders,
  textFromHtml,
  evidenceFromRepo,
  evidenceFromWebsite,
  composeIdeaFromEvidence,
} = await import("../dist/workspace/source-evidence.js");

describe("스택은 의존성에서 결정론적으로 읽는다 (①)", () => {
  it("Supabase·Next·Tailwind를 잡는다", () => {
    const s = stackFromPackageJson(
      JSON.stringify({ dependencies: { next: "15", "@supabase/supabase-js": "2" }, devDependencies: { tailwindcss: "4" } }),
    );
    assert.equal(s.data, "supabase");
    assert.deepEqual(s.tools, ["Next.js", "Tailwind CSS"]);
  });

  it("Firebase 사용자에게 Supabase를 붙이지 않는다 (스택 불가지)", () => {
    const s = stackFromPackageJson(JSON.stringify({ dependencies: { firebase: "10" } }));
    assert.equal(s.data, "firebase");
  });

  it("★확신할 수 없으면 비운다 — 없는 것을 채우지 않는다", () => {
    const s = stackFromPackageJson(JSON.stringify({ dependencies: { lodash: "4" } }));
    assert.equal(s.hosting, undefined);
    assert.equal(s.data, undefined);
    assert.deepEqual(s.tools, []);
  });

  it("깨진 JSON·null에도 던지지 않는다 (③)", () => {
    assert.deepEqual(stackFromPackageJson("{not json"), { tools: [] });
    assert.deepEqual(stackFromPackageJson(null), { tools: [] });
  });
});

describe("호스팅은 헤더·도메인에서 읽는다 (①)", () => {
  it("벤더가 붙인 헤더를 믿는다", () => {
    assert.equal(hostingFromHeaders(new Headers({ "x-vercel-id": "abc" }), "https://x.com"), "vercel");
    assert.equal(hostingFromHeaders(new Headers({ "x-nf-request-id": "abc" }), "https://x.com"), "netlify");
  });

  it("헤더가 없으면 도메인으로", () => {
    assert.equal(hostingFromHeaders(new Headers(), "https://my-app.vercel.app/"), "vercel");
    assert.equal(hostingFromHeaders(new Headers(), "https://my-app.netlify.app/"), "netlify");
  });

  it("★단서가 없으면 단정하지 않는다", () => {
    assert.equal(hostingFromHeaders(new Headers(), "https://golfnow.com/"), undefined);
    assert.equal(hostingFromHeaders(new Headers(), "not a url"), undefined);
  });
});

describe("HTML에서 사람이 읽는 텍스트만 뽑는다", () => {
  const html = `<html><head><title>골프 예약</title>
    <meta name="description" content="주말 티타임을 한 번에 찾아줍니다">
    <style>.a{color:red}</style></head>
    <body><script>var x=1</script><h1>지금 예약하기</h1><h2>가까운 골프장</h2></body></html>`;

  it("★한글 제목·설명·헤딩을 뽑는다 (Rule 6)", () => {
    const { title, text } = textFromHtml(html);
    assert.equal(title, "골프 예약");
    assert.match(text, /주말 티타임/);
    assert.match(text, /지금 예약하기/);
  });

  it("script·style 내용이 새어 나오지 않는다", () => {
    const { text } = textFromHtml(html);
    assert.ok(!text.includes("var x"), "스크립트가 의도로 읽히면 안 된다");
    assert.ok(!text.includes("color:red"));
  });

  it("아무 구조가 없으면 본문에서라도 뽑는다", () => {
    const { text } = textFromHtml("<html><body>그냥 텍스트만 있는 페이지</body></html>");
    assert.match(text, /그냥 텍스트만/);
  });
});

describe("저장소 증거 (③④)", () => {
  const okText = (body) => new Response(body, { status: 200 });
  const notFound = () => new Response("", { status: 404 });

  it("README 제목을 이름으로 쓴다 — package name보다 사람 말에 가깝다", async () => {
    const ev = await evidenceFromRepo("3SVS/simsa", async (url) => {
      if (url.endsWith("README.md")) return okText("# 심사\n\n비개발자를 위한 검수 도구입니다.");
      if (url.endsWith("package.json")) return okText(JSON.stringify({ name: "simsa-core", dependencies: { next: "15" } }));
      return notFound();
    });
    assert.equal(ev.title, "심사");
    assert.match(ev.text, /비개발자를 위한/);
    assert.deepEqual(ev.readSources, ["README", "package.json"]);
    assert.deepEqual(ev.stack.tools, ["Next.js"]);
  });

  it("README가 없으면 package name으로 물러난다", async () => {
    const ev = await evidenceFromRepo("o/r", async (url) =>
      url.endsWith("package.json") ? okText(JSON.stringify({ name: "my-app" })) : notFound(),
    );
    assert.equal(ev.title, "my-app");
    assert.deepEqual(ev.readSources, ["package.json"]);
  });

  it("★아무것도 못 읽으면 빈 증거 — 던지지 않는다", async () => {
    const ev = await evidenceFromRepo("o/r", async () => notFound());
    assert.equal(ev.text, "");
    assert.equal(ev.title, undefined);
    assert.deepEqual(ev.readSources, []);
  });

  it("네트워크 예외도 빈 증거로 흡수한다", async () => {
    const ev = await evidenceFromRepo("o/r", async () => {
      throw new Error("dns");
    });
    assert.equal(ev.text, "");
  });
});

describe("앱 주소 증거", () => {
  it("페이지를 읽고 호스팅을 함께 잡는다", async () => {
    const ev = await evidenceFromWebsite("https://my-app.vercel.app/", async () =>
      new Response("<title>내 앱</title><h1>환영합니다</h1>", {
        status: 200,
        headers: { "x-vercel-id": "1" },
      }),
    );
    assert.equal(ev.title, "내 앱");
    assert.equal(ev.stack.hosting, "vercel");
    assert.deepEqual(ev.readSources, ["page"]);
  });

  it("★못 읽어도(404) 던지지 않고 빈 증거 — 호스팅은 헤더에서 여전히 읽는다", async () => {
    const ev = await evidenceFromWebsite("https://my-app.vercel.app/", async () =>
      new Response("", { status: 404, headers: { "x-vercel-id": "1" } }),
    );
    assert.equal(ev.text, "");
    assert.deepEqual(ev.readSources, []);
    assert.equal(ev.stack.hosting, "vercel");
  });
});

describe("★증거가 없으면 빈 아이디어를 돌려준다 (②) — 지어내지 않는 지점", () => {
  const base = { kind: "github_repo", reference: "o/r", stack: { tools: [] }, readSources: [] };

  it("텍스트도 제목도 없으면 빈 문자열", () => {
    assert.equal(composeIdeaFromEvidence({ ...base, text: "" }), "");
  });

  it("빈 껍데기는 여전히 걸러낸다", () => {
    assert.equal(composeIdeaFromEvidence({ ...base, text: "TODO" }), "");
    assert.equal(composeIdeaFromEvidence({ ...base, text: "WIP" }), "");
  });

  it("★짧은 한국어 설명을 걸러내지 않는다 (Rule 6) — 영어 기준 임계의 함정", () => {
    // 19자짜리 완전한 한국어 설명. 30자 임계였을 때 이게 통째로 버려졌다.
    const idea = composeIdeaFromEvidence({ ...base, text: "주말 티타임을 찾아주는 서비스입니다" });
    assert.ok(idea.length > 0, "멀쩡한 한국어 설명이 근거로 인정돼야 한다");
    assert.match(idea, /티타임/);
  });

  it("제목만 있어도 근거로 친다", () => {
    const idea = composeIdeaFromEvidence({ ...base, text: "", title: "골프 예약" });
    assert.ok(idea.length > 0);
    assert.match(idea, /골프 예약/);
  });

  it("★프롬프트가 '지어내지 말라'고 명시한다", () => {
    const idea = composeIdeaFromEvidence({ ...base, text: "이 앱은 주말 티타임을 찾아주는 서비스입니다." });
    assert.match(idea, /지어내지/);
    const en = composeIdeaFromEvidence({ ...base, text: "This app finds weekend tee times for golfers." }, "en");
    assert.match(en, /Do not invent/);
  });

  it("감지한 스택이 프롬프트에 실린다 — 초안이 사용자의 조합을 따라가도록", () => {
    const idea = composeIdeaFromEvidence({
      ...base,
      text: "주말 티타임을 찾아주는 서비스입니다. 지도에서 고를 수 있어요.",
      stack: { hosting: "vercel", data: "supabase", tools: ["Next.js"] },
    });
    assert.match(idea, /Next\.js/);
    assert.match(idea, /vercel/);
    assert.match(idea, /supabase/);
  });
});
