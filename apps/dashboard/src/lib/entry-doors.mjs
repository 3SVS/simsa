// C-N7 (Train C · D-17 amend 2026-09-27) — the three first doors, as pure data.
//
//   (a) 아이디어가 있어요          I have an idea
//   (b) 만든 앱이 안 돼요           My app doesn't work
//   (c) 만들었는데 생각과 달라요    It works, but not how I meant
//
// The doors sit ON the existing branches rather than replacing them (the entry
// structure stays): (a) → idea, (b) and (c) → the existing-app branch (code).
// Door (c) carries `door=differs` in the URL so the existing-app flow can ask
// for the ORIGINAL intent on the confirm card instead of "is this what your
// app is?" — for a "works, but not what I meant" app, confirming what the app
// IS would lock in the wrong yardstick. Pasting a plan (spec) is a variant of
// door (a) and stays reachable as a secondary link.
//
// PURE — no DOM, no storage, no network.

/** @typedef {"idea" | "broken" | "differs"} EntryDoor */

/** @type {ReadonlyArray<EntryDoor>} */
export const ENTRY_DOORS = Object.freeze(["idea", "broken", "differs"]);

/**
 * @param {EntryDoor} door
 * @returns {"idea" | "code"}
 */
export function doorBranch(door) {
  return door === "idea" ? "idea" : "code";
}

/**
 * Where a door leads. (b) keeps the plain `?path=code` link every existing
 * probe, bookmark and sidebar entry already uses.
 * @param {EntryDoor} door
 */
export function doorHref(door) {
  if (door === "idea") return "/projects/new?path=idea";
  if (door === "differs") return "/projects/new?path=code&door=differs";
  return "/projects/new?path=code";
}

/**
 * Read the branch and door back from the URL (`?path=` / `?door=`). No branch
 * → null (the chooser shows). An unknown `door` on the code branch is door (b).
 * @param {{ path?: string | null, door?: string | null } | null | undefined} search
 * @returns {{ branch: "idea" | "code" | "spec", door: EntryDoor } | null}
 */
export function doorFromSearch(search) {
  const path = search?.path;
  if (path === "idea") return { branch: "idea", door: "idea" };
  if (path === "spec") return { branch: "spec", door: "idea" };
  if (path === "code") return { branch: "code", door: search?.door === "differs" ? "differs" : "broken" };
  return null;
}

const PLAIN_CARD = Object.freeze({
  title: "title",
  subtitle: "subtitle",
  emptyTitle: "emptyTitle",
  oneLineLabel: "oneLineLabel",
  confirm: "confirm",
  itemsHint: "itemsHint",
});

const DIFFERS_CARD = Object.freeze({
  title: "differsTitle",
  subtitle: "differsSubtitle",
  emptyTitle: "differsTitle",
  oneLineLabel: "differsOneLineLabel",
  confirm: "differsConfirm",
  // PR #571 검증 결함 1: the inferred items describe the app as it is NOW.
  itemsHint: "differsItemsHint",
});

/**
 * Which `intentConfirm` dictionary keys the confirm card uses. Only door (c)
 * changes the words; the flow and what gets saved stay the same.
 * @param {EntryDoor | null | undefined} entryDoor
 */
export function intentCardCopyKeys(entryDoor) {
  return entryDoor === "differs" ? DIFFERS_CARD : PLAIN_CARD;
}

/**
 * The door a code-branch project is saved with (`ExtendedProjectData.entryDoor`).
 * Only door (c) is remembered as such; everything else on the code branch is (b).
 * @param {unknown} entryDoor
 * @returns {"broken" | "differs"}
 */
export function entryDoorForSave(entryDoor) {
  return entryDoor === "differs" ? "differs" : "broken";
}

/** @param {unknown} s */
function trimmed(s) {
  return typeof s === "string" ? s.trim() : "";
}

/** @param {string} s */
function sameWords(s) {
  return s.replace(/\s+/g, " ");
}

// PR #571 검증 결함 1·9 (2026-10-01): on door (c) the line inferred from the app
// describes what the app does NOW — the very thing the user says is not what they
// meant. Pre-filling it into "원래 만들려던 것" let one click save the as-is app
// as the yardstick, so later checks measured the app against itself. The line is
// shown as a read-only reference instead, and the field starts empty.

/**
 * What the confirm card starts with.
 * @param {unknown} entryDoor
 * @param {unknown} inferredOneLine the one-line inferred from the app (may be missing)
 * @returns {{ initialOneLine: string, readNow: string | null }}
 *   initialOneLine — what the editable field starts with;
 *   readNow — door (c) only: the inferred line, shown read-only ("지금 앱에서 읽은 것").
 */
export function intentCardDraft(entryDoor, inferredOneLine) {
  const inferred = trimmed(inferredOneLine);
  if (entryDoor === "differs") return { initialOneLine: "", readNow: inferred || null };
  return { initialOneLine: inferred, readNow: null };
}

/**
 * May the card's confirm button be pressed? Door (c): only once the user wrote
 * something that is not simply the inferred as-is line (whitespace ignored).
 * Other doors keep the pre-C-N7 behaviour: always.
 * @param {{ entryDoor?: unknown, oneLine?: unknown, inferredOneLine?: unknown }} input
 * @returns {boolean}
 */
export function intentCardCanConfirm(input) {
  if (input?.entryDoor !== "differs") return true;
  const mine = sameWords(trimmed(input?.oneLine));
  if (!mine) return false;
  return mine !== sameWords(trimmed(input?.inferredOneLine));
}

/**
 * What the card does after the user confirms. Door (c): the first automatic check
 * (AF-2) ran before the question was asked, against the generic sentence — so the
 * card stays and offers to check again with what the user meant (a button, never
 * an automatic run: every run counts against the daily cap). Other doors: the
 * card goes away as before.
 * @param {unknown} entryDoor
 * @returns {"recheck" | "hide"}
 */
export function intentCardAfterConfirm(entryDoor) {
  return entryDoor === "differs" ? "recheck" : "hide";
}
