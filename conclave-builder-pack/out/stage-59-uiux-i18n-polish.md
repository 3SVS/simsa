> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 59 — UI/UX + I18N polish (베타 발송 전 제품 표면 정리)

core workflow는 Stage 55~57에서 라이브 검증됨. 이번 단계는 **새 기능 없이** dashboard를 "AI가 만든 내부툴" 느낌에서 **영어 기본 / 한국어 선택 가능한 차분한 SaaS 표면**으로 정리. backend/DB/enum/workflow 무변경.

커밋: `f1b8ecf`. dashboard 라이브: `https://conclave-dashboard.vercel.app`.

---

## 1. UI/UX 문제 진단 (Before)
- 화면이 기능 나열식, AI-generated / internal admin tool 느낌.
- 한국어 하드코딩 위주, 외국인 사용자 미지원(I18N 부재).
- 상태 표현(통과/안 맞음/확인 부족/결정 필요)이 제품 친화적 영어 라벨 없음.
- `/projects`에 페이지 자체 헤더가 또 있어 중복.

## 2. I18N 구조 (dictionary-first, 라우팅/라이브러리 변경 없음)
- `src/i18n/dictionary.mjs` (+ `.d.mts`): EN/KO 사전 + 순수 헬퍼(`normalizeLocale` en fallback, `getDictionary`, `statusLabel`, `statusDescription`, `readStoredLocale`/`writeStoredLocale`). **순수 함수 → Node20 CI 테스트 가능**.
- `src/i18n/I18nProvider.tsx`: client context + `useI18n()`. 기본 `en`, localStorage(`conclave:locale`) 영속, `<html lang>` 동기화. provider 밖에서도 기본 사전 반환(leaf 안전).
- next-intl 미도입, URL locale prefix 없음(spec 지침). 대규모 구조 변경 없음.

## 3. language toggle
- `src/components/LanguageToggle.tsx`: EN/KO 세그먼트 토글, `AppHeader` 우측 배치, localStorage 영속.
- `src/components/AppHeader.tsx`: 글로벌 상단 바(wordmark + tagline + toggle), root layout에 1회.

## 4. 변경한 주요 화면 / copy
- **root layout**: 글로벌 AppHeader + I18nProvider, metadata 영어화("Conclave — Acceptance workspace for AI-built software").
- **project nav**: `ProjectShell`(client)로 분리 — nav 라벨 i18n + active 강조, 서버 nav 대체.
- **상태 라벨(제품 친화 + 다국어)**: passed→**Passed**, failed→**Issue found**, inconclusive→**Not verified**, needs_decision→**Needs decision** (KO: 통과/안 맞음/확인 부족/결정 필요). `StatusBadge`(client화) + 신규 `StatusText`로 리뷰 결과 페이지의 백엔드 한글 `userLabel` 3곳 대체.
- **projects 홈**: 제목/부제/빈 상태/CTA/통계 라벨 i18n, 중복 헤더 제거.
- 상태 설명 문구(EN: "The PR appears to satisfy this item." 등) 사전에 포함.

## 5. 용어 변경 (UI label/copy layer만; 내부 enum 불변)
| 기존 | 변경(EN) |
|------|----------|
| 제품 설명서 | Product brief (nav) |
| 확인 항목/요구사항 | Acceptance items |
| FAIL | Issue found |
| INCONCLUSIVE | Not verified |
| NEEDS_DECISION | Needs decision |
| Fix Pack | Fix instructions (dict, fix.title) |
| 다시 확인 | Re-run review |
| 이전/최신 비교 | Compare runs / Improved·Still open·New issue·Unchanged |

## 6. 시각적 polish
- 글로벌 헤더(sticky, backdrop), 차분한 neutral, action color 제한, red는 실제 문제(failed)만.
- nav active 상태 강조, projects 빈 상태 카드(dashed) 추가, 통계 라벨 wrap 정리.

## 7. 남은 known issues (의도적 범위 밖 — Stage 60 후보)
- 깊은 화면별 한글 copy는 유지: `idea/spec/items/checks/fixes/export/settings` 본문, github 페이지의 패널/섹션 설명·버튼 다수, `admin/*`, run-status 라벨 맵(`RUN_STATUS_LABEL`). → 핵심 flow(헤더/nav/상태/홈/리뷰결과 라벨) 우선 처리 후, 나머지는 점진 사전화.
- `MockUserBadge`("GitHub 연결 예정") 등 mock 잔재 copy.
- 디자인 시스템(공통 PageHeader/EmptyState/Button variants)은 일부만 도입(AppHeader/ProjectShell/StatusText). 전면 컴포넌트화는 보류.

## 8. 수정한 파일 / 커밋 (`f1b8ecf`)
- 신규: `i18n/dictionary.mjs`·`.d.mts`, `i18n/I18nProvider.tsx`, `components/{LanguageToggle,AppHeader,ProjectShell,StatusText}.tsx`, `test/i18n.test.mjs`
- 변경: `components/StatusBadge.tsx`, `app/layout.tsx`, `app/projects/page.tsx`, `app/projects/[id]/layout.tsx`, `app/projects/[id]/github/page.tsx`, `.eslintrc.json`(.d.mts ignore)

## 9. test / typecheck / build
- dashboard **76/76**(i18n 9 신규 포함), typecheck **53/53**, build **29/29**, lint 통과(pre-push verify green).

## 10. live deployment / verification (완료, 2026-06-18)
- Vercel 재배포: main `99bd37f` → `https://conclave-dashboard.vercel.app` READY, alias 갱신.
- **EN 기본 SSR 확인**: `/projects` HTML에 글로벌 헤더 "Conclave" + tagline "Acceptance workspace for AI-built software"(영어로 서버 렌더).
- **사전/토글 번들 반영**: JS 청크에 "Issue found"·"Not verified"·"Needs decision"·"Language"·"Acceptance items"·"New project" 모두 포함(EN/KO 사전 + LanguageToggle 배포됨).
- **레이아웃 정상**: `/projects`·`/projects/new`·`/projects/:id/github`·`/projects/:id/settings` 모두 HTTP 200, 깨짐 없음.
- ★육안 1회(Bae): 우측 상단 EN/KO 토글로 한↔영 전환 + 새로고침 시 선택 유지 확인 권장.

## 11. Stage 60 전 결정 필요한 점
1. **Vercel 재배포** — 위 UI를 라이브에 반영(토큰 필요). 배포 후 EN 기본 + KO 토글 육안 1회.
2. 남은 화면 사전화 범위(7번) — 베타 발송 전 어디까지 할지.
3. (운영) Vercel 토큰 revoke + Git 연결 / `3SVS` org OAuth 앱 승인.
4. 보류: private repo, OAuth scope, actual debit.
