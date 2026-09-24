# SI 티어 Train B — B1: SimsaBuilder 컨테이너 (D-4 · D-6 · D-10).
#
# T1 빌드 잡의 실행 환경. Worker(apps/central-plane/src/builder-container.ts)가
# BUILDER Durable-Object 바인딩으로 잡 하나당 인스턴스 하나(`build-<jobId>`)를 띄운다.
# 여기서 유저 기획의 코드를 **설치·구현·빌드·테스트**하고(D-4: green 아니면 "완성" 금지),
# S 배포(Workers for Platforms)까지 간다 — 배포 단계는 B5에서 붙는다.
#
# 베이스: 인스펙터와 같은 playwright 이미지. 빌드 게이트의 마지막 단계가 실브라우저
# 테스트라서, 빌드 컨테이너가 브라우저를 갖는 것이 맞다. 태그는 inspector-container와
# tools/simsa-completion-loop-spike/package.json의 playwright 버전과 **일치**해야 한다
# (test/builder-invariants.test.mjs가 고정).
#
# 툴체인: node(베이스 내장) · pnpm · git · gh · wrangler. wrangler는 **S 배포용(우리 운영
# 토큰, 잡 페이로드로 전달 — 이미지에 굽지 않는다)**과 프로젝트 D1 마이그레이션용.
# D-6: vercel·netlify 같은 유저 배포 CLI는 **설치하지 않는다** — 워커 run_command
# allowlist(B4)와 함께 이중 차단. test/builder-invariants.test.mjs가 확인.
#
# 빌드 컨텍스트: repo 루트(wrangler.toml image_build_context = "../.."). CI의
# deploy-central-plane.yml이 wrangler deploy로 이미지를 빌드·푸시한다.
#
# IMAGE LAYOUT:
#   /builder/server.mjs       — HTTP 진입점(이 컨테이너의 유일한 API: /health · /selfcheck · POST /run)
#   /builder/builder-run.mjs  — 잡 실행 모듈(B1: 툴체인 자가점검; B3~B5에서 스캐폴드·구현·빌드·배포)
#   /var/lib/simsa-build      — 잡별 작업 디렉터리(휘발)
#
# RUNTIME: 잡 페이로드는 POST /run으로만 들어온다. 비밀(운영 토큰·LLM 키)은 페이로드로
# 잡 수명 동안만 메모리에 있다 — 이미지·디스크·로그에 남기지 않는다(D-16 불변식과 동일).

FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# git(스캐폴드 커밋·push) · gh(Simsa 조직 private 저장소 생성, B3) · ca-certificates(콜백 TLS)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# pnpm(템플릿 설치·빌드) · wrangler(S 배포 + 프로젝트 D1 마이그레이션). 메이저 고정.
RUN npm install -g pnpm@10 wrangler@4

WORKDIR /builder

COPY apps/central-plane/builder-container/package.json ./package.json
RUN npm install --no-package-lock --loglevel=error

COPY apps/central-plane/builder-container/server.mjs ./server.mjs
COPY apps/central-plane/builder-container/builder-run.mjs ./builder-run.mjs

# 잡별 작업 공간. pnpm store도 여기 아래(캐시는 인스턴스 수명 동안만).
RUN mkdir -p /var/lib/simsa-build && chmod 770 /var/lib/simsa-build

EXPOSE 8080

CMD ["node", "/builder/server.mjs"]
