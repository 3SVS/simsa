/**
 * email-brand.test.mjs — minimal branded transactional email wrapper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapBrandedEmail, escapeHtml } from "../dist/workspace/email-brand.js";

test("escapeHtml neutralizes the five significant characters", () => {
  assert.equal(escapeHtml(`<a href="x">O'Brien & co</a>`), "&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; co&lt;/a&gt;");
  assert.equal(escapeHtml(undefined), "");
});

test("wrapBrandedEmail: text carries all content and reads on its own", () => {
  const { text } = wrapBrandedEmail({
    heading: "Verify your email",
    paragraphs: ["First line.", "Second line."],
    cta: { label: "Verify", url: "https://app.trysimsa.com/verify?token=abc" },
    footnote: "You can keep using it before verifying.",
  });
  assert.match(text, /^Simsa/);
  assert.ok(text.includes("Verify your email"));
  assert.ok(text.includes("First line."));
  assert.ok(text.includes("Second line."));
  assert.ok(text.includes("https://app.trysimsa.com/verify?token=abc"));
  assert.ok(text.includes("before verifying"));
});

test("wrapBrandedEmail: html is light, oxblood-branded, table-free, no remote images", () => {
  const { html } = wrapBrandedEmail({
    heading: "Verify your email",
    paragraphs: ["Body."],
    cta: { label: "Verify", url: "https://app.trysimsa.com/verify" },
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("#8e2c39"), "oxblood brand color present");
  assert.ok(html.includes("Simsa"), "wordmark present");
  assert.ok(html.includes("https://app.trysimsa.com/verify"), "cta url present");
  // deliverability rules: no tables, no dark bg, no remote images, no gradients
  assert.ok(!/<table/i.test(html), "must be table-free");
  assert.ok(!/<img/i.test(html), "no remote images (blocked by default → broken icon)");
  assert.ok(!/background:\s*#000|#18181b;?\s*"?>?\s*<body/i.test(html));
  assert.ok(!/gradient/i.test(html), "no gradients");
});

test("wrapBrandedEmail: escapes interpolated content (no HTML injection)", () => {
  const { html } = wrapBrandedEmail({
    heading: "Hi <script>alert(1)</script>",
    paragraphs: ["<b>bold?</b>"],
    cta: { label: "Go", url: "https://x/?a=1&b=2" },
  });
  assert.ok(!html.includes("<script>"), "heading script tag escaped");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;b&gt;bold?&lt;/b&gt;"));
  assert.ok(html.includes("a=1&amp;b=2"), "url ampersand escaped");
});

test("wrapBrandedEmail: cta optional, footnote optional", () => {
  const { html, text } = wrapBrandedEmail({ heading: "Hello", paragraphs: ["Just a note."] });
  assert.ok(!/border-radius:999px/.test(html), "no cta button when cta omitted");
  assert.ok(text.includes("Hello"));
  assert.ok(text.includes("Just a note."));
});
