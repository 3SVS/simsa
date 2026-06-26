export function getAuthSession(fetchImpl?: typeof fetch): Promise<{ user: { email?: string } } & Record<string, unknown> | null>;
export function signOutAuth(fetchImpl?: typeof fetch): Promise<boolean>;
export function resolveAuthStatus(input: {
  loading?: boolean;
  error?: boolean;
  session?: unknown;
}): { status: "loading" | "error" | "signed_in" | "signed_out"; email: string | null };
