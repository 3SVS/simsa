# Stage 67 — Benchmark PR Comment Evidence

저장된 benchmark evidence를 copy summary뿐 아니라 **GitHub PR comment**로도 공유. preview-first + explicit-confirm safety model 유지. **dashboard 전용**(기존 comment POST 엔드포인트 재사용 → 백엔드·OAuth·MCP·billing 무변경).

커밋: `ff818c8`. 라이브: `…/projects/:id/benchmark/:benchmarkId` Share 섹션.

## 1. benchmark PR comment preview 기능
detail 페이지 하단 **Share** 섹션에 **Preview PR comment** 추가 → benchmark result 기반 GitHub markdown을 클라이언트에서 결정적으로 생성해 미리보기(`<pre>`). 네트워크 없이 preview(완전 결정적). post는 미리보기 이후에만 노출.

## 2. deterministic markdown builder
`apps/dashboard/src/lib/agent-benchmark-comment.mjs`(+`.d.mts`):
- `buildBenchmarkPrCommentMarkdown(parts)` — **순수**(LLM·network·randomness·token/userKey 없음). 구조: `## heading` → intro → (misaligned면 `> Warning:` blockquote) → `**Recommendation:** value`(no-winner면 body) → 후보 비교 테이블(Candidate·Mode·Passed·Critical·Not verified·Score, 우정렬) → `### Why`(rationale, 라인 없으면 생략) → `### Remaining blockers`(winner 기준 또는 noBlockers) → `### Note`("어떤 에이전트가 더 똑똑한지 추측하지 않는다"). 변수 텍스트는 UI가 지역화해 주입 → EN/KO 토글 따름.
- 예시 형식은 spec과 일치. score는 보조 지표로 테이블에 포함하되 원본 count(passed/total·critical·not-verified) 병기.

## 3. post target / same-PR guard
`resolveBenchmarkPrTarget(candidates)`(순수):
- 모든 candidate run의 `pullRequestNumber`가 동일 → `{canPost:true, prNumber}`.
- 다르거나 누락 → `{canPost:false}` → **copy-only**(mixedPrNote 표시).
이유: 서로 다른 PR의 후보를 비교한 benchmark는 하나의 PR comment에 속하지 않음.

## 4. posting safety model
- **Preview first**: Post 버튼은 미리보기 생성 후에만 노출.
- **Explicit confirm**: 미리보기 + 경고("선택한 GitHub PR에 comment가 게시됩니다") 후 별도 Post 클릭.
- **자동 게시 없음**.
- **토큰/스코프 무변경**: 기존 comment POST 엔드포인트 재사용(이미 repo link + `hasPrCommentScope` + 사용자 GitHub 토큰 검증; 미연결/미스코프 시 403 → 에러 표시). benchmark 소유권은 detail 로딩(getSavedBenchmark, userKey)에서 이미 검증.
- **Deterministic markdown only**(LLM 금지).
- mixed-PR → post 비활성 + copy-only.
- ★엔드포인트 재사용 결정: 기존 `POST …/github/pulls/:number/comment`가 `customBody`(client 제공 body)를 그대로 게시 + run context(같은 PR candidate의 reviewRunId 전달)만 요구 → benchmark markdown을 `body`로 넘겨 게시. 신규 백엔드/엔드포인트 불필요(spec "avoid backend endpoints unless required" 준수).

## 5. UI changes
detail Share 섹션 상태머신: (mixed-PR면 copy-only note) → Preview PR comment → [Comment 미리보기 + 경고 + Post comment to PR] → posting → posted(+GitHub 링크) / error. Copy summary(Stage 66, header)는 그대로 유지.

## 6. i18n 추가
`benchmark.*` 확장: shareTitle/prIntro/prNoteHeading/previewPrComment/commentPreviewTitle/postToPr/postWarning/prPosting/postedToGithub/postCommentError/prViewComment/mixedPrNote. EN/KO·.d.mts, parity 10/10. 테이블 헤더·blocker status 라벨은 기존 col*/statusLabel 재사용.

## 7. tests / build
- dashboard **107/107**(benchmark-comment 9 신규: winner/no-clear-winner/misaligned/no-blockers/**no token·userKey leakage**/deterministic + same-PR/mixed-PR/missing-PR target). i18n parity 10/10, typecheck clean, build green(18 routes), lint clean(기존 export 경고만).
- ★렌더/post-network 레벨은 node --test 전용 환경상 비현실적 → 결정적 로직 + 라이브로 커버.

## 8. live verification
- dashboard 재배포 READY, detail route 200, SSR "Loading the benchmark…".
- ★ populated preview/post + mixed-PR 비활성 + EN/KO 육안은 Bae 수동(실 saved benchmark + 같은 PR candidate 2개 + GitHub 연결 userKey 필요). 기존 comment POST 엔드포인트는 이전 단계에서 라이브 게시 검증됨(issuecomment). 라이브에 저장된 benchmark가 아직 없어 contract/empty로 문서화 — 가짜 성공 없음.

## 9. 수정한 파일 / 커밋 (`ff818c8`)
- 신규: `lib/agent-benchmark-comment.mjs`·`.d.mts`, `test/benchmark-comment.test.mjs`.
- 수정: `app/projects/[id]/benchmark/[benchmarkId]/page.tsx`(Share 섹션), `i18n/dictionary.mjs`·`.d.mts`.

## 10. known limitations
- blocker 라인은 winner 기준 status count(항목 제목 단위 아님 — run summary가 count만 제공).
- benchmark-specific audit 이벤트 없음(기존 comment usage 이벤트만 기록) — 백엔드 무변경 우선.
- post는 mode `new`(항상 새 comment) — update_latest 미사용.
- mixed-PR는 copy-only(정책상).
- share token/public URL·rename/delete는 이번 단계 제외.
- 실 에이전트 실행 없음.

## 11. Stage 68 전 결정 필요한 점
1. **benchmark-specific audit/usage 이벤트**: preview/post 기록이 필요하면 기존 comment 엔드포인트에 source 태그 추가(소규모 백엔드 변경) 또는 별도 이벤트.
2. **item-level blocker**: comment에 항목 제목까지(현재 count 그룹) → run 결과 항목 노출.
3. **benchmark 관리**: rename/delete(+UI).
4. **공유 강화**: read-only share URL(public token) — 이번 단계 제외분.
5. (장기) 실 에이전트 실행 연결.
