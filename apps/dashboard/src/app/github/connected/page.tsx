"use client";

/**
 * OAuth popup landing. The GitHub callback redirects here (absolute returnTo
 * from startGitHubOAuthPopup); this page tells the opener the connection
 * landed, then closes itself so the user never leaves the settings screen.
 * When there is no opener (popup blocked → full-page fallback, or the tab was
 * reopened), it renders an honest "connected — go back" card instead.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { GITHUB_CONNECTED_MESSAGE } from "@/lib/workspace-github-api";
import { useI18n } from "@/i18n/I18nProvider";

export default function GitHubConnectedPopupPage() {
  const { t } = useI18n();
  const [hasOpener, setHasOpener] = useState(false);

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (opener) {
      setHasOpener(true);
      // Same-origin only: the opener is our own settings page.
      opener.postMessage({ type: GITHUB_CONNECTED_MESSAGE }, window.location.origin);
      window.close(); // no-ops when the browser refuses; the card below remains
    }
  }, []);

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <div className="card p-8">
        <p className="text-sm font-medium text-gray-800">{t.github.popupConnected}</p>
        <p className="mt-2 text-xs text-gray-500">{t.github.popupCloseHint}</p>
        {!hasOpener && (
          <Link href="/projects" className="btn btn-md btn-primary mt-5">
            {t.github.popupBackToApp} →
          </Link>
        )}
      </div>
    </main>
  );
}
