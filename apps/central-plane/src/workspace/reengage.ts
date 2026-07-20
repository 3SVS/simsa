/**
 * workspace/reengage.ts — G1 복귀 이메일 루프 (2026-07-18 backlog).
 *
 * 빌더팩을 받아 나간 유저를 되부르는 유일한 장치. 매일 1회(크론) 스캔:
 *
 *   대상 = 팩 export가 3~14일 전 && 그 뒤로 이 프로젝트에 아무 활동 없음
 *          && 이메일 채널 opt-in 되어 있음 && 아직 넛지 안 보냄
 *
 * 하드 규칙: (user_key, project_id)당 평생 1통 — 스팸이 되는 순간 신뢰를 잃는
 * 제품이 검수 제품이다. 이메일 미설정 유저는 조용히 건너뛴다(강제 수집 없음 —
 * 수집은 대시보드 export 화면의 선택 입력이 담당).
 *
 * 요약 카운터는 정직하게 분리한다: 실패를 sent로 세지 않는다 (D14 llm_failures
 * 교훈과 동일 원칙).
 */
import type { Env } from "../env.js";
import { getNotificationSettings } from "./notification-db.js";
import { sendWorkspaceEmail, maskEmailAddress } from "./email-notify.js";
import { BRAND } from "./brand.js";

const EXPORT_EVENT = "workspace_builder_pack_exported";
/** 파라미터 (원칙 아님): export 후 며칠 기다렸다 보내는가 / 얼마나 오래된 건 포기하는가. */
const MIN_AGE_DAYS = 3;
const MAX_AGE_DAYS = 14;

export interface ReengageRunSummary {
  scanned: number;
  eligible: number;
  sent: number;
  skipped_no_email: number;
  send_failures: number;
}

/**
 * Train E (2026-07-21): 크론 발신이라 리더 locale을 알 수 없다(서버 저장
 * locale 없음 — 스키마 변경은 하드 게이트라 회피). 무저장 전략 = **이중언어
 * 병기**: KO 본문 + 구분선 + EN 본문 한 통. 제목도 병기.
 */
function nudgeEmail(projectId: string, appBaseUrl: string): { subject: string; text: string } {
  const projectUrl = `${appBaseUrl.replace(/\/$/, "")}/projects/${projectId}`;
  return {
    subject: "만들던 앱, 잘 되고 있나요? — Simsa / How's the app coming along?",
    text: [
      "안녕하세요, Simsa예요.",
      "",
      "며칠 전 만들기 패키지를 받아가셨는데, 그 뒤로 소식이 없어 한 번 여쭤봐요.",
      "",
      "- 만들다가 막혔다면: 프로젝트 화면에서 상황을 알려주세요. 다음에 할 일을 쉬운 말로 알려드려요.",
      "- 다 만들었다면: 앱 주소를 연결해 주세요. 잘 만들어졌는지 대신 확인해드립니다.",
      "- 아직 시작 전이라면: 패키지 안의 지시서를 개발 AI 채팅창에 붙여넣는 것부터 시작하면 돼요.",
      "",
      `내 프로젝트 열기: ${projectUrl}`,
      "",
      "이 메일은 이 프로젝트에 대해 딱 한 번만 보내드려요.",
      "— Simsa",
      "",
      "----------------------------------------",
      "",
      "Hi, this is Simsa.",
      "",
      "You picked up a builder pack a few days ago and we haven't heard from you since — just checking in.",
      "",
      "- Stuck while building? Tell us what happened on your project screen and we'll explain the next step in plain language.",
      "- Finished building? Connect your app's URL and we'll check that it actually works.",
      "- Haven't started? Begin by pasting the brief from the pack into your dev AI's chat.",
      "",
      `Open my project: ${projectUrl}`,
      "",
      "We only send this email once per project.",
      "— Simsa",
    ].join("\n"),
  };
}

export async function runReengageNudges(
  env: Env,
  opts: { fetchImpl?: typeof fetch; nowMs?: number } = {},
): Promise<ReengageRunSummary> {
  const summary: ReengageRunSummary = { scanned: 0, eligible: 0, sent: 0, skipped_no_email: 0, send_failures: 0 };
  const now = opts.nowMs ?? Date.now();
  const minIso = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString();
  const maxIso = new Date(now - MIN_AGE_DAYS * 86_400_000).toISOString();

  // 후보: 창(3~14일 전) 안의 export를 (user, project)별 마지막 시각으로 집계.
  // 창 이후(어제 등)에 또 export했다면 그 자체가 활동이므로 아래 활동 검사에서 걸러진다.
  const candidates = await env.DB.prepare(
    `SELECT user_key, project_id, MAX(created_at) AS last_export_at
       FROM workspace_usage_events
      WHERE event_type = ?
        AND project_id IS NOT NULL
        AND user_key != 'anonymous'
        AND created_at >= ? AND created_at <= ?
      GROUP BY user_key, project_id
      LIMIT 200`,
  )
    .bind(EXPORT_EVENT, minIso, maxIso)
    .all<{ user_key: string; project_id: string; last_export_at: string }>()
    .catch(() => ({ results: [] as Array<{ user_key: string; project_id: string; last_export_at: string }> }));

  for (const cand of candidates.results ?? []) {
    summary.scanned += 1;

    // 활동 검사: export 이후 이 프로젝트에 어떤 이벤트든 있으면 복귀한 것.
    const activity = await env.DB.prepare(
      `SELECT id FROM workspace_usage_events
        WHERE user_key = ? AND project_id = ? AND created_at > ? AND event_type != ?
        LIMIT 1`,
    )
      .bind(cand.user_key, cand.project_id, cand.last_export_at, EXPORT_EVENT)
      .first<{ id: string }>()
      .catch(() => null);
    if (activity) continue;

    // 이미 넛지했으면 평생 스킵.
    const nudged = await env.DB.prepare(
      `SELECT sent_at FROM reengage_nudges WHERE user_key = ? AND project_id = ?`,
    )
      .bind(cand.user_key, cand.project_id)
      .first<{ sent_at: string }>()
      .catch(() => null);
    if (nudged) continue;

    summary.eligible += 1;

    const settings = await getNotificationSettings(env, cand.user_key, "email").catch(() => null);
    if (!settings || !settings.enabled || !settings.chatId) {
      summary.skipped_no_email += 1;
      continue;
    }

    const appBaseUrl = env.DASHBOARD_BASE_URL ?? BRAND.appUrl;
    const mail = nudgeEmail(cand.project_id, appBaseUrl);
    const res = await sendWorkspaceEmail(
      env,
      { to: settings.chatId, subject: mail.subject, text: mail.text },
      opts.fetchImpl as never,
    );
    if (!res.ok) {
      // 실패는 기록하지 않는다 — 다음 크론에서 자연 재시도(1회 규칙은 성공 기준).
      summary.send_failures += 1;
      console.warn(`[reengage] send failed to ${maskEmailAddress(settings.chatId)}: ${res.error}`);
      continue;
    }

    await env.DB.prepare(
      `INSERT INTO reengage_nudges (user_key, project_id, sent_at) VALUES (?, ?, ?)
       ON CONFLICT(user_key, project_id) DO NOTHING`,
    )
      .bind(cand.user_key, cand.project_id, new Date(now).toISOString())
      .run()
      .catch(() => undefined);
    summary.sent += 1;
  }

  return summary;
}
