/**
 * email-brand.ts — minimal branded wrapper for transactional email (§4-b).
 *
 * The directive: "플레인 텍스트에 최소 브랜드 ... 과한 HTML 메일 금지" (spam score +
 * dark-mode inversion risk). So this produces a DELIVERABLE pair:
 *   - text: the plain-text body — what most clients effectively show (images are
 *     blocked by default; this always reads on its own).
 *   - html: a single-column, table-free, system-font layout on a light card with
 *     the oxblood wordmark as the brand mark and oxblood links/CTA. No remote
 *     images (a blocked-by-default seal would just be a broken icon), no dark
 *     backgrounds to invert, no gradients — the light-mode intent survives most
 *     clients unchanged.
 *
 * Pure + deterministic (HTML-escapes all interpolated content) so it is unit-
 * testable without a live send.
 */

const OXBLOOD = "#8e2c39";
const INK = "#18181b";
const MUTED = "#52525b";
const PARCHMENT = "#faf8f3";

/** Escape the five HTML-significant characters so body content can't break out. */
export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BrandedEmailInput {
  /** Bold lead line (e.g. "Verify your email"). */
  heading: string;
  /** Body paragraphs, in order. */
  paragraphs: string[];
  /** Optional single call-to-action button (the one look-here action). */
  cta?: { label: string; url: string };
  /** Optional small footer note (e.g. "You can keep using Simsa before verifying."). */
  footnote?: string;
}

/**
 * Build the { html, text } pair. `text` is assembled first and is the source of
 * truth for content; `html` renders the same content with the light brand.
 */
export function wrapBrandedEmail(input: BrandedEmailInput): { html: string; text: string } {
  const heading = input.heading ?? "";
  const paragraphs = (input.paragraphs ?? []).filter((p) => typeof p === "string" && p.length > 0);
  const cta = input.cta && input.cta.url ? input.cta : undefined;
  const footnote = input.footnote;

  // ── plain text (the reliable fallback) ────────────────────────────────────
  const textParts = ["Simsa", "", heading, "", ...paragraphs];
  if (cta) textParts.push("", `${cta.label}: ${cta.url}`);
  if (footnote) textParts.push("", footnote);
  const text = textParts.join("\n").trim() + "\n";

  // ── minimal HTML (single column, no tables, no remote images) ─────────────
  const paras = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(p)}</p>`)
    .join("");
  const ctaHtml = cta
    ? `<p style="margin:22px 0 6px;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${OXBLOOD};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 22px;border-radius:999px;">${escapeHtml(cta.label)}</a></p>`
    : "";
  const footHtml = footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(footnote)}</p>`
    : "";
  const html = [
    `<!doctype html><html><body style="margin:0;padding:24px;background:${PARCHMENT};font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Apple SD Gothic Neo','Pretendard',sans-serif;">`,
    `<div style="max-width:460px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:14px;padding:28px 26px;">`,
    // brand mark: oxblood wordmark (reliable — no blocked-image icon)
    `<div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${OXBLOOD};margin:0 0 18px;">Simsa</div>`,
    `<p style="margin:0 0 14px;font-size:17px;font-weight:600;line-height:1.4;color:${INK};">${escapeHtml(heading)}</p>`,
    paras,
    ctaHtml,
    footHtml,
    `</div></body></html>`,
  ].join("");

  return { html, text };
}
