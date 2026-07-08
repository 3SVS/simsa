# Simsa P0 배치 + P1 shipped — 2026-07-08 EoD

> 내일(Langfuse 배선) 세션의 시작 컨텍스트. 감사 v2(`docs/simsa-research-audit-2026-07.md`)의
> P0 5건이 이 시점부로 전부 프로덕션 반영·스모크 통과.

## 시간순 요약 (Phase 0→6)

1. **Preflight** — main=`e033314`, #297+#302~305 전부 MERGEABLE·CI green·migration 0건.
   Vercel token은 repo Actions secret에 없음(로컬 CLI 세션 인증 경로) → rotate 대상 없음.
2. **Merge** (배님 직접 실행) — 순서 #297 → #302 → #303 → #304 → #305.
   squash: `c1e4b86`(#297) `fdda213`(#302) `a3610d3`(#303) `c839c1c`(#304) `ce906cf`(#305).
   ※ #299(로그인 벽)는 **머지가 아니라 CLOSED** — 로그인 벽 정직화는 미반영 상태로 남음.
3. **Deploy central-plane** — workflow 성공. 프로덕션 스모크:
   - "팀 회의 참여자 관리 앱" → 정상 스펙(참석자 관리 앱), 게이트 통과(coverage 0.67) ✅
   - "리뷰를 요약해줘" → **회의록/Linear 날조 없음**, "리뷰 요약 서비스" 생성, coverage 1.0 ✅
     (지시서가 예상한 "게이트 rejection"은 날조 발생 시 시나리오 — 키 있는 LLM 경로는 애초에
     날조하지 않아 게이트를 정상 통과. rejection·경고 경로는 테스트로 pin, 프로덕션 강제 재현 불가)
4. **Deploy dashboard** — Vercel prod Ready, `app.trysimsa.com` alias 신규 배포 확인.
   스모크: export API 실 호출 → 팩 7파일 전부 `simsa-build-pack/`·conclave 0건·README 정직
   섹션·C2 답 product.md 도달 ✅. 배너 3종+ARCHITECTURE 안내+감사 링크 대상 main 실존 ✅.
5. **Phase 4 caching → 정지·스킵 (ADR 아래)** — 검증 게이트가 설계상 통과 불가 실측.
   배님 승인 ①로 **usage 로깅 PR로 대체**: **#306** (`2804b97`) 머지·재배포.
   프로덕션 실측: `{"event":"anthropic_usage","call_site":"generate",
   "model":"claude-haiku-4-5-20251001","input_tokens":1226,"output_tokens":5196,
   "cache_creation_input_tokens":0,"cache_read_input_tokens":0,"latency_ms":39534}` ✅
6. **EoD 문서** — 이 파일.

## 감사 P0 재현 시나리오 최종 확인

- "요약" 입력 → 날조 없음 (프로덕션 실측) ✅
- ZIP에 시크릿 없음 (#300, 회귀 테스트 pin) ✅
- `conclave-build-pack` 이름 안 보임 (프로덕션 export 실측 0건) ✅
- stage docs 열면 승계 배너 (main 반영, 무작위 3개 육안) ✅
- README "한 번에 알아서 끝납니다" 없음 + "보장하지 않는 것" 섹션 (프로덕션 실측) ✅

## ADR: Prompt caching 보류 (2026-07-08)

**사유:** Haiku 4.5 최소 캐시 가능 prefix **4096 토큰** 미달 — 정적 prefix 실측 1.5~3천 토큰,
프로덕션 실측으로는 generate **전체 프롬프트가 1226 토큰**(위 로그). `cache_control`은 미달 시
조용히 무시됨(`cache_creation_input_tokens=0`). 또한 베타 트래픽(생성 20/일)으로 5분 TTL 히트
불가 → 쓰기 프리미엄(1.25×)만 부담하는 **순손실**. 1h TTL은 쓰기 2×로 더 불리.

**재평가 조건 (하나라도 충족 시):**
- (a) 트래픽이 5분 TTL을 채울 밀도 도달 — `anthropic_usage` 로그의 호출 간격으로 판단
- (b) 정적 prefix가 4096 토큰 초과 (프롬프트 구조 변경 시)
- (c) **Sonnet 계열로 모델 전환 시 — 최소 prefix 1024 토큰이라 현재 generate 프롬프트도 즉시
  자격 됨.** 모델 업그레이드 논의가 나오면 caching이 공짜로 딸려오는 구조.

**재평가 시 주의:** KO 프롬프트 구조는 Haiku 거부 이슈로 3회 수정된 민감 지점(#286~288) —
정적 부분의 system 블록 재배치는 반드시 회귀 테스트와 함께.

## 발견한 이슈

- Vercel CLI를 worktree에서 실행하면 `.vercel/project.json`(gitignored)이 없어 미링크
  상태 → 첫 배포 시도 npm install 실패. 해결: 링크 파일을 repo 루트 `.vercel/`로 복사 후
  루트에서 실행 (프로젝트 Root Directory=`apps/dashboard` 설정이라 루트 실행 필수).
- generate LLM latency 36~42s 실측 (기존 ~23s 관측 대비 상승) — Langfuse에서 추세 확인 권장.

## 남은 것 / 내일

1. **Langfuse 배선 (내일 첫 작업)** — `anthropic_usage` JSON 라인이 ingest 포맷.
   `packages/observability-langfuse` 확인 → generate 진입점부터 trace.
2. #295·#296·#298·#301 열림 (배님 배치 판단). #298은 verify 게이트(#303)와 같은 문제의식
   — 머지 시 generate.ts 충돌 여부 확인 필요.
3. #299 CLOSED — 로그인 벽 "확인 못 함" 정직화는 미반영. 재개 여부 배님 판단.
4. 사람 육안 잔여(1분): 브라우저에서 export ZIP 클릭 다운로드 파일명 = `simsa-build-pack.zip`,
   GitHub UI에서 stage doc 1~2개 렌더 확인, dashboard EN/KO 토글.
5. Non-goals 유지: 포크 재구현(Q1)·7층 재배선·봇/npm rename frozen.
