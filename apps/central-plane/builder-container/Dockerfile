# SI 티어 Train B — SimsaBuilder 컨테이너 (D-4 · D-6 · D-10).
#
# T1 빌드 잡의 실행 환경. Worker(apps/central-plane/src/builder-container.ts)가
# BUILDER Durable-Object 바인딩으로 잡 하나당 인스턴스 하나(`build-<jobId>`)를 띄운다.
# 여기서 유저 기획의 코드를 **설치·구현·빌드·테스트**하고(D-4: green 아니면 "완성" 금지),
# S 배포(Workers for Platforms)까지 간다 — 단계는 B-5b-1~5에서 하나씩 붙는다(지금은 빌드 게이트까지 —
# push·배포는 Worker가 한다, S3).
#
# 베이스: 인스펙터와 같은 playwright 이미지. 빌드 게이트의 마지막 단계가 실브라우저
# 테스트라서, 빌드 컨테이너가 브라우저를 갖는 것이 맞다. 태그는 inspector-container와
# tools/simsa-completion-loop-spike/package.json의 playwright 버전과 **일치**해야 한다
# (test/builder-invariants.test.mjs가 고정).
#
# 툴체인: node(베이스 내장) · pnpm · git · gh · wrangler. [정정 2026-10-01 B-5b S1] 운영 토큰은 더 이상 잡 페이로드로
# 오지 않는다 — S 배포·D1 마이그레이션은 Worker가 한다. wrangler는 자가점검 항목으로만 남아 있다.
# D-6: vercel·netlify 같은 유저 배포 CLI는 **설치하지 않는다** — 워커 run_command
# allowlist(B4)와 함께 이중 차단. test/builder-invariants.test.mjs가 확인.
#
# B-5b-0 — 빌드 에이전트(packages/agent-worker: runBuildLoop · build-policy · #551 OpenAI 다중 턴 폴백)를
# **이미지 안에서** 빌드한다. inspector-container가 central-plane src를 이미지 안에서 tsc로 컴파일하는
# 선례와 같은 원칙(레포가 싣는 바로 그 소스)이고, npm 레지스트리에서 @simsa/*를 받지 않는다
# (노트북 publish·release.yml 경로를 쓰지 않는다). 모노레포 전체가 아니라 agent-worker와 그 의존성
# (@simsa/core)만 lockfile 고정으로 설치·빌드한다 — playwright 베이스가 이미 ~2 GB라 전체 워크스페이스
# node_modules는 싣지 않는다. 패키지 폴더를 통째로 COPY하지 않고 소스·매니페스트만 복사한다: 배포
# 워크플로(deploy-central-plane.yml)는 `pnpm install` 뒤에 이미지를 빌드하므로 빌드 컨텍스트에
# 호스트의 node_modules·dist가 있다 — 그게 이미지로 새면 깨진 링크·옛 산출물이 섞인다.
#
# 빌드 컨텍스트: repo 루트(wrangler.toml image_build_context = "../.."). CI의
# deploy-central-plane.yml이 wrangler deploy로 이미지를 빌드·푸시하고, container-images.yml이 PR마다
# 빌드 + /selfcheck 스모크를 돌린다(agentWorker.ok · template.ok 확인).
#
# IMAGE LAYOUT:
#   /builder/server.mjs                     — HTTP 진입점(이 컨테이너의 유일한 API: /health · /selfcheck · POST /run)
#   /builder/builder-run.mjs                — 잡 실행 모듈(자가점검 · kind=build 상태 머신)
#   /builder/builder-work.mjs               — B-5b-2·3: WBS 구현(runBuildLoop·프록시 클라이언트·작업 폴더 실행기) · 빌드 게이트 부품
#   /home/simsa-run/.pnpm-store             — 템플릿 의존성(이미지 빌드 때 pnpm fetch) — 잡 안의 설치는 오프라인
#   /builder/ws/                            — 축소 pnpm 워크스페이스(core + agent-worker, lockfile 고정)
#   /builder/ws/packages/agent-worker/dist/ — builder-run.mjs AGENT_WORKER_ENTRY가 import하는 곳
#   /builder/templates/simsa-hosted-app/    — S 모드 템플릿(builder-run.mjs TEMPLATE_DIR) — 잡마다 작업 폴더로 복사
#   /var/lib/simsa-build                    — 잡별 작업 디렉터리(휘발, 잡이 끝나면 지운다)
#
# RUNTIME: 잡 페이로드는 POST /run으로만 들어온다. B-5b S1부터 비밀(운영 토큰·LLM 키)은 페이로드에 없다 — 이 잡에만 통하는
# jobToken 하나가 서버(root) 메모리에만 있고, 생성 코드는 샌드박스 사용자(simsa-run)로 돈다(B-5b-2). 이미지·디스크·로그에 남기지 않는다.

FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# git(스캐폴드 커밋·push) · gh(Simsa 조직 private 저장소 생성, B3) · ca-certificates(콜백 TLS)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# pnpm(템플릿 설치·빌드) · wrangler(S 배포 + 프로젝트 D1 마이그레이션). wrangler는 메이저 고정.
# pnpm은 템플릿 package.json의 packageManager(pnpm@10.34.5)와 **정확히 같은 버전**(B-5b-3) — 다르면 pnpm이 잡 안에서
# 그 버전을 레지스트리에서 받아 전환한다(오프라인 설치가 깨진다). test/train-b-b5b2-gate.test.mjs가 두 값을 비교한다.
RUN npm install -g pnpm@10.34.5 wrangler@4

