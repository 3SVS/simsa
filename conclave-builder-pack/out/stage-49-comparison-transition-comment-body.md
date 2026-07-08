> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 49 — 비교 상태 전환을 PR comment body에 표시

목표: rerun comparison을 포함한 PR comment body의 `다시 확인 결과 비교` 섹션에 각 항목의 **이전 상태 → 현재 상태** 전환을 표시. 신규 endpoint·서버 DB·dashboard UI·request shape 변경 없음.

기준 커밋: Stage 48 `22445dc` 이후.

---

## 1. 수정한 backend 파일

- `apps/central-plane/src/workspace/pr-comment.ts` — `buildRerunComparisonPart` 항목 라인 포맷 개선 + 전환 라벨/truncate 헬퍼.
- `apps/central-plane/src/workspace/pr-review-compare.ts` — 비교 item 타입에 **additive 필드**(`from?`, `nextAction?`) 추가 + `compareRunResults` 채움.

(dashboard·backend endpoint·DB·request shape 변경 없음.)

---

## 2. status transition label 정책

- `statusKoOr(status, fallback)` + `transitionLabel(from, to)` (pr-comment.ts).
- `이전 → 현재` 형식. source(from) 없으면 `새 항목 → 현재`.
- 예: `안 맞음 → 통과`, `통과 → 안 맞음`, `확인 부족 → 확인 부족`, `새 항목 → 안 맞음`.
- 라벨은 기존 `STATUS_KO_PLAIN` 재사용.

---

## 3. source/current status 확보 방식 (case A→B, additive)

기존 `compareRunResults` item:
- improved/newlyProblematic: 이미 `from`/`to` 보유 → 전환 표시 가능(이미 일부 표시 중이었음).
- stillOpen/unchanged: `status`만 보유 → source 알 수 없음.

→ **additive 필드 추가** (API shape 비파괴):
- `StillOpenItem`: `from?`, `nextAction?`
- `UnchangedItem`: `from?`
- `NewlyProblematicItem`: `nextAction?`
- `ReviewResultItem`: `nextAction?` (저장 결과에 이미 있으나 타입만 노출)

`compareRunResults`에서:
- both-runs(동일 점수=동일 상태): `from = prev.status`.
- current-only(이전 run에 없음): `from` 미설정(undefined) → "새 항목".
- stillOpen/newlyProblematic: `nextAction = latest.nextAction`.

STATUS_SCORE(passed=4/needs_decision=2/inconclusive=1/failed=0) 정책은 dashboard helper와 동일 유지.

---

## 4. rerun comparison comment body format

```
### 좋아진 항목 (N개)
- {title}: 안 맞음 → 통과

### 아직 남은 항목 (N개)
- {title}: 확인 부족 → 확인 부족
  - 다음 조치: {nextAction}

### 새로 생긴 문제 (N개)
- {title}: 통과 → 안 맞음
  - 다음 조치: {nextAction}

### 변화 없음 (N개)
- {title}: 통과 → 통과
```

- 요약(좋아진/아직 남은/새로 생긴 문제/변화 없음 N개) + group heading + 빈 그룹 생략 정책 **유지**.
- nextAction은 stillOpen/newlyProblematic(조치 필요 그룹)에만, 있으면 한 줄로.
- evidence는 추가하지 않음(comment 가독성).

---

## 5. length/truncation 처리

- `truncateAction(action, max=140)` — nextAction이 길면 140자에서 `…`로 자름.
- 전체 comment body는 기존 `buildCommentBody`의 `MAX_COMMENT_CHARS` truncation이 그대로 적용(섹션 우선순위·생략 로직 불변).

---

## 6. request shape 영향 여부

**없음.** `includeRerunComparison=true` 동작만 더 풍부한 body를 생성. comment preview/post request shape, dashboard CommentPanel, AutoComparisonPanel 모두 미변경.

---

## 7. 테스트 결과

`apps/central-plane/test/workspace-pr-comment-comparison.test.mjs` (+8, buildCommentBody 직접):
- improved 안 맞음→통과 / newlyProblematic 통과→안 맞음 / stillOpen 확인 부족→확인 부족
- current-only 새 항목→안 맞음
- nextAction → "다음 조치"
- 빈 그룹 생략 유지 / rerunComparisonIncluded 플래그 유지

(기존 compare/comment 테스트 76개 무회귀: stillOpen은 `status`/section heading만 단언, line 포맷은 단언 안 함.)

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3456 / 3456 pass** (3448 + 8 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |

---

## 8. Stage 50에서 이어서 할 일

1. dashboard AutoComparisonPanel(Stage 48)과 comment body(Stage 49) 라벨 문구 일관성 점검(선택).
2. (이월) fromRunId-only 비교 comment Policy B(Stage 46), 서버 저장(Stage 44), CommentPanel 내부 선택 공유(Stage 43).
3. 라이브에서 실제 PR comment 전환 표시 확인 (Bae).
4. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
