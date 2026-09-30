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
- 신고자의 IP 주소 원문은 저장하지 않습니다. 같은 곳에서 신고가 몰리는 것을 막으려고 비밀 키로 바꾼 값(`v1:` HMAC)만 남깁니다. 연락처는 선택이며 답장할 때만 씁니다.
- 신고는 하루 상한이 있습니다([PILOT]: 같은 네트워크 10건 · 서비스 전체 300건).
- **신고만으로 자동 정지하지 않습니다.** 신고를 대량으로 넣어 남의 앱을 내리는 공격을 막기 위해, 신고 뒤 정지 판단은 운영자가 합니다.

### 3. 정지
- 운영자가 신고를 확인해 규칙 위반이면 주소를 정지합니다. 정지된 주소는 **410**과 짧은 안내("이 앱은 지금 열 수 없어요")만 보여 줍니다. 안내에는 앱 소유자 정보·신고 내용·운영 메모가 나오지 않습니다.
- 요청이 허용량을 계속 넘는 앱은 **자동으로** 정지될 수 있습니다([PILOT]: 앱 하나당 분당 600요청을 넘긴 분이 최근 60분 중 10분 이상). 자동 정지도 운영자에게 바로 알림이 가고, 관리자 정지와 같은 기록에 남습니다.
- 운영자가 24시간 안에 해제한 앱은 자동으로 다시 정지하지 않습니다(갑자기 사람이 몰린 정상 앱 보호).
- **모든 정지와 해제는 기록으로 남습니다**(누가·언제·어떤 사유 코드로·실제 반영 여부).
- 정지는 보통 30초, 늦어도 약 60초 안에 전 세계에 반영됩니다(아래 "정직한 한계").

### 4. 이의 제기
정지가 잘못됐다고 생각하면 이용약관에 적힌 문의처로 **앱 주소와 함께** 알려 주세요. 운영자가 확인해 문제가 없으면 다시 엽니다. 해제도 기록에 남습니다.

### 5. 운영자 절차 (내부)
| 할 일 | 방법 |
|---|---|
| 신고 알림 받기 | 파운더 Telegram DM(`TELEGRAM_BOT_TOKEN` + `FOUNDER_TG_CHAT_ID`). 앱 이름·사유·내용 요지·24시간 신고 수·정지 워크플로 주소가 온다. **연락처·IP는 알림에 싣지 않는다.** |
| 신고 전문·연락처 보기 | Cloudflare 대시보드 → D1 → `conclave-ai` → Console: `SELECT * FROM hosting_reports WHERE slug = '<앱 이름>' ORDER BY created_at DESC` |
| 정지 (1클릭) | GitHub Actions → **hosting-duty** → Run workflow → action `suspend` · slug · 사유 선택 → 실행. 응답의 `applied: true` 확인 |
| 해제 | 같은 워크플로, action `unsuspend` |
| 상태 조회 | 같은 워크플로, action `status` (공개 로그라 개수·상태·사유 코드·시각만 찍는다) |
| 확실한 차단이 더 필요할 때 | 유저 Worker 삭제(`hosting-provision.ts deleteUserWorker`) 병행 — 삭제도 엣지 전파 지연이 있다(2026-09-25 실측) |

### 6. 정직한 한계
- **전파 지연**: 정지 목록은 Workers KV. 정지를 쓴 지역은 즉시, 다른 지역은 라우터의 KV 캐시(30초 — KV가 허용하는 최솟값)와 KV 전파 때문에 최대 약 60초 뒤에 410이 됩니다.
- **정지 목록이 없거나 고장 난 경우**: 라우터는 **서빙을 계속합니다(fail-open)** — 우리 쪽 장애로 모든 호스팅 앱이 동시에 내려가지 않게 하기 위한 선택입니다. 대신 헬스 응답(`/.well-known/simsa-health`의 `suspensionList`)과 로그로 드러나고, 관리자 정지 요청은 503으로 거절됩니다(정지된 척하지 않음). KV 조회 오류 동안에도 라우터가 최근 10분 안에 정지로 확인한 앱은 계속 막습니다.
- **요청 상한은 근사치**: Cloudflare Rate Limiting 바인딩의 카운터는 지역(데이터센터)별이라 전 세계 합계가 정확히 600이 아닙니다. 대규모 트래픽 공격은 이 상한이 아니라 Cloudflare 엣지 보호가 먼저 막습니다. 상한이 앱 단위라서 누군가 한 앱에 요청을 퍼부으면 그 앱의 정상 방문자도 1분간 429를 볼 수 있습니다.
- **이미 방문한 사람의 브라우저**: 정지 전에 앱이 서비스 워커로 화면을 저장해 두었다면, 예전 방문자의 브라우저는 한동안 저장된 화면을 보일 수 있습니다(브라우저가 다음에 서버를 확인할 때 410을 받음). 신고 화면을 앱과 다른 주소에 둔 이유도 이것입니다.

---

## English summary

**Scope.** Apps that Simsa puts online for a user at `<app>.simsa.page` (S mode, design D-6). Apps a user deploys to their own account (A mode) are not hosted by Simsa. Public summary: `https://report.simsa.page/rules` (served by the hosting router, KO/EN). The Terms (`app.trysimsa.com/legal/terms`) remain the legally binding text.

**Not allowed** (codes shared by reports, suspensions and the DB): `phishing` (pages impersonating another service to collect sign-in or payment details) · `spam` (bulk unwanted ads or messages) · `adult` · `malware` (harmful downloads, attacking devices or accounts) · `illegal` (unlawful content or trade, infringing others' rights) · `abuse_other` (excessive requests, attacking people or systems, other abuse).

**Reporting.** Anyone can report at `https://report.simsa.page/?app=<app>` (also reachable via `<app>.simsa.page/.well-known/simsa-report`). The form lives on a separate origin so the reported app cannot intercept or fake it (e.g. with a service worker). Reporter IPs are never stored — only a keyed HMAC (`v1:`) used to stop report floods. Contact is optional and used only to reply. Daily caps [PILOT]: 10 per network, 300 service-wide. Reports alone never auto-suspend an app (mass-report attacks); an operator decides.

**Suspension.** A suspended address returns **410** with a short notice (no owner details, no report contents, no operator memo). Apps that keep exceeding the per-app request cap can be paused automatically [PILOT: more than 600 requests/minute in at least 10 of the last 60 minutes]; the operator is notified and it goes into the same log. An app an operator reopened within 24 hours is not auto-suspended again. Every suspension and reopening is recorded (who, when, reason code, whether it took effect). Propagation: usually within 30 seconds, at most about 60 seconds worldwide.

**Appeals.** Write to the contact in the Terms with the app address. If nothing is wrong after a review, the app is reopened (and that is recorded too).

**Honest limits.** KV propagation (up to ~60 s); if the suspension list is missing or failing the router keeps serving (fail-open — so an outage on our side never takes every hosted app down at once), which the health endpoint and logs expose, and the admin route refuses with 503 instead of pretending; during KV read errors the router keeps blocking apps it saw suspended within the last 10 minutes. The request cap is per Cloudflare location and approximate, and being per-app it can briefly return 429 to legitimate visitors of an app someone is flooding. Browsers that cached a suspended app via a service worker may keep showing it until they next check the server.
