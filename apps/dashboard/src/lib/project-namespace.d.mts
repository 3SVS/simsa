export const PROJECTS_BASE: string;
export const DRAFT_BASE: string;
export const ACTIVE_NS_KEY: string;
export const ANON_NS: string;

export function hashAccount(accountId: string): string;
export function namespaceFor(accountId: string | null | undefined): string;
export function projectsKeyFor(ns: string): string;
export function draftKeyFor(ns: string): string;
export function mergeProjectsById<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[];
export function planNamespaceTransition(
  prevNs: string,
  accountId: string | null | undefined,
): { nextNs: string; claimAnon: boolean };