# B-5b-2: 생성 코드를 돌리는 샌드박스 사용자. 서버(root)와 uid가 달라 서버 메모리(/proc/<pid>/mem)·환경(/proc/<pid>/environ)의
# jobToken을 읽을 수 없고, 작업 폴더 밖(/builder 서버 코드)에 쓸 수 없다. builder-work.mjs sandboxFromEnv가 이 ENV를 읽는다
# (설정이 있는데 쓸 수 없으면 빌드는 failed(scaffolding, sandbox_unavailable) — 조용히 root로 돌지 않는다).
RUN groupadd --gid 10001 simsa-run \
 && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/simsa-run --shell /usr/sbin/nologin simsa-run
ENV SIMSA_SANDBOX_UID=10001 \
    SIMSA_SANDBOX_GID=10001 \
    SIMSA_SANDBOX_HOME=/home/simsa-run \
    SIMSA_PNPM_STORE_DIR=/home/simsa-run/.pnpm-store

# ── B-5b-0: 빌드 에이전트(core + agent-worker)를 이미지 안에서 빌드 ─────────────────────────────
WORKDIR /builder/ws
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/core/scripts ./packages/core/scripts
COPY packages/agent-worker/package.json packages/agent-worker/tsconfig.json ./packages/agent-worker/
COPY packages/agent-worker/src ./packages/agent-worker/src
# --frozen-lockfile: lockfile이 매니페스트와 어긋나면 이미지 빌드가 실패한다(배포 전에 PR CI에서 잡힌다).
# 빌드 끝에 **실제로 import**해 본다 — 경로·export가 틀리면 이미지가 만들어지지 않는다.
RUN pnpm install --frozen-lockfile --filter "@simsa/agent-worker..." \
 && pnpm --filter "@simsa/agent-worker..." run build \
 && node -e "import('/builder/ws/packages/agent-worker/dist/index.js').then((m) => { if (typeof m.runBuildLoop !== 'function') { console.error('runBuildLoop missing'); process.exit(1); } console.log('agent-worker ok'); }).catch((e) => { console.error(e); process.exit(1); })"

WORKDIR /builder

COPY apps/central-plane/builder-container/package.json ./package.json
RUN npm install --no-package-lock --loglevel=error

# S 모드 템플릿(D-5) — kind=build의 scaffolding 단계가 잡마다 작업 폴더로 복사한다.
# 템플릿은 pnpm 워크스페이스 밖이라 CI·배포 체크아웃에는 설치물이 없다. 로컬 작업 트리(`pnpm ship`)의
# node_modules·dist·.wrangler와 비밀 파일(.dev.vars·.env*·.npmrc·.envrc·키)은 루트 .dockerignore가 빌드 컨텍스트에서
# 빼고(wrangler는 Dockerfile을 stdin으로 넘겨 Dockerfile 옆 ignore 파일을 쓰지 않는다), 스캐폴드 복사
# (builder-run.mjs isScaffoldExcluded — dotfile 기본 거부)가 한 번 더 거른다. container-images.yml이 미끼로 확인.
COPY templates/simsa-hosted-app /builder/templates/simsa-hosted-app

# B-5b-3: 템플릿 의존성을 **이미지 빌드 때** 샌드박스 사용자의 pnpm 저장소로 미리 받는다(lockfile 고정). 잡 안의 설치는
# `pnpm install --frozen-lockfile --offline --store-dir <이 저장소>` — 레지스트리에 닿지 않는다(builder-work.mjs installArgs).
# fetch가 esbuild·workerd 빌드 스크립트(pnpm-workspace.yaml allowBuilds)를 한 번 돌려 결과를 저장소의 side-effects 캐시에 둔다.
# 받는 데 쓴 임시 폴더는 지운다(템플릿 폴더에는 node_modules를 만들지 않는다).
COPY templates/simsa-hosted-app/package.json templates/simsa-hosted-app/pnpm-lock.yaml templates/simsa-hosted-app/pnpm-workspace.yaml /tmp/simsa-prefetch/
RUN chown -R simsa-run:simsa-run /tmp/simsa-prefetch
USER simsa-run
RUN cd /tmp/simsa-prefetch && HOME=/home/simsa-run pnpm fetch --store-dir /home/simsa-run/.pnpm-store
USER root
RUN rm -rf /tmp/simsa-prefetch && test -d /home/simsa-run/.pnpm-store && test "$(stat -c %u /home/simsa-run/.pnpm-store)" = "10001"

COPY apps/central-plane/builder-container/server.mjs ./server.mjs
COPY apps/central-plane/builder-container/builder-run.mjs ./builder-run.mjs
COPY apps/central-plane/builder-container/builder-work.mjs ./builder-work.mjs

# 잡별 작업 공간. 서버(root)가 잡 폴더를 만들고 샌드박스 사용자에게 넘긴다(chownTree) — 사용자는 뿌리를 지나갈 수만 있다(750).
RUN mkdir -p /var/lib/simsa-build && chown root:simsa-run /var/lib/simsa-build && chmod 750 /var/lib/simsa-build

EXPOSE 8080

CMD ["node", "/builder/server.mjs"]
