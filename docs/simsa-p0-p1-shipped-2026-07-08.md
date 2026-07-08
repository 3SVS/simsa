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

## 보고-실제 불일치 정정 (2026-07-08 밤 추가)

- **원인 한 줄:** 이전 세션이 세션 종료 요약과 감사 v2 "변경 이력"에 **"PR 오픈"을
  "완료"로 집계**했다(#298·#299). 커밋된 핸드오프 #301은 OPEN으로 정확히 표기했었음.
  재발 방지 규칙: **추적표의 "완료"는 머지 커밋 확인 후에만 표기.** (감사 v2에 정정 주석 추가됨)
- **#299 (로그인 벽):** 2026-07-08 03:05 머지 없이 CLOSED, **코멘트·사유 기록 없음** —
  의도(P1 강등)인지 사고인지 배님 확인 필요. 내용상으로는 메타평가가 "자격증명 검수=P1"로
  재배치했으므로 강등이 합리적. 어느 쪽이든 **P1 백로그 정식 등재 필요**(감사 finding이
  사라지면 안 됨).
- **#298 (날조 mock 트리거):** #303에 완전 superseded 아님 — **유니크 가치 확인.**
  #298은 mock 트리거를 "회의/미팅/녹음 **AND** 요약/할일/정리/linear"로 좁혀 canned 초안
  생성 자체를 차단(벨트), #303 게이트는 생성된 초안을 사후 검증(서스펜더). 예: "linear에
  보내는 앱"은 게이트를 통과하지만(사용자가 linear 명시) #298이면 회의록 mock 자체가 안
  나감. 같은 라인(generate.ts `isMeeting`) 수정이라 **rebase 필수** — rebase 후 머지 권고,
  결정은 내일 세션.

## 발견한 이슈

- Vercel CLI를 worktree에서 실행하면 `.vercel/project.json`(gitignored)이 없어 미링크
  상태 → 첫 배포 시도 npm install 실패. 해결: 링크 파일을 repo 루트 `.vercel/`로 복사 후
  루트에서 실행 (프로젝트 Root Directory=`apps/dashboard` 설정이라 루트 실행 필수).
- generate LLM latency 36~42s 실측 (기존 ~23s 관측 대비 상승) — Langfuse에서 추세 확인 권장.

## Langfuse LIVE — 2026-07-09 (실증 완료)

Langfuse 배선이 프로덕션에 라이브·실증됐다(원래 "내일 첫 작업"을 당겨 완료).
- **경로:** `workspace/langfuse.ts`(Workers-safe fetch·env-gated·fail-open·`waitUntil`·
  콘텐츠 무전송) #309 → `LANGFUSE_BASE_URL` 별칭+전송로그 #312(코드가 `LANGFUSE_HOST`만
  읽어 조용히 no-op이던 것 해소) → set-worker-secrets allowlist #313 → 3종 Worker 반영
  ("Done: 3 pushed").
- **실증:** 프로덕션 generate 호출 → **Langfuse UI에 trace 2건 확인(2026-07-09 KST 22:44·22:47)**.
  리전 **EU**(`cloud.langfuse.com`). 어제 usage 로그(#306) → 오늘 trace까지 데이터 파이프 E2E.
- **gotcha:** `wrangler tail`이 이 환경에서 스트림 캡처 실패(인증 정상, `whoami` OK) → 자체확인
  대신 **유저 Langfuse UI가 ground truth**. 앞으로 trace 확인은 UI 또는 `/_diag` 엔드포인트.
- **#311 반영 유지:** 응답에서 `llmUsage` strip(operator 전용) — trace/로그로만, 유저 응답엔 없음.

## 남은 것 / 내일 (배님 확정 순서)

1. **추적표 정정 확인** — #298/#299 실상태 반영(이 문서·감사 v2 정정 주석) 리뷰. (10분)
2. **#298 처리 결정** — rebase 후 머지(권고) vs close-superseded. 위 정정 절 참고. (30분)
3. **★Latency = 출력길이 (Langfuse 첫 쿼리)** — 실측 4점 모두 output ~5.2~5.4k tok @ ~40s
   ≈ **130 tok/s = Haiku 정상속도**. 즉 **"latency 회귀"가 아님** — 출력이 5k+ 토큰으로 긴 것
   자체가 관측·UX 대상. Langfuse 첫 쿼리: **#303(C2 decisions 병합) 배포 전후 `output_tokens`
   평균**이 실제 뛰었는지. 뛰었으면 대응은 성능 최적화가 아니라 **spec 출력 길이 상한/요약** —
   **비개발자에게 5k 토큰 spec은 그 자체로 UX 과부하**(감사 "한 화면 한 질문" 원칙과 충돌).
   즉 이건 성능 문제가 아니라 UX 상한 문제로 다룰 것.
5. 여유 시: P1 백로그 정리 — 로그인 벽(#299 후속) 정식 등재 + 감사 P1 트랙 우선순위.
6. 사람 육안 잔여(1분): 브라우저에서 export ZIP 클릭 다운로드 파일명 = `simsa-build-pack.zip`,
   GitHub UI에서 stage doc 1~2개 렌더 확인, dashboard EN/KO 토글.
7. #295·#296·#301 열림(배님 배치 판단). Non-goals 유지: 포크 재구현(Q1)·7층 재배선·
   봇/npm rename frozen.
