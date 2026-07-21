#!/usr/bin/env bash
# pr-chain.sh — PR CI-watch → merge 표준 체인 (기준평가 8b, 2026-07-22)
#
# 백그라운드 체인에서 실측으로 재발한 경합 3클래스를 봉인한다:
#   C1 무번호 gh pr 명령 = 현재 브랜치 상대참조 → 포그라운드 checkout과 경합
#      (#452·batch1 실측) → **PR 번호 필수 인자**, 모든 gh 호출에 명시.
#   C2 포스푸시 직후 `gh pr checks --watch`가 "no checks reported"로 즉시
#      통과 → 머지 규율 구멍 (#447 실측) → **체크 기동 확인 루프** 선행.
#   C3 체인 내 git checkout/--delete-branch = 로컬 브랜치/HEAD 경합
#      (7/20·7/21 실측) → 이 스크립트는 **로컬 git 상태를 일절 만지지 않는다.**
#
# 사용: tools/scripts/pr-chain.sh <PR번호>
# 종료코드: 0=머지됨, 그 외=실패(사유 stdout)
set -euo pipefail

PR="${1:?usage: pr-chain.sh <pr-number>}"

# C2: 체크가 실제로 붙을 때까지 대기 (최대 120s). "no checks"는 통과가 아니다.
# (첫 실사용 실측 수정: pipefail 하에서 gh 실패가 ||-fallback과 겹쳐 0을 두 줄로
#  이중 출력 → 정수 비교 실패. 실패는 true로 흡수하고 공백을 제거해 센다.)
for i in $(seq 1 24); do
  n=$( { gh pr checks "$PR" 2>/dev/null || true; } | wc -l | tr -d '[:space:]' )
  n=${n:-0}
  if [ "$n" -ge 1 ]; then break; fi
  if [ "$i" -eq 24 ]; then echo "FAIL: no checks appeared on PR #$PR within 120s"; exit 1; fi
  sleep 5
done

gh pr checks "$PR" --watch --fail-fast
gh pr merge "$PR" --squash
state=$(gh pr view "$PR" --json state --jq .state)
echo "PR #$PR: $state"
[ "$state" = "MERGED" ]
