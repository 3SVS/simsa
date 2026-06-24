"use client";

// Stage 170 — local account-settings stub. NO real auth/identity/session: display
// name + preferred locale are local-only (this browser), connected-accounts and
// team/workspace are read-only status or "Planned". Auth-dependent actions are shown
// disabled. No server calls, no migration, no tokens.
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import {
  readDisplayName,
  writeDisplayName,
  displayInitial,
  DISPLAY_NAME_MAX,
} from "@/lib/account-preferences.mjs";

function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "gold" | "muted" }) {
  const cls =
    tone === "gold"
      ? "bg-gold-100 text-gold-700"
      : tone === "muted"
        ? "bg-gray-100 text-gray-400"
        : "bg-gray-100 text-gray-600";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

export default function AccountPage() {
  const { t } = useI18n();
  const a = t.account;
  const [displayName, setDisplayName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDisplayName(readDisplayName(typeof window !== "undefined" ? window.localStorage : null, ""));
    setHydrated(true);
  }, []);

  function onChange(v: string) {
    setDisplayName(v);
    writeDisplayName(typeof window !== "undefined" ? window.localStorage : null, v);
  }

  const initial = displayInitial(displayName, "S");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{a.title}</h1>
      <p className="mt-2 text-sm text-gray-500">{a.subtitle}</p>

      {/* Profile */}
      <section className="card mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="section-title">{a.sections.profile}</p>
          <Badge tone="gold">{a.badges.local}</Badge>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-brand-700 text-sm font-semibold text-brand-100">
            {initial}
          </span>
          <label className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-gray-500">{a.profile.displayName}</span>
            <input
              value={displayName}
              maxLength={DISPLAY_NAME_MAX}
              onChange={(e) => onChange(e.target.value)}
              placeholder={a.profile.displayNamePlaceholder}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">{a.profile.storedLocally}</p>
        <p className="mt-1 text-xs text-gray-400">
          {a.profile.emailRequiresSignIn} <Badge tone="muted">{a.badges.requiresSignIn}</Badge>
        </p>
        {!hydrated && <span className="sr-only">loading</span>}
      </section>

      {/* Preferences */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.preferences}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-700">{a.preferences.language}</span>
          <LanguageToggle />
        </div>
        <p className="mt-2 text-xs text-gray-400">{a.preferences.languageHelp}</p>
      </section>

      {/* Connected accounts */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.connectedAccounts}</p>
        <ul className="mt-3 space-y-2">
          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-700">{a.connectedAccounts.github}</span>
            <span className="flex items-center gap-2 text-xs text-gray-400">
              {a.connectedAccounts.githubStatus} <Badge tone="muted">{a.badges.readOnly}</Badge>
            </span>
          </li>
          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-700">{a.connectedAccounts.vercel}</span>
            <span className="flex items-center gap-2 text-xs text-gray-400">
              {a.connectedAccounts.vercelStatus} <Badge tone="muted">{a.badges.planned}</Badge>
            </span>
          </li>
        </ul>
        <p className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {a.connectedAccounts.readFirst}
        </p>
      </section>

      {/* Data & export */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.data}</p>
        <p className="mt-3 text-sm text-gray-600">{a.data.projectExports}</p>
        <p className="mt-1 text-xs text-gray-400">{a.data.accountExportPlanned}</p>
        <p className="mt-1 text-xs text-gray-400">{a.data.importPlanned}</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" disabled className="btn btn-secondary btn-sm cursor-not-allowed opacity-50">
            {a.data.deleteAccount}
          </button>
          <Badge tone="muted">{a.badges.requiresSignIn}</Badge>
        </div>
        <p className="mt-1 text-xs text-gray-400">{a.data.deleteRequiresSignIn}</p>
      </section>

      {/* Workspace */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.workspace}</p>
        <p className="mt-3 text-sm text-gray-700">
          {a.workspaceInfo.current}: <span className="text-gray-500">{a.workspaceInfo.localScoped}</span>
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {a.workspaceInfo.teamPlanned} <Badge tone="muted">{a.badges.planned}</Badge>
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {a.workspaceInfo.invitePlanned} <Badge tone="muted">{a.badges.planned}</Badge>
        </p>
      </section>
    </div>
  );
}
