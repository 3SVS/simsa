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
pnpm dev          # wrangler dev (로컬 D1)
```

## 이번 버전에서 하지 않는 것
로그인·결제·이메일 발송. 필요하면 지시서에 "이번 버전 제외"로 기록됩니다.
