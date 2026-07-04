"use client";

/**
 * LoginSavePrompt — the value-moment login promotion. Shows exactly once value
 * is felt (a review result exists) and only for anonymous visitors; soft
 * (dismissible), never a gate. The timing is the whole design: at entry it
 * kills unconvinced users; too late, the anonymous data stays browser-bound.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { getAuthSession } from "@/lib/auth-client.mjs";
import { shouldPromptLogin, isLoginPromptDismissed, dismissLoginPrompt } from "@/lib/login-prompt.mjs";

export function LoginSavePrompt({ hasResult }: { hasResult: boolean }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/projects";
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until storage is read (no flash)

  useEffect(() => {
    setDismissed(isLoginPromptDismissed());
    let cancelled = false;
    getAuthSession().then((session) => {
      if (!cancelled) setSignedIn(Boolean(session));
    });
    return () => { cancelled = true; };
  }, []);

  if (!shouldPromptLogin({ signedIn, hasResult, dismissed })) return null;

  return (
    <div className="callout mb-4 flex flex-wrap items-center justify-between gap-3 border-brand-200 bg-brand-50">
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-800">{t.loginPrompt.title}</p>
        <p className="mt-0.5 text-xs text-brand-700">{t.loginPrompt.desc}</p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn btn-sm btn-primary">
          {t.loginPrompt.cta}
        </Link>
        <button
          type="button"
          onClick={() => { dismissLoginPrompt(); setDismissed(true); }}
          className="text-xs text-brand-600 underline hover:text-brand-800"
        >
          {t.loginPrompt.dismiss}
        </button>
      </div>
    </div>
  );
}
