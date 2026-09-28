"use client";

/**
 * AppAddressStart — the overview's inline "app address" start (2026-09-28, D4).
 *
 * Bae's live report: a project with its code linked but no app address sent the
 * user to the PR screen, which showed "0 open code changes" and nothing else —
 * the journey stopped. For someone who already built an app, the shortest path
 * to a first result is: type the address the app opens at → press one button →
 * watch the real-app check run. So the address is asked for RIGHT HERE, not on
 * another screen:
 *
 *   1. register the address as a website source (the same API the Sources
 *      screen uses — that screen stays as it is),
 *   2. start the real-app check against that source — the check's purpose
 *      sentence is left to the server's cascade (재정렬 C0: confirmed one-line
 *      › default), never made up here,
 *   3. go to that run's page.
 *
 * Failures keep what the user typed and say in plain words what happened. A
 * retry after a saved address but a failed start does not register the address
 * twice — and a retry with a CORRECTED address replaces the one this box saved
 * instead of leaving it behind (addressSubmitPlan).
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";
import { connectProjectSource, deleteProjectSource } from "@/lib/workspace-sources-api";
import { runVisualCheck } from "@/lib/workspace-visual-checks-api";
import { mirrorLocalProjectToDb } from "@/lib/project-mirror";
import { getUserKey } from "@/lib/workflow-store";
import { APP_ADDRESS_ANCHOR } from "@/lib/project-steps.mjs";
import {
  normalizeAppAddress,
  appAddressErrorKey,
  addressSubmitPlan,
  type AppAddressErrorKey,
} from "@/lib/app-address.mjs";

type ErrorKey = AppAddressErrorKey | "empty";

export function AppAddressStart({ projectId, t, locale }: { projectId: string; t: Dictionary; locale: Locale }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  // The address already registered in THIS attempt — so a retry after a failed
  // start reuses it instead of adding the same address again.
  const saved = useRef<{ url: string; sourceId: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Arriving from "실제 앱 확인하기" on another screen (…#app-address): put the
  // cursor in the box. The box only mounts once the facts say an address is
  // needed, so the browser's own anchor jump may have happened too early.
  useEffect(() => {
    if (window.location.hash !== `#${APP_ADDRESS_ANCHOR}`) return;
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ block: "center" });
  }, []);

  async function handleStart(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (working) return;
    const norm = normalizeAppAddress(value);
    if (!norm.ok) {
      setErrorKey(norm.error);
      return;
    }
    setErrorKey(null);
    setWorking(true);
    const userKey = getUserKey();

    // Same address again → reuse what this box saved. A corrected address →
    // remove the one this box saved a moment ago (a typo or the wrong app), then
    // save the new one — never leave a stray address behind (#559 검증 결함 9).
    const plan = addressSubmitPlan(saved.current, norm.url);
    let sourceId = plan.reuseSourceId;
    if (plan.removeSourceId) {
      // Best effort: if this fails the old address simply stays in the Sources
      // list (nothing is lost) — the new one is still saved and checked.
      await deleteProjectSource(projectId, plan.removeSourceId, userKey).catch(() => null);
      saved.current = null;
    }
    if (!sourceId) {
      const input = { userKey, type: "website" as const, reference: norm.url };
      let res = await connectProjectSource(projectId, input);
      // A project that only exists in this browser has no server row yet —
      // save it once, then try again (same self-heal as the code-changes screen).
      if (!res.ok && (res.error === "project_not_found" || res.error === "HTTP 404")) {
        if (await mirrorLocalProjectToDb(projectId)) res = await connectProjectSource(projectId, input);
      }
      if (!res.ok) {
        setErrorKey(appAddressErrorKey(res.error));
        setWorking(false);
        return;
      }
      sourceId = res.source.id;
      saved.current = { url: norm.url, sourceId };
    }

    const run = await runVisualCheck(projectId, { userKey, locale, sourceId });
    if (run.ok) {
      router.push(`/projects/${projectId}/visual-checks/${run.check.id}`);
      return;
    }
    if (run.error === "run_already_active") {
      // A check is already running for this app — show it rather than an error.
      router.push(`/projects/${projectId}/visual-checks`);
      return;
    }
    setErrorKey(appAddressErrorKey(run.error));
    setWorking(false);
  }

  const cc = t.commandCenter;
  return (
    <form onSubmit={handleStart} className="mt-3" noValidate>
      <label htmlFor={APP_ADDRESS_ANCHOR} className="text-xs font-medium text-gray-500">
        {cc.addUrlLabel}
      </label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={APP_ADDRESS_ANCHOR}
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={value}
          maxLength={500}
          onChange={(e) => {
            setValue(e.target.value);
            if (errorKey) setErrorKey(null);
          }}
          placeholder={cc.addUrlPlaceholder}
          aria-invalid={errorKey !== null}
          aria-describedby={errorKey ? `${APP_ADDRESS_ANCHOR}-error` : undefined}
          className="min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <button type="submit" disabled={working} className="btn btn-md btn-primary flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-60">
          {working ? cc.addUrlStarting : cc.addUrlStart}
        </button>
      </div>
      {errorKey && (
        <p id={`${APP_ADDRESS_ANCHOR}-error`} role="alert" className="mt-2 text-sm text-red-600">
          {cc.addUrlErrors[errorKey]}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer list-none text-xs font-medium text-brand-700 hover:underline">
          {cc.addUrlHelpToggle}
        </summary>
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-gray-600">
          <li>{cc.addUrlHelpLovable}</li>
          <li>{cc.addUrlHelpBoltV0}</li>
          <li>{cc.addUrlHelpReplit}</li>
          <li>{cc.addUrlHelpSelf}</li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">{cc.addUrlHelpNotLive}</p>
      </details>
    </form>
  );
}
