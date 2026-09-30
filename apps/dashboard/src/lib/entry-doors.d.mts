// Types for entry-doors.mjs (C-N7, 2026-09-30 — the three first doors).

export type EntryDoor = "idea" | "broken" | "differs";

export const ENTRY_DOORS: ReadonlyArray<EntryDoor>;

export function doorBranch(door: EntryDoor): "idea" | "code";

export function doorHref(door: EntryDoor): string;

export function doorFromSearch(
  search: { path?: string | null; door?: string | null } | null | undefined,
): { branch: "idea" | "code" | "spec"; door: EntryDoor } | null;

export type IntentCardCopyKeys = {
  readonly title: "title" | "differsTitle";
  readonly subtitle: "subtitle" | "differsSubtitle";
  readonly emptyTitle: "emptyTitle" | "differsTitle";
  readonly oneLineLabel: "oneLineLabel" | "differsOneLineLabel";
  readonly confirm: "confirm" | "differsConfirm";
};

export function intentCardCopyKeys(entryDoor: EntryDoor | null | undefined): IntentCardCopyKeys;
