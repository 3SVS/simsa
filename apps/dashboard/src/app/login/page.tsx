"use client";

/**
 * /login — the value-moment promotion target (Plan B: anonymous start, sign in
 * once value is felt). GitHub-first (the vibe-coder audience has GitHub and
 * Simsa reviews GitHub repos), email+password secondary.
 *
 * The load-bearing rule: 로그인됨 ≠ 데이터연결됨. On EVERY successful sign-in
 * (email, sign-up, GitHub callback return, or already-signed-in visit) this
 * page runs the claim — binding this browser's anonymous userKey data to the
 * account — BEFORE redirecting. A user must never sign in and find their
 * projects "gone".
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { getUserKey, setActiveAccountNamespace } from "@/lib/workflow-store";
import { isPlausibleEmail } from "@/lib/email-validate.mjs";
import {
  getAuthSession,
  signInEmail,
  signUpEmail,
  startGithubLogin,
  startGoogleLogin,
  claimWorkspace,
} from "@/lib/auth-client.mjs";

function LoginInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = (() => {
    const raw = searchParams?.get("next") ?? "/projects";
    // Same-origin relative paths only — never an absolute URL (open-redirect guard).
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/projects";
  })();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "claiming">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [ghUnavailable, setGhUnavailable] = useState(false);
  const [googleUnavailable, setGoogleUnavailable] = useState(false);

  // 로그인됨 ≠ 데이터연결됨 — the single post-login path: claim FIRST, then go.
  const claimAndGo = useCallback(async () => {
    setPhase("claiming");
    // Bind local storage to this identity so the next/previous account never
    // sees these projects (moving anon→account claims pre-sign-in work). Then
    // tell the sidebar its session changed so it refreshes reactively.
    const session = await getAuthSession().catch(() => null);
    const email = (session as { user?: { email?: string } } | null)?.user?.email ?? null;
    setActiveAccountNamespace(typeof email === "string" ? email : null);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("simsa:auth-changed"));
    const claim = await claimWorkspace(getUserKey()).catch(() => null);
    if (!claim || claim.ok !== true) {
      // D2 soft-auth: an unverified email doesn't block using Simsa — only the
      // cross-device claim. Route to the "verify to sync" guidance, not the
      // generic claim-failed banner.
      if (claim && claim.ok === false && claim.error === "email_unverified") {
        router.replace(`/account?verify=1`);
        return;
      }
      // Honest failure: the whole point of logging in was linking this
      // browser's projects — a silent claim failure defeats it. The account
      // page can retry; navigation continues so the user isn't stranded.
      console.error("[login] claim failed after sign-in", claim);
      router.replace(`/account?claim=failed`);
      return;
    }
    router.replace(nextPath);
  }, [router, nextPath]);

  // Already signed in (or returning from the GitHub callback with a fresh
  // session): run the claim and continue — never strand a signed-in visitor here.
  useEffect(() => {
    let cancelled = false;
    getAuthSession().then((session) => {
      if (!cancelled && session) void claimAndGo();
    });
    return () => { cancelled = true; };
  }, [claimAndGo]);

  async function handleGithub() {
    setErrorMsg("");
    setPhase("working");
    const res = await startGithubLogin(`/login?next=${encodeURIComponent(nextPath)}`);
    if (res.ok) {
      window.location.href = res.url;
      return;
    }
    // Provider not configured yet (dormant) or transient failure — degrade to email.
    setGhUnavailable(true);
    setPhase("idle");
  }

  async function handleGoogle() {
    setErrorMsg("");
    setPhase("working");
    const res = await startGoogleLogin(`/login?next=${encodeURIComponent(nextPath)}`);
    if (res.ok) {
      window.location.href = res.url;
      return;
    }
    // Provider not configured yet (dormant) or transient failure — degrade to email.
    setGoogleUnavailable(true);
    setPhase("idle");
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "idle") return;
    setErrorMsg("");
    // Soft email check on sign-up (beta: verification is off, so at least reject
    // obviously fake addresses like a@a.com). Sign-in doesn't re-validate — the
    // account already exists.
    if (mode === "signup" && !isPlausibleEmail(email)) {
      setErrorMsg(t.login.invalidEmail);
      return;
    }
    setPhase("working");
    const res =
      mode === "signup"
        ? await signUpEmail(name.trim() || email.trim(), email.trim(), password)
        : await signInEmail(email.trim(), password);
    if (res.ok) {
      await claimAndGo();
      return;
    }
    setErrorMsg(mode === "signup" ? t.login.signUpFailed : t.login.signInFailed);
    setPhase("idle");
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.login.title}</h1>
        <p className="mb-8 mt-2 text-sm text-gray-500">{t.login.subtitle}</p>

        {/* Google is the first-class social option for the non-developer beta
            audience; GitHub is secondary (for the developer path). */}
        <button
          onClick={handleGoogle}
          disabled={phase !== "idle"}
          className="btn btn-primary w-full py-3"
        >
          {phase === "claiming" ? t.login.linking : t.login.google}
        </button>
        {googleUnavailable && (
          <p className="mt-2 text-xs text-amber-600">{t.login.googleUnavailable}</p>
        )}

        <button
          onClick={handleGithub}
          disabled={phase !== "idle"}
          className="btn btn-secondary mt-2 w-full py-3"
        >
          {t.login.github}
        </button>
        {ghUnavailable && (
          <p className="mt-2 text-xs text-amber-600">{t.login.githubUnavailable}</p>
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-gray-300">
          <span className="h-px flex-1 bg-gray-100" />
          {t.login.or}
          <span className="h-px flex-1 bg-gray-100" />
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">{t.login.name}</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{t.login.email}</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{t.login.password}</label>
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
          </div>
          {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
          <button type="submit" disabled={phase !== "idle"} className="btn btn-secondary w-full py-2.5">
            {phase === "claiming"
              ? t.login.linking
              : phase === "working"
                ? t.login.working
                : mode === "signup"
                  ? t.login.signUp
                  : t.login.signIn}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErrorMsg(""); }}
          className="mt-4 w-full text-center text-xs text-gray-500 underline hover:text-gray-600"
        >
          {mode === "signin" ? t.login.toSignUp : t.login.toSignIn}
        </button>

        <p className="mt-8 text-center text-xs text-gray-500">
          {t.login.keepsLocal}{" "}
          <Link href={nextPath} className="underline hover:text-gray-600">{t.login.skip}</Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
