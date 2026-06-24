// Stage 139 — safe Web App handoff link builder.
//
// Pure URL builder that sends a user from an agent host back to the Simsa Web
// App with SAFE context only. It does NOT save anything, create an account,
// trigger payment, assume a payment provider, or execute tools. Raw private
// content and obvious secrets/tokens are omitted (never throws). Deterministic
// key ordering. No network, no env, no mutation.

const DEFAULT_BASE_URL = "https://app.trysimsa.com";
const DEFAULT_PATH = "/projects/new/intake";
const TITLE_MAX = 80;
const SUMMARY_MAX = 240;

const INTENTS = [
  "new_intake",
  "save_workflow",
  "open_history",
  "unlock_advanced",
  "manage_team",
  "review_preview",
];
const SOURCES = ["mcp_basic", "dashboard", "unknown"];
const INTAKE_TYPES = ["idea", "prd", "product_url", "github_repo", "pull_request", "ai_built_app"];

// Obvious secret / token / credential patterns — if a value matches, omit it.
const SENSITIVE_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /ghp_[A-Za-z0-9]/,
  /github_pat_/i,
  /vercel_/i,
  /xox[baprs]-/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/i,
  /password\s*=/i,
  /token\s*=/i,
  /secret\s*=/i,
  /api[_-]?key\s*=/i,
  /authorization\s*:/i,
  /bearer\s+[A-Za-z0-9._-]{12,}/i,
  /AKIA[0-9A-Z]{12,}/,
];

function str(x) {
  return typeof x === "string" ? x : "";
}

/** Strip ASCII control characters (keep normal printable text + non-ASCII). */
function stripControl(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c !== 127) out += ch;
  }
  return out;
}

function looksSensitive(value) {
  return SENSITIVE_PATTERNS.some((re) => re.test(value));
}

/**
 * @param {import("./web-app-handoff-link.d.mts").WebAppHandoffInput} [input]
 * @returns {import("./web-app-handoff-link.d.mts").WebAppHandoffLink}
 */
export function buildWebAppHandoffLink(input = {}) {
  const i = input && typeof input === "object" ? input : {};
  const omittedFields = [];
  const warnings = [];

  // Base URL — must be a valid http(s) URL, else fall back.
  let base = DEFAULT_BASE_URL;
  const rawBase = str(i.baseUrl).trim();
  if (rawBase) {
    try {
      const u = new URL(rawBase);
      if (u.protocol === "http:" || u.protocol === "https:") base = `${u.protocol}//${u.host}`;
      else warnings.push("baseUrl ignored: non-http(s) protocol");
    } catch {
      warnings.push("baseUrl ignored: invalid URL");
    }
  }

  const intent = INTENTS.includes(str(i.intent)) ? str(i.intent) : "new_intake";
  const source = SOURCES.includes(str(i.source)) ? str(i.source) : "mcp_basic";

  /** @type {Record<string,string>} */
  const query = { source, intent };

  // intakeType — only a known safe value is included.
  const intakeType = str(i.intakeType).trim();
  if (intakeType) {
    if (INTAKE_TYPES.includes(intakeType)) query.type = intakeType;
    else {
      omittedFields.push("intakeType");
      warnings.push("intakeType omitted: unknown value");
    }
  }

  if (str(i.previewKind).trim()) query.preview = stripControl(str(i.previewKind).trim()).slice(0, 64);

  // Free-text fields: strip control chars, truncate, and omit if sensitive.
  const addSafeText = (key, raw, max, label) => {
    const cleaned = stripControl(str(raw)).trim();
    if (!cleaned) return;
    if (looksSensitive(cleaned)) {
      omittedFields.push(label);
      warnings.push(`${label} omitted: looks sensitive (possible secret/token)`);
      return;
    }
    query[key] = cleaned.slice(0, max);
  };
  addSafeText("title", i.title, TITLE_MAX, "title");
  addSafeText("summary", i.safeSummary, SUMMARY_MAX, "safeSummary");
  addSafeText("previewId", i.previewId, 64, "previewId");

  // utm_* passthrough (safe, short).
  if (str(i.utmSource).trim()) query.utm_source = stripControl(str(i.utmSource).trim()).slice(0, 64);
  if (str(i.utmMedium).trim()) query.utm_medium = stripControl(str(i.utmMedium).trim()).slice(0, 64);
  if (str(i.utmCampaign).trim()) query.utm_campaign = stripControl(str(i.utmCampaign).trim()).slice(0, 64);

  // Deterministic key ordering.
  const orderedKeys = Object.keys(query).sort();
  const params = new URLSearchParams();
  for (const k of orderedKeys) params.set(k, query[k]);

  const path = DEFAULT_PATH;
  const url = `${base}${path}?${params.toString()}`;

  return {
    url,
    path,
    query: Object.fromEntries(orderedKeys.map((k) => [k, query[k]])),
    omittedFields,
    warnings,
    boundary: {
      containsRawPrivateContent: false,
      containsSecrets: false,
      createsPersistence: false,
      requiresPayment: false,
      assumesPaymentProvider: false,
    },
  };
}

export { DEFAULT_BASE_URL as WEB_APP_HANDOFF_DEFAULT_BASE_URL };
