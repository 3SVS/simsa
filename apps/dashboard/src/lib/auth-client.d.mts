export function getAuthSession(fetchImpl?: typeof fetch): Promise<{ user: { email?: string } } & Record<string, unknown> | null>;
export function signOutAuth(fetchImpl?: typeof fetch): Promise<boolean>;
export function resolveAuthStatus(input: {
  loading?: boolean;
  error?: boolean;
  session?: unknown;
}): { status: "loading" | "error" | "signed_in" | "signed_out"; email: string | null };

export type MembershipBridge = {
  ok: true;
  authenticated: boolean;
  authUserId: string | null;
  email: string | null;
  userKey: string | null;
  hasPersonalWorkspace: boolean;
  workspaces: { id: string; name: string; role: string }[];
  legacyProjectCount: number;
  bridgeMode: "read_only";
  canCreatePersonalWorkspace: boolean;
  canClaimProjects: boolean;
};

export function getMembership(userKey: string, fetchImpl?: typeof fetch): Promise<MembershipBridge | null>;

export type ClaimResult =
  | { ok: true; workspaceId: string; alreadyClaimed: boolean; claimedProjects: number }
  | { ok: false; error: string };

export function claimWorkspace(userKey: string, fetchImpl?: typeof fetch): Promise<ClaimResult>;
