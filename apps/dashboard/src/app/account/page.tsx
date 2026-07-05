"use client";

// Account page — profile, language, sign-in state, sign-out, and the claim
// flow ("link this browser's projects to my account").
//
// Rewritten for the open beta (was the Stage 170/241 "controlled preview"
// scaffold): the requiresSignIn/planned badge farm and the "공개 가입이
// 아닙니다" copy are gone — sign-up IS open, login is a first-class flow, and
// this page is where "who am I / how do I sign out" must be obvious.
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import {
  readDisplayName,
  writeDisplayName,
  displayInitial,
  DISPLAY_NAME_MAX,
} from "@/lib/account-preferences.mjs";
import { getAuthSession, signOutAuth, resolveAuthStatus, getMembership, claimWorkspace } from "@/lib/auth-client.mjs";
import type { MembershipBridge, ClaimResult } from "@/lib/auth-client.mjs";
import { getUserKey } from "@/lib/workflow-store";

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountInner />
    </Suspense>
  );
}

function AccountInner() {
  const { t } = useI18n();
  const a = t.account;
  const [displayName, setDisplayName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [authSession, setAuthSession] = useState<unknown>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [membership, setMembership] = useState<MembershipBridge | null>(null);
  const [claimPhase, setClaimPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const searchParams = useSearchParams();
  const claimFailedRedirect = searchParams?.get("claim") === "failed";

  useEffect(() => {
    setDisplayName(readDisplayName(typeof window !== "undefined" ? window.localStorage : null, ""));
    setHydrated(true);
    let active = true;
    getAuthSession()
      .then((s) => {
        if (active) setAuthSession(s);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const authStatus = resolveAuthStatus({ loading: authLoading, error: false, session: authSession });

  // Fetch the membership bridge once signed in (read-only; shows claimable count).
  useEffect(() => {
    if (authStatus.status !== "signed_in") return;
    let active = true;
    getMembership(getUserKey()).then((m) => {
      if (active) setMembership(m);
    });
    return () => {
      active = false;
    };
  }, [authStatus.status]);

  async function onSignOut() {
    setAuthError(false);
    const ok = await signOutAuth();
    if (ok) {
      setAuthSession(null);
      setMembership(null);
      setClaimPhase("idle");
      setClaimResult(null);
    } else {
      setAuthError(true);
    }
  }

  async function onClaim() {
    setClaimPhase("working");
    setClaimResult(null);
    const res = await claimWorkspace(getUserKey());
    setClaimResult(res);
    setClaimPhase(res.ok ? "done" : "error");
  }

  function onChange(v: string) {
    setDisplayName(v);
    writeDisplayName(typeof window !== "undefined" ? window.localStorage : null, v);
  }

  const initial = displayInitial(displayName, "S");

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="page-title">{a.title}</h1>
      <p className="page-subtitle">{a.subtitle}</p>

      {/* Sign-in state — the first thing this page must answer. */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.auth.heading}</p>

        {claimFailedRedirect && claimPhase === "idle" && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {a.auth.claimError}
          </p>
        )}

        {authStatus.status === "loading" && (
          <p className="mt-3 text-sm text-gray-500">{a.auth.loading}</p>
        )}

        {(authStatus.status === "signed_out" || authStatus.status === "error") && (
          <div className="mt-3">
            <p className="text-sm text-gray-700">{a.auth.signedOut}</p>
            <p className="mt-1 text-xs text-gray-500">{a.auth.signedOutHint}</p>
            <Link href="/login?next=/account" className="btn btn-md btn-primary mt-3">
              {a.auth.signIn}
            </Link>
          </div>
        )}

        {authStatus.status === "signed_in" && (
          <>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-700">{a.auth.signedInAs}</span>
              <span className="text-sm font-medium text-gray-900">{authStatus.email}</span>
            </div>
            <div className="mt-3">
              <button type="button" onClick={onSignOut} className="btn btn-secondary btn-sm">
                {a.auth.signOut}
              </button>
              {authError && <p className="mt-1 text-xs text-red-500">{a.auth.signOutError}</p>}
            </div>

            {/* Claim: attach this browser's userKey-scoped data to the account. */}
            {membership?.canClaimProjects && (
              <div className="mt-4 rounded-md border border-gray-100 bg-gray-50/60 px-4 py-3">
                <p className="text-xs font-semibold text-gray-700">{a.auth.claimTitle}</p>
                <p className="mt-1 text-xs text-gray-500">{a.auth.claimDesc}</p>
                {membership.legacyProjectCount > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {a.auth.claimProjectsToLink.replace("{n}", String(membership.legacyProjectCount))}
                  </p>
                )}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={onClaim}
                    disabled={claimPhase === "working"}
                    className="btn btn-primary btn-sm"
                  >
                    {claimPhase === "working" ? a.auth.claimWorking : a.auth.claimButton}
                  </button>
                </div>
                {claimPhase === "done" && claimResult?.ok && (
                  <p className="mt-2 text-xs text-green-600">
                    {claimResult.alreadyClaimed
                      ? a.auth.claimAlreadyDone
                      : a.auth.claimDone.replace("{n}", String(claimResult.claimedProjects))}
                  </p>
                )}
                {claimPhase === "error" && (
                  <p className="mt-2 text-xs text-red-500">
                    {claimResult && !claimResult.ok && claimResult.error === "claimed_by_other"
                      ? a.auth.claimTakenError
                      : a.auth.claimError}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <p className="mt-3 text-xs text-gray-500">{a.auth.keepsLocal}</p>
      </section>

      {/* Profile (local display name) */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.profile}</p>
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
              className="input mt-1"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">{a.profile.storedLocally}</p>
        {!hydrated && <span className="sr-only">loading</span>}
      </section>

      {/* Preferences */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.preferences}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-700">{a.preferences.language}</span>
          <LanguageToggle />
        </div>
        <p className="mt-2 text-xs text-gray-500">{a.preferences.languageHelp}</p>
      </section>

      {/* Data — one honest line, no badge farm. */}
      <section className="card mt-6 p-5">
        <p className="section-title">{a.sections.data}</p>
        <p className="mt-3 text-sm text-gray-600">{a.data.projectExports}</p>
      </section>
    </div>
  );
}
