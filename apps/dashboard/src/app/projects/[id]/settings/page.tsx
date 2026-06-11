"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getUserKey } from "@/lib/workflow-store";
import {
  fetchGitHubStatus,
  fetchGitHubRepos,
  linkProjectRepo,
  fetchProjectRepo,
  startGitHubOAuth,
  type GitHubUser,
  type GitHubRepo,
  type LinkedRepo,
} from "@/lib/workspace-github-api";

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const justConnected = searchParams?.get("github") === "connected";

  const [phase, setPhase] = useState<"loading" | "disconnected" | "connected" | "selecting">("loading");
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposPhase, setReposPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [linkedRepo, setLinkedRepo] = useState<LinkedRepo | null>(null);
  const [linkPhase, setLinkPhase] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [repoSearch, setRepoSearch] = useState("");

  const userKey = getUserKey();

  // Load connection status + linked repo on mount
  const loadStatus = useCallback(async () => {
    setPhase("loading");
    const [statusRes, repoRes] = await Promise.all([
      fetchGitHubStatus(userKey),
      fetchProjectRepo(id),
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

  useEffect(() => { loadStatus(); }, [loadStatus]);

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

  function handleConnectGitHub() {
    const returnTo = `${typeof window !== "undefined" ? window.location.pathname : `/projects/${id}/settings`}`;
    startGitHubOAuth(userKey, returnTo);
  }

  const filteredRepos = repoSearch.trim()
    ? repos.filter((r) => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">저장소 연결</h1>
        <p className="text-sm text-gray-500">
          이 프로젝트를 실제 코드 저장소와 연결하면, 다음 단계에서 PR 확인까지 이어갈 수 있어요.
        </p>
      </div>

      {/* Stage note */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
        아직 PR을 확인하거나 코드를 검사하지는 않아요. 이번 단계에서는 프로젝트와 저장소만 연결합니다.
      </div>

      {/* Just connected banner */}
      {justConnected && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          ✓ GitHub 계정이 연결됐어요! 이제 저장소를 선택하세요.
        </div>
      )}

      {/* Loading */}
      {phase === "loading" && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">연결 상태를 확인하는 중입니다...</p>
        </div>
      )}

      {/* Not connected */}
      {phase === "disconnected" && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-3">🔗</div>
          <p className="text-sm font-medium text-gray-700 mb-1">GitHub 저장소 연결</p>
          <p className="text-xs text-gray-400 mb-5">
            GitHub 계정을 연결하면 저장소 목록에서 이 프로젝트에 맞는 저장소를 선택할 수 있어요.
          </p>
          <button
            onClick={handleConnectGitHub}
            className="bg-gray-900 text-white text-sm font-medium px-6 py-2.5 rounded-xl hover:bg-gray-800 transition-colors"
          >
            GitHub로 연결
          </button>
        </div>
      )}

      {/* Connected — show user + linked repo */}
      {(phase === "connected" || phase === "selecting") && ghUser && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            {ghUser.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ghUser.avatarUrl} alt={ghUser.login} className="w-8 h-8 rounded-full" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-800">{ghUser.name ?? ghUser.login}</p>
              <p className="text-xs text-gray-400">@{ghUser.login} · GitHub 연결됨</p>
            </div>
            <button
              onClick={handleConnectGitHub}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
            >
              계정 변경
            </button>
          </div>

          {/* Currently linked repo */}
          {linkedRepo && phase !== "selecting" && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4">
              <p className="text-xs font-semibold text-gray-500 mb-1">연결된 저장소</p>
              <div className="flex items-center gap-2">
                <a
                  href={linkedRepo.htmlUrl ?? `https://github.com/${linkedRepo.fullName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-indigo-600 hover:underline"
                >
                  {linkedRepo.fullName}
                </a>
                {linkedRepo.private && (
                  <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">private</span>
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
              className="text-sm px-4 py-2 rounded-xl font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {linkedRepo ? "연결된 저장소 변경" : "저장소 선택"}
            </button>
          )}
          {reposPhase === "loading" && (
            <p className="text-xs text-gray-400 mt-2">저장소 목록을 불러오는 중...</p>
          )}
          {reposPhase === "error" && (
            <p className="text-xs text-red-500 mt-2">저장소 목록을 불러오지 못했습니다. GitHub 토큰이 설정되지 않았을 수 있어요.</p>
          )}
        </div>
      )}

      {/* Repo selector */}
      {phase === "selecting" && repos.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">저장소 선택</p>
            <input
              type="text"
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="저장소 이름으로 검색"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
                  <p className="text-xs text-gray-400">{repo.defaultBranch} · {repo.private ? "private" : "public"}</p>
                </div>
                {linkedRepo?.fullName === repo.fullName && (
                  <span className="text-xs text-indigo-600 font-medium flex-shrink-0">현재 선택됨</span>
                )}
              </button>
            ))}
            {filteredRepos.length === 0 && (
              <p className="text-xs text-gray-400 py-6 text-center">일치하는 저장소가 없습니다.</p>
            )}
          </div>
          <div className="p-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">{repos.length}개 공개 저장소</p>
            <button onClick={() => setPhase("connected")} className="text-xs text-gray-500 hover:text-gray-700">취소</button>
          </div>
        </div>
      )}

      {linkPhase === "done" && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          ✓ 저장소가 연결됐어요.
          <Link href={`/projects/${id}/export`} className="ml-3 underline text-green-600">
            만들기 패키지로 이동 →
          </Link>
        </div>
      )}
      {linkPhase === "error" && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          저장소 연결에 실패했습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}

      {/* Stage note: what comes next */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-600 mb-2">다음 단계에서 이어질 기능</p>
        <p>• 연결된 저장소의 Pull Request 목록 보기</p>
        <p>• Conclave가 PR을 자동으로 검토하는 기능</p>
        <p>• 지금은 저장소만 연결하고, PR 검토는 아직 시작되지 않아요.</p>
      </div>
    </div>
  );
}
