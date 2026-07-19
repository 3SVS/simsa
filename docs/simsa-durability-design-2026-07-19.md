# G8 데이터 내구성 설계 — localStorage 정본을 서버 정본으로 [LOCKED 2026-07-19]

2026-07-19. 백로그 G8의 설계 잠금 문서. 프로덕션 데이터 이동이 걸려 있어 구현 전
`design lock approved`를 받는다.

**문제.** 프로젝트 목록·스펙·항목은 D1 미러가 있지만, **ExtendedProjectData**(검수
결과·고쳐보기·userProfile·builtWith·entryPath 등 제품 루프의 실질 상태)는 localStorage
전용이다. 기기 변경/브라우저 데이터 삭제 = 유실. 또한 유료 자격이 userKey에 묶여
있어(RC-4) userKey 유출 = 유료 접근이라는 약점이 겹친다.

## 결정 (DR-번호)

### DR-1 — ext 데이터의 서버 정본화 [PILOT]
- D1에 `workspace_project_ext (project_id PK, user_key, ext_json, updated_at)`
  additive 신설(기존 미러 테이블 무변경). ext_json 크기 캡 256KB(스크린샷류는 이미
  R2 — 텍스트 상태만).
- 소유권: 기존 owned-project 게이트(project_id+user_key) 그대로.

### DR-2 — 동기화 규칙: 로컬 즉시, 서버 best-effort, 읽기는 로컬 우선 [PILOT]
- 쓰기: `saveExtendedProjectData`가 로컬 저장 직후 서버 upsert를 fire-and-forget
  (기존 saveProjectToDb 패턴·sync-failed 표시 재사용). 충돌 규칙 = last-write-wins
  (단일 사용자·단일 기기 주 사용을 전제로 단순하게 시작; 동시 편집은 비목표).
- 읽기: 로컬 있으면 로컬(현행과 동일 — 성능·오프라인 유지). 로컬에 프로젝트가
  없는데 서버에 있으면 **복원 흐름**(DR-3)으로만 가져온다(조용한 자동 병합 금지 —
  다른 계정 데이터가 섞이는 사고 방지).

### DR-3 — 복원 UI [PILOT]
- 로그인(또는 userKey 입력) 후 `/projects`가 서버 목록과 로컬 목록의 차집합을 보여주고
  "이 기기로 가져오기"를 명시 클릭으로 실행. 삭제와 대칭(가져오기도 명시적).

### DR-4 — 유료 자격의 계정 귀속 [OPEN → 결제 라이브 전 재검토]
- 베타 파일럿: userKey 그랜트 유지(현행). 결제 라이브 시: 자격은 auth 계정에 귀속하고
  userKey는 클레임 플로우(기존 골격)로 계정에 연결. 트리거: 토스 연동 트레인.

### DR-5 — 이행 순서 (트레인)
| Train | 내용 |
|---|---|
| D-1 | 마이그레이션 + upsert/read 라우트 + 클라이언트 fire-and-forget 쓰기 |
| D-2 | 복원 UI(차집합 목록+명시 가져오기) + 라이브 실증(기기 시뮬: 새 컨텍스트) |
| D-3 | (결제 라이브와 함께) 자격 계정 귀속 |

## 비목표
동시 편집 병합 · 실시간 동기화 · localStorage 제거(캐시로 유지) · 익명 데이터의
계정 강제 연결.

## 게이트 레지스트리
| 일시 | 게이트 | 상태 |
|---|---|---|
| 2026-07-19 | 설계 작성 | 완료 |
| 2026-07-19 | 설계 잠금 | **Bae `design lock approved`** — DR-1·DR-2·DR-3·DR-5 LOCKED, DR-4 OPEN(결제 라이브 시 재검토). 구현 착수는 `train D-1 start approved` 별도 |
| 2026-07-19 | Train D-1 | Bae `train D-1 start approved` → #406 머지·배포·**라이브 8/8** |
| 2026-07-19 | Train D-2 | Bae "작업시작해" → #408 머지·배포·**새 기기 시뮬 라이브 8/8** — D-1/D-2 종료, 잔여는 D-3(DR-4와 함께) |
