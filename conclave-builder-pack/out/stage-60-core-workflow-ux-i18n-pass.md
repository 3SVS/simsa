# Stage 60 — Core workflow UX + I18N pass (Linear-grade neutral redesign)

Stage 59 i18n 기반 위에, Bae가 고른 **Linear형 미니멀 / neutral-first / 차분한 딥그린 액센트 / B2B acceptance workspace** 방향으로 비주얼을 재정의하고 핵심 GitHub flow의 copy/i18n을 심화. 새 기능/엔드포인트/마이그레이션/enum 변경 없음.

커밋: `e64ff21`. 디자인 방향(확정): Linear 미니멀, 라이트 기본(다크는 추후), 보라/인디고 금지 → 딥그린, neutral(zinc), thin border, 의미있는 곳만 상태색.

---

## 1. Stage 59 이후 남은 UX 문제 (진단)
- AI-Tailwind 기본값 룩: indigo/violet 액센트, rounded-xl 카드, 쿨그레이(gray) → "AI가 만든 내부툴" 인상.
- 화면별 한글 하드카피(특히 GitHub 연결/리뷰/기록), mock 배지("GitHub 연결 예정"), 이모지(🔗) 잔재.
- 상태색이 의미 없이 다채로움(violet decision 등).

## 2. 변경한 주요 화면 / 디자인 토큰
**전역 토큰 (config 1곳 리매핑 → 13개 화면 무수정 recolor):**
- `gray → zinc`(쿨블루 제거, 중립), `indigo → 딥그린 scale`(모든 legacy `indigo-*` primary/link가 그린), `brand` alias 신설.
- 상태색: `needs_decision`/`building` 보라/블루 → **slate(info)**. 전 화면 `violet- → slate-` 일괄 치환(7파일).
- `globals.css`: warm-neutral surface(#fafafa), tight heading tracking, brand focus ring, Linear 프리미티브(`.card`/`.btn-primary|secondary`/`.input`/`.callout(-error|info)`/`.empty-state`/`.page-title`/`.section-title`).

**Chrome:** AppHeader 컴팩트화(브랜드 마크+wordmark+toggle, h-12 hairline), ProjectShell nav 재작성(compact, active 강조, **mock user badge 제거**).

## 3. 변경한 copy / terms (i18n)
- dictionary에 `github`/`review`/`history` 네임스페이스 추가(EN+KO, .d.mts 동기).
- **Settings(GitHub 연결) 전면 전환**: Connect GitHub / Connect repository / Enter repository manually / "owner/repo, public only" hint / Private not supported / 에러별 안내(not_found·private·not_connected·invalid). Linear 카드/버튼/인풋 적용, 이모지·중복 stage note 제거.
- **GitHub 페이지 헤더**: "PR 연결" → **Pull requests** + basis note(연결 PR 변경 기준) + **View review history**. 결과 상태 라벨은 StatusBadge/StatusText로 이미 다국어(Passed/Issue found/Not verified/Needs decision).
- Fix Pack → **Fix instructions**(dict `github.createFixInstructions`/`fix.title`), Re-run remaining issues 등 dict 보유.

## 4. I18N coverage
- 적용 완료: 글로벌 헤더/nav/상태 라벨·설명/projects 홈/**settings GitHub flow 전체**/github 페이지 헤더·basis·history 링크.
- dict 키: brand·lang·nav·status·comparison·projects·actions·fix·common·**github·review·history**·errors. en/ko key parity 테스트로 누락 방지.
- 영어 기본, 한국어 자연 번역(완벽 polish보다 key coverage 우선 — spec 지침).

## 5. visual polish
- page/section header 일관(`.page-title`/`.section-title`), primary/secondary 액션 구분(`.btn-*`), 카드 hairline+rounded-lg(과한 xl/그림자 제거), 상태 badge 일관, error/empty callout 스타일, 이모지 정리.

## 6. known issues (남은 작업 — Stage 61 후보)
- **deep github panels**: run review 실행 패널, Fix instructions 패널 본문, comparison/comment 패널의 한글 copy/버튼은 미전환(서브컴포넌트 다수). 결과 상태 라벨만 다국어.
- `settings`의 **Telegram 알림 섹션** copy 한글 유지.
- `idea/spec/items/checks/fixes/new`, `history`·`run detail` 본문 copy 점진 사전화 필요.
- `admin/*` 화면.
- 다크 모드(추후), 전면 컴포넌트 디자인시스템.

## 7. 수정한 파일 / 커밋 (`e64ff21`, 17파일)
- 토큰/스타일: `tailwind.config.ts`, `app/globals.css`, `lib/labels.ts`
- chrome: `components/AppHeader.tsx`, `components/ProjectShell.tsx`
- i18n: `i18n/dictionary.mjs`·`.d.mts`, `test/i18n.test.mjs`
- 화면: `settings/page.tsx`(전면), `github/page.tsx`(헤더), + violet→slate 일괄(new/checks/history/runId/overview/spec/projects)

## 8. test / typecheck / build
- i18n **10/10**, dashboard **77/77**, typecheck **53/53**, lint green(pre-push verify 통과), build OK.

## 9. live deployment / verification
- (배포 후 채움) Vercel 재배포 → 딥그린 액센트/neutral/헤더/settings 영어 copy 반영 + EN/KO 토글 + 레이아웃 확인.

## 10. Stage 61 전 결정 필요한 점
1. **Vercel 재배포**(토큰) → Bae가 새 룩(딥그린/neutral) 육안 확인 → 방향 맞는지 피드백.
2. 남은 copy 사전화 범위(§6) — github 패널/idea·spec·items 어디까지.
3. (운영) **Vercel 토큰 revoke**(노출됨) + Git 연결 / org OAuth 앱 승인.
4. 보류: 다크 모드, private repo, OAuth scope, actual debit.
