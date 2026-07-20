"use client";

// Prep layer A2b: the self-contained "set up the services + deploy tools your
// app needs" block. Moved out of the builder-pack (export) page so it lives on
// the prep (settings) step instead. Holds its own state, seeds from the shared
// store-or-detect helper, and persists every change to the browser-only store
// (sessionStorage) so the values carry to the builder-pack export. No values
// ever go to a server here.

import { useEffect, useState } from "react";
import Link from "next/link";
import { hasAnyValue, allCatalogServices, catalogServiceById } from "@/lib/service-catalog.mjs";
import type { CatalogService } from "@/lib/service-catalog.mjs";
import { detectMcpTools } from "@/lib/mcp-catalog.mjs";
import type { McpTool } from "@/lib/mcp-catalog.mjs";
import { agentLabel, resolveMcpConnect, DEV_AGENTS } from "@/lib/agent-registry.mjs";
import { seedServiceSetup, saveServiceValues } from "@/lib/service-values-store.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/components/Toast";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

type SpecLike = {
  oneLine?: string;
  problem?: string;
  included?: string[];
  userFlow?: string[];
  productName?: string;
};

export function ServiceMcpSetup({ projectId, spec }: { projectId: string; spec: SpecLike }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  // Seed from the store (values entered earlier) or fresh detection from the
  // spec — the single shared seed both this panel and export use. Copy is
  // resolved in the CURRENT locale (journey-audit v2 P1: EN 화면에 이 카드만
  // 한국어로 남던 누수); stored VALUES survive locale switches.
  const [services, setServices] = useState<CatalogService[]>(
    () => seedServiceSetup(projectId, spec, locale) as CatalogService[],
  );
  // Locale switch re-resolves the copy without losing entered values.
  useEffect(() => {
    setServices(seedServiceSetup(projectId, spec, locale) as CatalogService[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
  // Persist every change (browser-only) so the values reach the builder pack.
  useEffect(() => { saveServiceValues(projectId, services); }, [projectId, services]);

  // Explicit save: the panel already auto-persists on every keystroke, but users
  // had no signal it was saved (Bae's feedback). This button makes the save
  // tangible — a confirmed write + toast — without changing the storage path.
  function handleSave() {
    saveServiceValues(projectId, services);
    toast.success(t.exportPage.prep.saved);
  }

  // Which agent's MCP connect steps to show (settings has no target selector).
  const [agentId, setAgentId] = useState<string>("claude_code");
  const deployTools: McpTool[] = detectMcpTools();

  function setEnvValue(serviceId: string, key: string, value: string) {
    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceId
          ? { ...s, envVars: s.envVars.map((v) => (v.key === key ? { ...v, value } : v)) }
          : s,
      ),
    );
  }
  function addService(serviceId: string) {
    setServices((prev) => {
      if (prev.some((s) => s.id === serviceId)) return prev;
      const svc = catalogServiceById(serviceId, locale);
      return svc ? [...prev, svc] : prev;
    });
  }
  function removeService(serviceId: string) {
    setServices((prev) => prev.filter((s) => s.id !== serviceId));
  }
  const addableServices = allCatalogServices(locale).filter(
    (c) => !services.some((s) => s.id === c.id),
  );

  return (
    <div className="space-y-4">
      <ServiceSetupPanel
        services={services}
        addable={addableServices}
        onEnvChange={setEnvValue}
        onAdd={addService}
        onRemove={removeService}
      />
      <McpSetupPanel tools={deployTools} agentId={agentId} onAgentChange={setAgentId} />
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleSave} className="btn btn-md btn-primary">
          {t.exportPage.prep.save}
        </button>
        <span className="text-xs text-gray-400">{t.exportPage.prep.savedHint}</span>
      </div>
      {/* Forward exit: saving used to dead-end with just a toast (Bae). Point at
          the builder pack — that's where these values are consumed next. */}
      <Link
        href={`/projects/${projectId}/export`}
        className="inline-flex text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        {t.exportPage.prep.next}
      </Link>
    </div>
  );
}

// ─── Panels (moved from the export page) ────────────────────────────────────

function ServiceSetupPanel({
  services,
  addable,
  onEnvChange,
  onAdd,
  onRemove,
}: {
  services: CatalogService[];
  addable: CatalogService[];
  onEnvChange: (serviceId: string, key: string, value: string) => void;
  onAdd: (serviceId: string) => void;
  onRemove: (serviceId: string) => void;
}) {
  const { t } = useI18n();
  const p = t.exportPage.prep;
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());

  if (services.length === 0 && addable.length === 0) return null;

  function toggleSteps(sid: string) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-gray-800">{p.title}</h2>
        <span className="text-xs text-gray-400 flex-shrink-0">{p.optional}</span>
      </div>
      <p className="text-sm text-gray-500 mb-3">{p.intro}</p>
      <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mb-4">{p.noStore}</p>

      <div className="space-y-3">
        {services.map((s) => (
          <div key={s.id} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-sm font-medium text-gray-800">{s.label}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {s.setupUrl && (
                  <a href={s.setupUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1 rounded-lg font-medium bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 transition-colors">
                    {p.signup} ↗
                  </a>
                )}
                {s.setupSteps && s.setupSteps.length > 0 && (
                  <button onClick={() => toggleSteps(s.id)}
                    className="text-xs px-3 py-1 rounded-lg font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                    {openSteps.has(s.id) ? p.stepsHide : p.stepsShow}
                  </button>
                )}
                <button onClick={() => onRemove(s.id)} title={p.remove} aria-label={p.remove}
                  className="text-xs px-2 py-1 rounded-lg font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  ✕
                </button>
              </div>
            </div>
            {s.why && <p className="text-xs text-gray-500 mb-2">{s.why}</p>}
            {openSteps.has(s.id) && s.setupSteps && (
              <ol className="space-y-1 text-xs text-gray-600 mb-3 pl-1">
                {s.setupSteps.map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brand-500 font-semibold flex-shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="space-y-2.5">
              {s.envVars.map((v) => (
                <div key={v.key}>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs font-mono text-gray-700">{v.key}</code>
                    {v.secret && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">{p.secretBadge}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-1.5">{v.description}</p>
                  <input
                    type={v.secret ? "password" : "text"}
                    value={v.value ?? ""}
                    onChange={(e) => onEnvChange(s.id, v.key, e.target.value)}
                    placeholder={v.example ?? p.valuePlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {addable.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">{p.addMore}:</span>
          {addable.map((c) => (
            <button key={c.id} onClick={() => onAdd(c.id)}
              className="text-xs px-3 py-1 rounded-lg font-medium bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 transition-colors">
              + {c.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500 mt-4">{p.note}</p>
    </div>
  );
}

function McpSetupPanel({
  tools,
  agentId,
  onAgentChange,
}: {
  tools: McpTool[];
  agentId: string;
  onAgentChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const d = t.exportPage.deployTools;
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  if (tools.length === 0) return null;
  const label = agentLabel(agentId);

  async function copyCommand(id: string, text: string) {
    await copyText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-1">{d.title}</h2>
      <p className="text-sm text-gray-500 mb-3">{d.intro}</p>

      {/* Agent picker — the connect steps follow the chosen dev AI. */}
      <div className="flex gap-2 mb-3">
        {DEV_AGENTS.map((a) => (
          <button key={a.id} onClick={() => onAgentChange(a.id)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              agentId === a.id ? "bg-brand-600 text-white border-brand-600" : "bg-white text-gray-700 border-gray-200 hover:border-brand-300"
            }`}>
            {a.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mb-4">
        {d.whatIsMcp.replace("{agent}", label)}
      </p>

      <div className="space-y-3">
        {tools.map((tool) => {
          const conn = resolveMcpConnect(agentId, { mcpName: tool.mcpName, serverUrl: tool.serverUrl });
          const isCommand = conn.style === "command";
          const copyValue = isCommand ? conn.command! : conn.serverUrl!;
          const authStep = (isCommand ? d.authStepCommand : d.authStepSettings).replace("{agent}", label);
          return (
            <div key={tool.id} className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-sm font-medium text-gray-800">{tool.label}</span>
                {tool.docsUrl && (
                  <a href={tool.docsUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1 rounded-lg font-medium bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 transition-colors flex-shrink-0">
                    {d.docsLabel} ↗
                  </a>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-3">{tool.purpose}</p>

              <div className="mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                  {isCommand ? d.commandLabel : d.serverUrlLabel}
                </p>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap bg-gray-900 text-gray-100 rounded-lg px-3 py-2 text-xs font-mono">
                    {copyValue}
                  </code>
                  <button onClick={() => copyCommand(tool.id, copyValue)}
                    className="flex-shrink-0 text-xs px-3 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                    {copiedCmd === tool.id ? t.exportPage.copied : t.exportPage.copy}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-gray-600">
                  <span className="font-medium text-gray-700">{d.authStepLabel}:</span> {authStep}
                </p>
              </div>

              <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 mb-0.5">{d.safetyLabel}</p>
                <p className="text-xs text-brand-700">{tool.authNote}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
