const MOCK_USER = {
  name: "Seunghun Bae",
  workspace: "3SVS Workspace",
  authProvider: "github",
  githubConnected: false,
};

export function MockUserBadge() {
  return (
    <div className="px-3 py-3 border-t border-gray-100 mt-auto">
      <p className="text-xs font-medium text-gray-700 truncate">{MOCK_USER.workspace}</p>
      <p className="text-xs text-gray-500 mt-0.5">
        {MOCK_USER.githubConnected ? "GitHub 연결됨" : "GitHub 연결 예정"}
      </p>
    </div>
  );
}
