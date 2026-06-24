// Stage 170 — types for account-preferences.mjs.

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const ACCOUNT_DISPLAY_NAME_KEY: string;
export const DISPLAY_NAME_MAX: number;
export const DEFAULT_DISPLAY_NAME: string;

export function normalizeDisplayName(raw: unknown, fallback?: string): string;
export function displayInitial(name: unknown, fallback?: string): string;
export function readDisplayName(storage: StorageLike | null | undefined, fallback?: string): string;
export function writeDisplayName(storage: StorageLike | null | undefined, value: unknown): void;
