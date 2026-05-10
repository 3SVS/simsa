# Launch day ops — 실시간 모니터링 가이드

런치 시점 (한국 22:00 ~ 다음날 04:00) 에 띄워둘 모니터링 셋업.
3 패널 + Telegram 알림 + 데이터 쿼리 묶음.

## Panel 1: Live Worker tail

가장 중요. 새 사용자 한 명이 들어오면 여기서 처음 보임.

```powershell
cd C:\Users\seung\.conclave\conclave-ai\apps\central-plane
wrangler tail
```

볼 만한 패턴:
- `[saas] spawnSandbox …` → 실제 사용자 review 시작
- `[install ...] created → user usr_…` → GitHub App 신규 install
- `[demo] reviewing pr=…` → 데모 페이지 사용
- `error` / `crashed` → 무엇이든 빨간 줄

연결 끊기면 자동 재연결 안 되니 끊어지면 다시 실행. 보통 한 시간 단위로 끊김.

---

## Panel 2: 30초마다 카운트 dashboard

다른 PowerShell 창에서:

```powershell
$ENV:CONCLAVE_INTERNAL=$ENV:INTERNAL_CALLBACK_TOKEN

while ($true) {
  Clear-Host
  Write-Host "=== Conclave AI · live ops · $(Get-Date -Format 'HH:mm:ss') ===" -ForegroundColor Cyan
  Write-Host ""
  curl -sS https://conclave-ai.seunghunbae.workers.dev/admin/install-summary `
       -H "authorization: Bearer $ENV:CONCLAVE_INTERNAL" |
    ConvertFrom-Json | Format-List
  Write-Host ""
  Write-Host "--- learning-stats ---" -ForegroundColor Cyan
  curl -sS "https://conclave-ai.seunghunbae.workers.dev/admin/learning-stats?domain=code" `
       -H "authorization: Bearer $ENV:CONCLAVE_INTERNAL" |
    ConvertFrom-Json | Format-List
  Start-Sleep -Seconds 30
}
```

**전제 조건**: `$ENV:INTERNAL_CALLBACK_TOKEN` 미리 설정 (또는 `wrangler secret list`로 확인 후 직접 해당 값 입력). 없으면 401 만 돌아옴.

---

## Panel 3: 직접 D1 query (SQL)

새 사용자 / job / verdict 분포를 1분 단위로:

```powershell
cd C:\Users\seung\.conclave\conclave-ai\apps\central-plane

# 최근 install
wrangler d1 execute conclave-ai --remote --command="
  SELECT installation_id, account_login, target_type, repository_selection,
         saas_user_id, suspended_at, removed_at, created_at
    FROM gh_app_installations
   WHERE removed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 20;"

# 최근 jobs (review + autofix)
wrangler d1 execute conclave-ai --remote --command="
  SELECT id, repo_slug, pr_number, kind, status, verdict, blockers,
         duration_ms, created_at
    FROM jobs
   ORDER BY created_at DESC
   LIMIT 20;"

# verdict 분포 (오늘)
wrangler d1 execute conclave-ai --remote --command="
  SELECT verdict, COUNT(*) AS n
    FROM jobs
   WHERE date(created_at) = date('now')
   GROUP BY verdict;"

# demo 사용 (rate-limit 테이블 — 누가 한도 채웠나)
wrangler d1 execute conclave-ai --remote --command="
  SELECT ip_hash, count, last_at
    FROM saas_demo_rate
   WHERE date(last_at) = date('now')
   ORDER BY count DESC
   LIMIT 20;"

# 신규 user_feedback
wrangler d1 execute conclave-ai --remote --command="
  SELECT id, episodic_id, what_user_wanted, status, category, created_at
    FROM user_feedback
   WHERE removed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 10;"
```

---

## Telegram alert (옵션 — 한 번 셋업하면 손 안 가도 됨)

`TELEGRAM_BOT_TOKEN` 와 본인 `chat_id` 알면 PowerShell 에서 한 줄 dispatch
가능. 첫 사용자 가입 알림 또는 에러율 spike 알림용.

