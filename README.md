# Conclave Claude Code Builder Pack

이 묶음은 Conclave를 **개발자용 CLI/PR 리뷰 툴**에서 **일반 유저가 아이디어가 제품으로 만들어지는 과정을 시각적으로 확인하는 작업공간**으로 확장하기 위한 Claude Code용 작업 문서입니다.

## 목표

사용자에게는 어려운 개발자 용어를 숨기고, 다음 흐름을 앱 안에서 쉽게 보여줍니다.

```text
아이디어 입력
→ Conclave가 이해한 내용
→ 맞춤 질문
→ 제품 설명서
→ 꼭 들어가야 할 항목
→ 만들기 진행상황
→ 확인 결과
→ 고쳐야 할 것
→ 다시 확인
```

내부적으로는 PRD, requirements, verification, autofix 같은 구조를 쓰더라도, 사용자 화면에는 다음 표현을 우선 사용합니다.

```text
제품 설명서
꼭 들어가야 할 항목
완성 기준
확인 결과
안 맞음
확인 부족
결정 필요
고쳐보기
```

## 적용 방법

1. 이 폴더의 내용을 Conclave 레포 루트에 복사합니다.
2. 이미 `CLAUDE.md`가 있다면 덮어쓰지 말고 내용을 병합합니다.
3. Claude Code를 레포 루트에서 실행합니다.
4. 먼저 `.conclave/prompts/00-start-here-for-claude-code.md` 내용을 붙여 넣습니다.
5. 첫 단계는 **탐색만** 합니다. 코드 수정은 하지 않습니다.
6. Claude Code가 작성한 진행 결과를 사용자에게 보고하고 다음 단계를 진행합니다.

## 절대 처음부터 전체 구현하지 않기

이 기능은 크고 실패 가능성이 높습니다. 반드시 단계별로 나눕니다.

```text
Stage 0: 레포 탐색, 구현 위치 파악, 계획 작성
Stage 1: 일반 유저용 언어/정보 구조 정리
Stage 2: 아이디어 입력 + 제품 설명서 초안 화면
Stage 3: 맞춤 질문 생성 엔진
Stage 4: 꼭 들어가야 할 항목 카드 모델
Stage 5: 확인 결과 + 고쳐보기 2단계 루프
Stage 6: Claude/Codex용 만들기 패키지 내보내기
Stage 7: 기존 Conclave review/autofix job과 연결
```

## 현재 할 일

처음에는 `.conclave/current-task.md`가 Stage 0으로 설정되어 있습니다. Claude Code에게 먼저 탐색과 계획만 시키세요.

## MCP — AI 코딩 에이전트에서 직접 호출

`@simsa/mcp-workspace` ([`packages/mcp-workspace`](packages/mcp-workspace/README.md))는 Conclave의 acceptance/PR-review 워크플로를 **MCP 도구(stdio)**로 노출합니다. Claude Code / Cursor / Codex-like 에이전트가 코딩 환경을 떠나지 않고 PR 확인·Fix 지시서·비교·코멘트 미리보기를 호출할 수 있습니다. 설정·과금 의미·안전 모델은 패키지 README와 `conclave-builder-pack/out/stage-62-mcp-packaging-billing-docs.md` 참고. (raw GitHub 토큰 불필요 — 연결된 계정을 central-plane 통해 사용.)
