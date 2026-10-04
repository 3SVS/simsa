# Simsa 호스팅 이용 규칙 · Hosting Acceptable Use

> 적용 범위: Simsa가 사용자를 대신해 `<앱 이름>.simsa.page` 주소로 올려 드린 앱(S 모드, 설계 D-6).
> 사용자가 자기 계정으로 직접 배포한 앱(A 모드)은 Simsa가 호스팅하지 않으므로 이 규칙의 정지 대상이 아니다.
> 공개 요약본은 `https://report.simsa.page/rules`(호스팅 라우터가 직접 서빙, KO/EN)이고, 이 문서가 운영 정본이다.
> 법적 효력의 정본은 이용약관(`app.trysimsa.com/legal/terms`) — 이 문서는 그 약관의 사용자 의무 조항을 호스팅에 맞게 풀어 쓴 것이다.
>
> 결정 근거: `docs/simsa-si-tier-design-2026-09-24.md` D-6 "호스팅 사업자 의무(파일럿 전 필수)". 구현: Train B · B-7.

---

## 한국어 요지

### 1. 올릴 수 없는 것
Simsa가 올려 드린 앱에는 아래 내용을 올릴 수 없습니다.

| 코드 | 금지 내용 |
|---|---|
| `phishing` | **피싱** — 다른 서비스(은행·결제·메신저 등)인 척 로그인·결제 정보를 받는 화면 |
| `spam` | **스팸** — 원치 않는 광고·메시지를 대량으로 보내거나 퍼뜨리는 것 |
| `adult` | **성인 콘텐츠** |
| `malware` | **악성 프로그램** — 위험한 파일 배포, 기기·계정 공격 |
| `illegal` | **불법 콘텐츠** — 법에 어긋나는 내용이나 거래, 남의 권리(저작권·초상권 등) 침해 |
| `abuse_other` | **서비스를 망가뜨리는 사용** — 지나치게 많은 요청, 다른 사람이나 시스템 공격, 그 밖의 악용 |

### 2. 신고
- 누구나 `https://report.simsa.page/?app=<앱 이름>`에서 신고할 수 있습니다. 앱 주소 끝에 `/.well-known/simsa-report`를 붙여도 같은 곳으로 갑니다.
- 신고 폼은 앱 주소와 **다른 주소**(report.simsa.page)에서 열립니다 — 신고 대상 앱이 신고 화면을 가로채거나 흉내 낼 수 없게 하기 위해서입니다.
- 신고자의 IP 주소 원문은 저장하지 않습니다. 같은 곳에서 신고가 몰리는 것을 막으려고 신고자 **네트워크**(IPv4 주소 · IPv6는 앞 64비트)를 비밀 키로 바꾼 값(`v1:` HMAC)만 남깁니다. 연락처는 선택이며 답장할 때만 씁니다. **신고는 180일 뒤 지웁니다**([PILOT], 6시간 크론).
- 신고 폼은 `report.simsa.page`에서 보낸 것만 받습니다(다른 사이트가 방문자 브라우저로 몰래 제출하는 것 차단). Simsa가 **실제로 올린 앱**(빌드 기록이 있는 앱 이름)만 신고할 수 있습니다.
- 하루 상한([PILOT]): 같은 네트워크 10건 · 같은 앱 50건(넘으면 "이미 많이 들어와 운영자가 확인 중"). **서비스 전체 건수로는 거절하지 않습니다** — 누군가 신고를 몰아넣어 하루 동안 신고 창구 전체를 닫지 못하게. 서비스 전체가 하루 300건을 넘으면 운영자 알림에 "평소보다 많다"고만 적습니다.
- 운영자 알림(파운더 Telegram)은 **한 시간에 한 통**으로 묶습니다. 그 시간의 첫 신고는 바로, 나머지는 다음 시간에 한 통으로.
- **신고만으로 자동 정지하지 않습니다.** 신고를 대량으로 넣어 남의 앱을 내리는 공격을 막기 위해, 신고 뒤 정지 판단은 운영자가 합니다.
- **신고 접수는 스위치로 켭니다**: `HOSTING_REPORTS_ENABLED`(central-plane · hosting-dispatch 둘 다)가 정확히 `"on"`일 때만 받습니다. 기본 `"off"` — 개인정보처리방침에 '앱 신고' 수집 항목을 고지한 **뒤에** 켭니다. 꺼져 있으면 신고 페이지는 "준비 중"(503, 폼 없음), API는 503.

