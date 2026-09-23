// Train N — types for developer-mode.mjs.

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const DEVELOPER_MODE_KEY: string;
export const DEVELOPER_MODE_EVENT: string;

export function parseDeveloperMode(raw: unknown): boolean;
export function readDeveloperMode(storage: StorageLike | null | undefined): boolean;
export function writeDeveloperMode(storage: StorageLike | null | undefined, on: boolean): void;

export type SettingsSectionVisibility = {
  github: boolean;
  telegram: boolean;
  email: boolean;
  trainingConsent: boolean;
  developerModeToggle: boolean;
  builtWith: boolean;
};
export function settingsSectionVisibility(input: {
  developerMode: boolean;
  entryPath?: string | null;
  hasLinkedRepo?: boolean;
}): SettingsSectionVisibility;

export function sidebarDeveloperItems(input: { developerMode: boolean }): {
  starOnGithub: boolean;
  advancedGroup: boolean;
};
