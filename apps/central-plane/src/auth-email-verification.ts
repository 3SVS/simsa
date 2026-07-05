/**
 * auth-email-verification.ts — D2 soft-auth: email verification as a CLAIM gate.
 *
 * Decision D2 (2026-07-05): sign-up is usable immediately (no login block). Only
 * SERVER binding — claiming this browser's projects into the account for
 * cross-device sync — requires a verified email. Crucially this is soft:
 *
 *   - Verification is enabled ONLY when Resend is actually configured, because a
 *     gate you can't send a verification email through would strand every user.
 *     RESEND_API_KEY unset → verification off → claim behaves exactly as before.
 *   - AUTH_EMAIL_VERIFICATION="off" is an explicit kill switch even with Resend on.
 *   - It gates the claim (cross-device sync), never sign-in.
 *
 * Pure + deterministic so both the gate decision and the email copy are
 * unit-testable without a live Better Auth runtime or Resend.
 */
import type { Env } from "./env.js";

/**
 * Whether the workspace-claim step should require a verified email. True only
 * when verification mail can actually be sent (Resend configured) and the kill
 * switch is not set. Fail-open by construction: no Resend → false → claim works
 * exactly as it did before this feature.
 */
export function emailVerificationRequired(env: Partial<Env> | undefined): boolean {
  const e = env ?? {};
  if (typeof e.AUTH_EMAIL_VERIFICATION === "string" && e.AUTH_EMAIL_VERIFICATION.toLowerCase() === "off") {
    return false;
  }
  return typeof e.RESEND_API_KEY === "string" && e.RESEND_API_KEY.trim().length > 0;
}

/**
 * The verification email body (subject + plain text). Korean-first for the
 * non-developer audience, with an English line. The link is the caller-supplied
 * Better Auth verification URL; nothing else sensitive is included.
 */
export function buildVerificationEmail(
  url: string,
  opts?: { appName?: string },
): { subject: string; text: string } {
  const appName = opts?.appName ?? "Simsa";
  const subject = `${appName} 이메일 인증 · verify your email`;
  const text = [
    `${appName} 가입을 완료하려면 아래 링크로 이메일을 인증해 주세요.`,
    `인증하면 다른 기기에서도 프로젝트를 볼 수 있어요. (인증 전에도 이 브라우저에서는 그대로 사용하실 수 있습니다.)`,
    ``,
    url,
    ``,
    `— — —`,
    `Verify your email to finish setting up ${appName} and sync your projects across devices.`,
    `You can keep using ${appName} in this browser before verifying.`,
    ``,
    url,
  ].join("\n");
  return { subject, text };
}