### 3. 정지
- 운영자가 신고를 확인해 규칙 위반이면 주소를 정지합니다. 정지된 주소는 **410**과 짧은 안내("이 앱은 지금 열 수 없어요")만 보여 줍니다. 안내에는 앱 소유자 정보·신고 내용·운영 메모가 나오지 않습니다.
- **정지는 사람(운영자)만 합니다. 요청 양만으로는 정지하지 않습니다.** 앱 하나에 요청이 허용량([PILOT]: 페이지 열림 분당 600 · 모든 요청 분당 6,000)을 넘으면 방문자는 잠깐 "잠시 후 다시 시도해 주세요"(429)를 보고, 그런 분이 최근 60분 중 10분 이상이면 운영자에게 알림이 가고 기록(플래그, `source=auto_flag`)이 남습니다 — 같은 앱은 6시간에 한 번만 알립니다. 요청 몰림은 남이 일부러 몰아넣은 것일 수도 있어서(그때 자동 정지하면 공격자가 남의 앱을 무기한 내릴 수 있다), 앱을 보고 정지할지는 운영자가 정합니다.
- 운영자가 정지하면 그 앱의 열린 신고가 "처리됨"으로 닫히고(어느 정지로 닫혔는지 남음), 해제하면 그 신고들이 다시 열립니다.
- **모든 정지·해제·플래그는 기록으로 남습니다**(누가·언제·어떤 사유 코드로·실제 반영 여부).
- 정지는 보통 30초, 늦어도 약 60초 안에 전 세계에 반영됩니다(아래 "정직한 한계").

### 4. 이의 제기
정지가 잘못됐다고 생각하면 이용약관에 적힌 문의처로 **앱 주소와 함께** 알려 주세요. 운영자가 확인해 문제가 없으면 다시 엽니다. 해제도 기록에 남습니다.

### 5. 운영자 절차 (내부)
| 할 일 | 방법 |
|---|---|
| 신고 알림 받기 | 파운더 Telegram DM(`TELEGRAM_BOT_TOKEN` + `FOUNDER_TG_CHAT_ID`), **한 시간에 한 통 묶음**. 앱별 건수·사유·내용 요지·오늘 건수·정지 워크플로 주소가 온다. **연락처·IP는 알림에 싣지 않는다.** |
| 요청 몰림 알림 받기 | 같은 DM. "⚠️ 요청 몰림 (정지하지 않았어요)" — 앱을 열어 보고 규칙 위반이면 아래 정지 |
| 신고 전문·연락처 보기 | Cloudflare 대시보드 → D1 → `conclave-ai` → Console: `SELECT * FROM hosting_reports WHERE slug = '<앱 이름>' ORDER BY created_at DESC` |
| 정지 (1클릭) | GitHub Actions → **hosting-duty** → Run workflow → action `suspend` · slug · 사유 선택 → 실행. 응답의 `applied: true` 확인 |
| 해제 | 같은 워크플로, action `unsuspend` |
| 상태 조회 | 같은 워크플로, action `status` (공개 로그라 개수·상태·사유 코드·시각만 찍는다) |
| 확실한 차단이 더 필요할 때 | 유저 Worker 삭제(`hosting-provision.ts deleteUserWorker`) 병행 — 삭제도 엣지 전파 지연이 있다(2026-09-25 실측) |

