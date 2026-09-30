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
});

const DIFFERS_CARD = Object.freeze({
  title: "differsTitle",
  subtitle: "differsSubtitle",
  emptyTitle: "differsTitle",
  oneLineLabel: "differsOneLineLabel",
  confirm: "differsConfirm",
});

/**
 * Which `intentConfirm` dictionary keys the confirm card uses. Only door (c)
 * changes the words; the flow and what gets saved stay the same.
 * @param {EntryDoor | null | undefined} entryDoor
 */
export function intentCardCopyKeys(entryDoor) {
  return entryDoor === "differs" ? DIFFERS_CARD : PLAIN_CARD;
}