```powershell
function Send-TelegramAlert($Message) {
  $token = $ENV:TELEGRAM_BOT_TOKEN
  $chatId = "394136249"  # Bae 본인 chat_id (요 값으로 교체)
  $body = @{ chat_id = $chatId; text = $Message; parse_mode = "Markdown" } | ConvertTo-Json
  curl -sS "https://api.telegram.org/bot$token/sendMessage" `
       -X POST -H "content-type: application/json" -d $body | Out-Null
}

# 예: 새 사용자 감지 시
Send-TelegramAlert "🎉 *새 사용자* @$githubLogin 가입! tier=$tier"
```

**자동 alert loop** — 60초마다 새 install / job 체크, 변동 있으면 dispatch:

```powershell
$lastInstallCount = 0
$lastJobCount = 0

while ($true) {
  $stats = curl -sS https://conclave-ai.seunghunbae.workers.dev/admin/install-summary `
                -H "authorization: Bearer $ENV:INTERNAL_CALLBACK_TOKEN" |
           ConvertFrom-Json
  if ($stats.installs -gt $lastInstallCount) {
    $delta = $stats.installs - $lastInstallCount
    Send-TelegramAlert "🎉 신규 install +$delta (총 $($stats.installs))"
    $lastInstallCount = $stats.installs
  }
  if ($stats.jobs -gt $lastJobCount) {
    $delta = $stats.jobs - $lastJobCount
    Send-TelegramAlert "📊 신규 job +$delta (총 $($stats.jobs))"
    $lastJobCount = $stats.jobs
  }
  Start-Sleep -Seconds 60
}
```

처음 실행 시 baseline 잡고 그 이후 변동만 알림.

---

## 런치 첫 30분 — 가장 신경써야 할 것

| 신호 | 의미 | 액션 |
|---|---|---|
| HN/Reddit/LinkedIn 첫 댓글 | algorithm push 결정 | 5분 내 reply (모바일 알림 켜두기) |
| /demo/review 첫 호출 | 누군가 시도함 | wrangler tail 에서 cost 확인, 깨졌으면 즉시 fix |
| /saas/review 첫 호출 (BYO key 사용자) | 진지한 사용자 | 신규 install 알림 → who 확인 → DM (감사) |
| `crashed` 또는 `error` 라인 | 깨짐 | wrangler tail 로 stacktrace → 가능하면 즉시 fix + push |
| 같은 IP 가 demo 3회 다 쓴 후 GitHub install | 강한 conversion | 누군지 보고 사용자 인터뷰 요청 |

---

## 첫 1-2시간 후

데이터 어느 정도 모이면 그날 밤 또는 다음 날 정리:

```powershell
# 일일 리뷰
wrangler d1 execute conclave-ai --remote --command="
  SELECT
    COUNT(DISTINCT i.installation_id)         AS new_installs,
    COUNT(DISTINCT j.user_id)                 AS active_users,
    COUNT(j.id)                               AS total_jobs,
    SUM(CASE WHEN j.verdict='approve' THEN 1 ELSE 0 END) AS approve,
    SUM(CASE WHEN j.verdict='rework'  THEN 1 ELSE 0 END) AS rework,
    SUM(CASE WHEN j.verdict='reject'  THEN 1 ELSE 0 END) AS reject,
    AVG(j.duration_ms)                        AS avg_duration_ms,
    AVG(j.blockers)                           AS avg_blockers
    FROM jobs j
    LEFT JOIN gh_app_installations i ON i.saas_user_id = j.user_id
   WHERE date(j.created_at) = date('now');"
```

이게 다음 날 LinkedIn / Twitter post 의 "어제 하루 데이터" follow-up 글감.

---

## 사용자 인터뷰 trigger

런치 첫 사용자 (Bae 본인 외 첫 install) — DM 또는 메일 보내서 30분
인터뷰 부탁. 5명만 받아도 production 데이터 부족 문제 70% 해결.

질문 (5개 이상은 안 받음, 사람 시간 존중):
1. 어떤 PR 에서 사용해보셨나요?
2. Verdict 가 expectation 과 일치했나요? (어디 일치 / 어디 어긋남)
3. False positive 발견했다면 어떤 건가요?
4. 비용 / 지연 합리적이었나요?
5. 다음에 다시 쓰실 의향?

5명 답변 모이면 LinkedIn에 "5명 첫 사용자 후기" follow-up 포스트.
