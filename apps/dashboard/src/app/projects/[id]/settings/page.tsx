"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getUserKey } from "@/lib/workflow-store";
import { useI18n } from "@/i18n/I18nProvider";
import {
  fetchGitHubStatus,
  fetchGitHubRepos,
  lookupGitHubRepo,
  linkProjectRepo,
  fetchProjectRepo,
  startGitHubOAuth,
  disconnectGitHub,
  type GitHubUser,
  type GitHubRepo,
  type LinkedRepo,
} from "@/lib/workspace-github-api";
import {
  fetchNotificationSettings,
  saveNotificationSettings,
  testNotification,
  fetchNotifications,
  type NotifyPolicy,
  type NotificationSettings,
  type NotificationRecord,
} from "@/lib/workspace-notifications-api";

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const justConnected = searchParams?.get("github") === "connected";
  const { t, locale } = useI18n();

  const [phase, setPhase] = useState<"loading" | "disconnected" | "connected" | "selecting">("loading");
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposPhase, setReposPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [linkedRepo, setLinkedRepo] = useState<LinkedRepo | null>(null);
  const [linkPhase, setLinkPhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [repoSearch, setRepoSearch] = useState("");
  // Stage 56: direct "owner/repo" entry for org/collaborator repos not in the listing.
  const [directInput, setDirectInput] = useState("");
  const [lookupPhase, setLookupPhase] = useState<"idle" | "loading" | "error">("idle");
  const [lookupError, setLookupError] = useState("");
  // Stage 273: disconnect flow (GitHub OAuth has no account picker — disconnect
  // + logout at github.com is the only way to switch accounts).
  const [disconnectPhase, setDisconnectPhase] = useState<"idle" | "working" | "done" | "error">("idle");

  // Telegram notification state
  const [tgSettings, setTgSettings] = useState<NotificationSettings | null>(null);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgChatId, setTgChatId] = useState("");
  const [tgPolicy, setTgPolicy] = useState<NotifyPolicy>("problems_only");
  const [tgEnabledToggle, setTgEnabledToggle] = useState(true);
  const [tgSavePhase, setTgSavePhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [tgTestPhase, setTgTestPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [tgTestError, setTgTestError] = useState("");
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [notifPhase, setNotifPhase] = useState<"idle" | "loading" | "done">("idle");

  const userKey = getUserKey();

  // Load Telegram settings on mount
  const loadTgSettings = useCallback(async () => {
    const res = await fetchNotificationSettings(userKey);
    if (res.ok) {
      setTgEnabled(res.telegramEnabled);
      if (res.settings) {
        setTgSettings(res.settings);
        setTgChatId(res.settings.chatId);
        setTgPolicy(res.settings.notifyPolicy);
        setTgEnabledToggle(res.settings.enabled);
      }
    }
  }, [userKey]);

  const loadNotifications = useCallback(async () => {
    setNotifPhase("loading");
    const res = await fetchNotifications(userKey);
    if (res.ok) setNotifications(res.notifications);
    setNotifPhase("done");
  }, [userKey]);

  async function handleSaveTgSettings() {
    if (!tgChatId.trim()) return;
    setTgSavePhase("saving");
    const res = await saveNotificationSettings({
      userKey,
      chatId: tgChatId.trim(),
      enabled: tgEnabledToggle,
      notifyPolicy: tgPolicy,
    });
    if (res.ok) {
      setTgSettings(res.settings);
      setTgSavePhase("done");
      void loadNotifications();
    } else {
      setTgSavePhase("error");
    }
  }

  async function handleTestNotification() {
    setTgTestPhase("sending");
    setTgTestError("");
    const res = await testNotification(userKey);
    if (res.ok) {
      setTgTestPhase("sent");
      void loadNotifications();
    } else {
      setTgTestPhase("error");
      setTgTestError(res.message ?? res.error ?? t.telegram.testError);
    }
  }

  // Load connection status + linked repo on mount
  const loadStatus = useCallback(async () => {
    setPhase("loading");
    const [statusRes, repoRes] = await Promise.all([
      fetchGitHubStatus(userKey),
      fetchProjectRepo(id, getUserKey()),
    ]);

    if (statusRes.connected) {
      setGhUser(statusRes.user);
      setPhase("connected");
    } else {
      setPhase("disconnected");
    }

    if (repoRes.ok && repoRes.repo) {
      setLinkedRepo(repoRes.repo);
    }
  }, [id, userKey]);

  useEffect(() => {
    loadStatus();
    loadTgSettings();
    loadNotifications();
  }, [loadStatus, loadTgSettings, loadNotifications]);

  async function loadRepos() {
    setReposPhase("loading");
    const res = await fetchGitHubRepos(userKey);
    if (res.ok) {
      setRepos(res.repos);
      setReposPhase("done");
      setPhase("selecting");
    } else {
      setReposPhase("error");
    }
  }

  async function handleLinkRepo(repo: GitHubRepo) {
    setLinkPhase("saving");
    const res = await linkProjectRepo(id, userKey, repo);
    if (res.ok) {
      setLinkedRepo(res.repo);
      setLinkPhase("done");
      setPhase("connected");
    } else {
      setLinkPhase("error");
    }
  }

  // Stage 56: resolve "owner/repo" directly and link it (covers org/collaborator repos
  // that GitHub's /user/repos listing omits).
  async function handleDirectLookup() {
    const fullName = directInput.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
      setLookupPhase("error");
      setLookupError(t.github.errorInvalidName);
      return;
    }
    setLookupPhase("loading");
    setLookupError("");
    const res = await lookupGitHubRepo(userKey, fullName);
    if (res.ok) {
      setLookupPhase("idle");
      await handleLinkRepo(res.repo);
    } else {
      setLookupPhase("error");
      const msg: Record<string, string> = {
        not_found: t.github.errorNotFound,
        private_unsupported: t.github.errorPrivate,
        not_connected: t.github.errorNotConnected,
        invalid_full_name: t.github.errorInvalidName,
      };
      setLookupError(msg[res.error] ?? t.github.linkFailed);
    }
  }

  function handleConnectGitHub() {
    // Pass the ABSOLUTE current URL as returnTo. A relative path makes the OAuth
    // callback prepend the backend's DEFAULT_DASHBOARD_URL (dashboard.conclave-ai.dev,
    // which has no DNS) → NXDOMAIN after authorize. The absolute origin is already on
    // the central-plane return allowlist, so the callback returns here unchanged.
    const returnTo =
      typeof window !== "undefined" ? window.location.href : `/projects/${id}/settings`;
    startGitHubOAuth(userKey, returnTo);
  }

  // Stage 273: disconnect the GitHub account (deletes the server-side connection
  // including the encrypted token). Confirm first — repo/PR features stop working
  // until the user reconnects.
  async function handleDisconnectGitHub() {
    if (typeof window !== "undefined" && !window.confirm(t.github.disconnectConfirm)) return;
    setDisconnectPhase("working");
    const res = await disconnectGitHub(userKey);
    if (res.ok) {
      setDisconnectPhase("done");
      setGhUser(null);
      setRepos([]);
      setReposPhase("idle");
      await loadStatus();
    } else {
      setDisconnectPhase("error");
    }
  }

  const filteredRepos = repoSearch.trim()
    ? repos.filter((r) => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">{t.github.connectTitle}</h1>
        <p className="page-subtitle">{t.github.connectIntro}</p>
      </div>

      {/* Just connected banner */}
      {justConnected && (
        <div className="callout border-green-200 bg-green-50 text-green-700">
          {t.github.connected}
        </div>
      )}

      {/* Loading */}
      {phase === "loading" && (
        <div className="card p-8 text-center">
          <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          <p className="text-sm text-gray-400">{t.common.loading}</p>
        </div>
      )}

      {/* Not connected */}
      {phase === "disconnected" && (
        <div className="card p-8 text-center">
          {disconnectPhase === "done" && (
            <p className="mx-auto mb-3 max-w-sm text-xs text-green-600">{t.github.disconnectDone}</p>
          )}
          <p className="mb-1 text-sm font-medium text-gray-800">{t.github.connectGithub}</p>
          <p className="mx-auto mb-5 max-w-sm text-xs text-gray-500">{t.github.connectHint}</p>
          <button onClick={handleConnectGitHub} className="btn btn-md btn-primary">
            {t.github.connectGithub}
          </button>
          {/* Stage 273: GitHub binds the browser's current session instantly — say so upfront. */}
          <p className="mx-auto mt-3 max-w-sm text-xs text-gray-400">
            {t.github.instantBindCaption}{" "}
            <a
              href="https://github.com/logout"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              {t.github.switchAccountLogout}
            </a>
          </p>

          {/* First-timer guide — the review loop's hardest prerequisite is getting
              AI-built code into a public GitHub repo; don't assume it. */}
          <div className="mx-auto mt-6 max-w-md rounded-md border border-gray-100 bg-gray-50/60 px-4 py-3 text-left">
            <p className="mb-1 text-xs font-semibold text-gray-600">{t.github.firstTimeTitle}</p>
            <p className="mb-2 text-xs text-gray-500">{t.github.firstTimeIntro}</p>
            <p className="mb-2 text-xs text-gray-500">
              1. {t.github.firstTimeNoAccount}{" "}
              <a
                href="https://github.com/join"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                {t.github.firstTimeNoAccountLink}
              </a>
            </p>
            <p className="text-xs text-gray-500">2. {t.github.firstTimePlatform}</p>
          </div>
        </div>
      )}

      {/* Connected — show user + linked repo */}
      {(phase === "connected" || phase === "selecting") && ghUser && (
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            {ghUser.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ghUser.avatarUrl} alt={ghUser.login} className="h-8 w-8 rounded-full" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-800">{ghUser.name ?? ghUser.login}</p>
              <p className="text-xs text-gray-400">@{ghUser.login} · {t.github.connectedAs}</p>
            </div>
            {/* Stage 273: disconnect (with confirm) replaces the old re-connect shortcut —
                re-running OAuth silently re-binds the same account anyway. */}
            <button
              onClick={() => void handleDisconnectGitHub()}
              disabled={disconnectPhase === "working"}
              className="btn btn-sm btn-secondary ml-auto flex-shrink-0"
            >
              {disconnectPhase === "working" ? t.github.disconnecting : t.github.disconnect}
            </button>
          </div>
          {disconnectPhase === "error" && (
            <p className="mb-3 text-xs text-red-500">{t.github.disconnectFailed}</p>
          )}

          {/* Stage 273: honest account-switch guidance — GitHub OAuth has no account picker. */}
          <div className="mb-4 rounded-md border border-gray-100 bg-gray-50/60 px-4 py-3">
            <p className="mb-1 text-xs font-semibold text-gray-500">{t.github.switchAccountTitle}</p>
            <p className="text-xs text-gray-500">
              {t.github.switchAccountSteps}{" "}
              <a
                href="https://github.com/logout"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                {t.github.switchAccountLogout}
              </a>
            </p>
          </div>

          {/* Currently linked repo */}
          {linkedRepo && phase !== "selecting" && (
            <div className="mb-4 rounded-md bg-gray-50 px-4 py-3">
              <p className="mb-1 text-xs font-semibold text-gray-500">{t.github.connectedRepo}</p>
              <div className="flex items-center gap-2">
                <a
                  href={linkedRepo.htmlUrl ?? `https://github.com/${linkedRepo.fullName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  {linkedRepo.fullName}
                </a>
                {linkedRepo.private && (
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-400">private</span>
                )}
                {linkedRepo.defaultBranch && (
                  <span className="text-xs text-gray-400">→ {linkedRepo.defaultBranch}</span>
                )}
              </div>
            </div>
          )}

          {/* Select repo button */}
          {phase === "connected" && (
            <button
              onClick={loadRepos}
              disabled={reposPhase === "loading"}
              className="btn btn-md btn-secondary"
            >
              {linkedRepo ? t.github.changeRepo : t.github.selectRepo}
            </button>
          )}
          {reposPhase === "loading" && (
            <p className="mt-2 text-xs text-gray-400">{t.common.loading}</p>
          )}
          {reposPhase === "error" && (
            <p className="mt-2 text-xs text-red-500">{t.github.reposLoadError}</p>
          )}
        </div>
      )}

      {/* Repo selector */}
      {phase === "selecting" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {repos.length > 0 && (
            <>
              <div className="border-b border-gray-100 p-4">
                <p className="mb-3 text-sm font-semibold text-gray-700">{t.github.selectRepo}</p>
                <input
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder={t.github.searchPlaceholder}
                  className="input"
                />
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {filteredRepos.slice(0, 50).map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => handleLinkRepo(repo)}
                    disabled={linkPhase === "saving"}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{repo.fullName}</p>
                      <p className="text-xs text-gray-400">
                        {repo.defaultBranch} · {repo.private ? t.github.statePrivate : t.github.statePublic}
                      </p>
                    </div>
                    {linkedRepo?.fullName === repo.fullName && (
                      <span className="flex-shrink-0 text-xs font-medium text-brand-700">✓</span>
                    )}
                  </button>
                ))}
                {filteredRepos.length === 0 && (
                  <p className="py-6 text-center text-xs text-gray-400">{t.github.noMatch}</p>
                )}
              </div>
            </>
          )}

          {/* Direct owner/repo entry — for org/collaborator repos GitHub's listing omits. */}
          <div className="border-t border-gray-100 bg-gray-50/60 p-4">
            <p className="mb-1 text-sm font-semibold text-gray-700">{t.github.manualTitle}</p>
            <p className="mb-2 text-xs text-gray-400">{t.github.manualHint}</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={directInput}
                onChange={(e) => setDirectInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleDirectLookup(); }}
                placeholder={t.github.manualPlaceholder}
                className="input flex-1"
              />
              <button
                onClick={() => void handleDirectLookup()}
                disabled={lookupPhase === "loading" || linkPhase === "saving" || !directInput.trim()}
                className="btn btn-md btn-primary flex-shrink-0"
              >
                {lookupPhase === "loading" ? t.github.finding : t.github.connect}
              </button>
            </div>
            {lookupPhase === "error" && lookupError && (
              <p className="mt-2 text-xs text-red-500">{lookupError}</p>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 p-4">
            <p className="text-xs text-gray-400">
              {repos.length > 0 ? `${repos.length} ${t.github.publicReposCount}` : t.github.noReposListed}
            </p>
            <button onClick={() => setPhase("connected")} className="text-xs text-gray-500 hover:text-gray-700">
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {linkPhase === "done" && (
        <div className="callout border-green-200 bg-green-50 text-green-700">
          {t.github.connectedRepo} ✓
          <Link href={`/projects/${id}/export`} className="ml-3 text-green-700 underline">
            {t.nav.export} →
          </Link>
        </div>
      )}
      {linkPhase === "error" && (
        <p className="callout callout-error">{t.github.linkFailed}</p>
      )}

      {/* ─── Telegram notifications ──────────────────────────────────────── */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.telegram.title}</h2>
        <p className="mb-4 mt-1 text-sm text-gray-500">{t.telegram.desc}</p>

        {!tgEnabled && (
          <div className="callout mb-4 border-amber-200 bg-amber-50 text-xs text-amber-700">{t.telegram.notConfigured}</div>
        )}

        <div className="card space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{t.telegram.chatId}</label>
            <input
              type="text"
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              placeholder={t.telegram.chatIdPlaceholder}
              disabled={!tgEnabled}
              className="input disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-gray-400">{t.telegram.chatIdHint}</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{t.telegram.policy}</label>
            <select
              value={tgPolicy}
              onChange={(e) => setTgPolicy(e.target.value as NotifyPolicy)}
              disabled={!tgEnabled}
              className="input disabled:opacity-50"
            >
              <option value="problems_only">{t.telegram.policyProblems}</option>
              <option value="always">{t.telegram.policyAlways}</option>
              <option value="disabled">{t.telegram.policyDisabled}</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tg-enabled"
              checked={tgEnabledToggle}
              onChange={(e) => setTgEnabledToggle(e.target.checked)}
              disabled={!tgEnabled}
              className="rounded border-gray-300 accent-brand-600 disabled:opacity-50"
            />
            <label htmlFor="tg-enabled" className="text-sm text-gray-700">{t.telegram.enable}</label>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSaveTgSettings}
              disabled={!tgEnabled || !tgChatId.trim() || tgSavePhase === "saving"}
              className="btn btn-md btn-primary"
            >
              {tgSavePhase === "saving" ? t.telegram.saving : t.common.save}
            </button>
            {tgSettings && (
              <button
                onClick={handleTestNotification}
                disabled={!tgEnabled || tgTestPhase === "sending"}
                className="btn btn-md btn-secondary"
              >
                {tgTestPhase === "sending" ? t.telegram.sending : t.telegram.sendTest}
              </button>
            )}
          </div>

          {tgSavePhase === "done" && <p className="text-xs text-green-600">✓ {t.telegram.saved}</p>}
          {tgSavePhase === "error" && <p className="text-xs text-red-600">{t.telegram.saveError}</p>}
          {tgTestPhase === "sent" && <p className="text-xs text-green-600">✓ {t.telegram.testSent}</p>}
          {tgTestPhase === "error" && <p className="text-xs text-red-600">{tgTestError || t.telegram.testError}</p>}
        </div>
      </div>

      {/* ─── Notification history ────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">{t.telegram.historyTitle}</h2>
          <button onClick={loadNotifications} className="text-xs text-brand-700 hover:underline">
            {t.telegram.refresh}
          </button>
        </div>

        {notifPhase === "loading" && <p className="text-xs text-gray-400">{t.common.loading}</p>}

        {notifPhase === "done" && notifications.length === 0 && (
          <p className="text-xs text-gray-400">{t.telegram.noHistory}</p>
        )}

        {notifPhase === "done" && notifications.length > 0 && (
          <div className="card overflow-hidden">
            <div className="divide-y divide-gray-50">
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex-shrink-0">
                    {n.status === "sent" && <span className="text-xs font-semibold text-green-500">{t.telegram.sent}</span>}
                    {n.status === "skipped" && <span className="text-xs text-gray-400">{t.telegram.skipped}</span>}
                    {n.status === "error" && <span className="text-xs font-semibold text-red-500">{t.telegram.failed}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-gray-600">
                      {n.eventType === "pr_review_complete" ? t.telegram.prReviewComplete : n.eventType}
                      {n.destinationPreview ? ` · ${n.destinationPreview}` : ""}
                    </p>
                    {n.messagePreview && <p className="mt-0.5 truncate text-xs text-gray-400">{n.messagePreview}</p>}
                    {n.errorMessage && <p className="mt-0.5 truncate text-xs text-red-400">{n.errorMessage}</p>}
                  </div>
                  <p className="flex-shrink-0 font-mono text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
