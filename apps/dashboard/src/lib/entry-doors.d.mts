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
  readonly itemsHint: "itemsHint" | "differsItemsHint";
};

export function intentCardCopyKeys(entryDoor: EntryDoor | null | undefined): IntentCardCopyKeys;

/** PR #571 검증 결함 10: the door a code-branch project is saved with. */
export function entryDoorForSave(entryDoor: unknown): "broken" | "differs";

/** PR #571 검증 결함 1·9: door (c) starts empty and shows the as-is line read-only. */
export function intentCardDraft(
  entryDoor: unknown,
  inferredOneLine: unknown,
): { initialOneLine: string; readNow: string | null };

/** PR #571 검증 결함 1·9: door (c) cannot confirm an empty line or the as-is line. */
export function intentCardCanConfirm(input: {
  entryDoor?: unknown;
  oneLine?: unknown;
  inferredOneLine?: unknown;
}): boolean;

/** PR #571 검증 결함 3: door (c) offers a re-check with the confirmed line after confirming. */
export function intentCardAfterConfirm(entryDoor: unknown): "recheck" | "hide";