### 6. 정직한 한계
- **전파 지연**: 정지 목록은 Workers KV. 정지를 쓴 지역은 즉시, 다른 지역은 라우터의 KV 캐시(30초 — KV가 허용하는 최솟값)와 KV 전파 때문에 최대 약 60초 뒤에 410이 됩니다.
- **정지 목록이 없거나 고장 난 경우**: 라우터는 **서빙을 계속합니다(fail-open)** — 우리 쪽 장애로 모든 호스팅 앱이 동시에 내려가지 않게 하기 위한 선택입니다. 대신 헬스 응답(`/.well-known/simsa-health`의 `suspensionList`)과 로그로 드러나고, 관리자 정지 요청은 503으로 거절됩니다(정지된 척하지 않음). KV 조회 오류 동안에도 라우터가 최근 10분 안에 정지로 확인한 앱은 계속 막습니다.
- **요청 상한은 근사치**: Cloudflare Rate Limiting 바인딩의 카운터는 지역(데이터센터)별이라 전 세계 합계가 정확한 값이 아닙니다. 대규모 트래픽 공격은 이 상한이 아니라 Cloudflare 엣지 보호가 먼저 막습니다. 상한이 앱 단위라서 누군가 한 앱에 요청을 퍼부으면 그 앱의 정상 방문자도 그동안 429를 볼 수 있습니다(정지는 되지 않고, 몰림이 끝나면 바로 다시 열립니다). "페이지 열림"은 브라우저가 보내는 헤더로 판단하므로 흉내 낼 수 있어, 모든 요청을 세는 두 번째 상한을 둡니다. 헬스 응답에는 상한 수치를 싣지 않습니다.
- **이미 방문한 사람의 브라우저**: 정지 전에 앱이 서비스 워커로 화면을 저장해 두었다면, 예전 방문자의 브라우저는 한동안 저장된 화면을 보일 수 있습니다(브라우저가 다음에 서버를 확인할 때 410을 받음). 신고 화면을 앱과 다른 주소에 둔 이유도 이것입니다.

---

## English summary

**Scope.** Apps that Simsa puts online for a user at `<app>.simsa.page` (S mode, design D-6). Apps a user deploys to their own account (A mode) are not hosted by Simsa. Public summary: `https://report.simsa.page/rules` (served by the hosting router, KO/EN). The Terms (`app.trysimsa.com/legal/terms`) remain the legally binding text.

**Not allowed** (codes shared by reports, suspensions and the DB): `phishing` (pages impersonating another service to collect sign-in or payment details) · `spam` (bulk unwanted ads or messages) · `adult` · `malware` (harmful downloads, attacking devices or accounts) · `illegal` (unlawful content or trade, infringing others' rights) · `abuse_other` (excessive requests, attacking people or systems, other abuse).

**Reporting.** Anyone can report at `https://report.simsa.page/?app=<app>` (also reachable via `<app>.simsa.page/.well-known/simsa-report`). The form lives on a separate origin so the reported app cannot intercept or fake it (e.g. with a service worker). Reporter IPs are never stored — only a keyed HMAC (`v1:`) of the reporter's network (the IPv4 address, or the IPv6 /64) used to stop report floods. Contact is optional and used only to reply; reports are deleted after 180 days [PILOT]. Form posts are accepted only from `report.simsa.page`, and only apps Simsa actually built can be reported. Daily caps [PILOT]: 10 per network, 50 per app; there is **no service-wide rejection** (so nobody can close the whole channel for a day) — above 300 a day the operator digest only notes the volume. Operator notifications are batched to one per hour. Reports alone never auto-suspend an app (mass-report attacks); an operator decides. Intake is behind a switch (`HOSTING_REPORTS_ENABLED`, exactly `"on"`; default off until the privacy policy lists the report data).

**Suspension.** A suspended address returns **410** with a short notice (no owner details, no report contents, no operator memo). **Only an operator suspends; traffic volume alone never does.** When an app exceeds the per-app request caps [PILOT: 600 page loads/minute, 6,000 requests/minute] visitors briefly get 429; if that happens in at least 10 of the last 60 minutes the operator is alerted and a flag (`source=auto_flag`) is logged, at most once per 6 hours per app. (A flood may be someone else's doing — auto-suspending would let an attacker take any app down indefinitely.) An operator suspension closes the app's open reports (recording which suspension closed them); unsuspending reopens them. Every suspension, reopening and flag is recorded (who, when, reason code, whether it took effect). Propagation: usually within 30 seconds, at most about 60 seconds worldwide.

**Appeals.** Write to the contact in the Terms with the app address. If nothing is wrong after a review, the app is reopened (and that is recorded too).

**Honest limits.** KV propagation (up to ~60 s); if the suspension list is missing or failing the router keeps serving (fail-open — so an outage on our side never takes every hosted app down at once), which the health endpoint and logs expose, and the admin route refuses with 503 instead of pretending; during KV read errors the router keeps blocking apps it saw suspended within the last 10 minutes. The request caps are per Cloudflare location and approximate, and being per-app they can return 429 to legitimate visitors of an app someone is flooding while the flood lasts (never a suspension). The health endpoint does not publish the cap values. Browsers that cached a suspended app via a service worker may keep showing it until they next check the server.
