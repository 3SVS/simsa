# Simsa hosted app (template)

이 저장소는 Simsa가 기획을 앱으로 만들 때 출발점으로 쓰는 템플릿입니다. Simsa가 대신 호스팅하며, 언제든 내 GitHub로 가져갈 수 있습니다.

## 구조
- `src/worker.ts` — API (Hono). 모든 API는 `/api/*`.
- `src/client/` — 화면 (React + Vite). 데이터는 `/api/*`로만.
- `migrations/` — DB 스키마 (D1, SQL 번호순). 코드에서 `CREATE TABLE` 금지.
- `wrangler.toml` — 실행 설정. `__SLUG__`·`__D1_ID__`는 빌드 잡이 채웁니다.

## 로컬에서 돌리기 (개발자용)
```
pnpm install
pnpm build        # vite build + worker 타입검사
pnpm test         # 최소 스모크(빌드 산출물 · /api/health) — build 다음에
pnpm dev          # wrangler dev (로컬 D1)
```

Simsa 빌드 잡은 이 순서(`pnpm install --frozen-lockfile` → `pnpm run build` → `pnpm test`)가 전부 통과해야 다음 단계로 갑니다.
의존성은 lockfile로 고정입니다(빌드 잡이 새 패키지를 받지 않습니다). `test/smoke.test.mjs`·`package.json`·`pnpm-lock.yaml`·
`pnpm-workspace.yaml`·`wrangler.toml`·`.gitignore`는 플랫폼이 관리하므로 빌드 잡이 템플릿 원본으로 되돌립니다.

## 이번 버전에서 하지 않는 것
로그인·결제·이메일 발송. 필요하면 지시서에 "이번 버전 제외"로 기록됩니다.
