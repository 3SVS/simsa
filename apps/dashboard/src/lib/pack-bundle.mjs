// Secret-file safety for the builder pack's "copy all" / "download as markdown"
// surfaces.
//
// The pack's `.env.local` holds the user's REAL secret values (their keys). It is
// a legitimate part of the downloadable ZIP — it's the gitignored env file their
// project needs. But it must NEVER be folded into "copy everything to clipboard"
// or "download the whole pack as one .md": those put plaintext secrets on the
// clipboard (pasteable/loggable anywhere) or into a single committable markdown
// file. So the text bundles exclude the real-secret file; the ZIP keeps it.
// (`.env.example` is placeholders only → safe to include.)

/** True for the pack's real-secret file (`.env.local`). Never `.env.example`. */
export function isSecretFile(path) {
  return /(^|\/)\.env(\.[^/]*)?\.local$/i.test(String(path)) || /(^|\/)\.env\.local$/i.test(String(path));
}

/** Files safe to concatenate into clipboard / markdown — secrets removed. */
export function filesForTextBundle(files) {
  return (files ?? []).filter((f) => !isSecretFile(f.path));
}

/** True when the pack contains a real-secret file (so the UI can show a note). */
export function hasSecretFiles(files) {
  return (files ?? []).some((f) => isSecretFile(f.path));
}
