// AF-1 — 제출물 한 칸 파서의 타입 (submission.mjs의 거울).

export type ParsedSubmission =
  | { ok: true; type: "github_repo" | "website"; reference: string; name: string }
  | { ok: false; error: "empty" | "too_long" | "unrecognized" };

/** 넣은 것이 저장소인지 앱 주소인지 가른다. 저장소 판정이 URL 판정보다 먼저다. */
export function parseSubmission(input: string | null | undefined): ParsedSubmission;

/** 제출물에서 임시 프로젝트 이름을 가져온다 — 이름을 묻지 않기 위해서(D-1). */
export function projectNameFor(type: "github_repo" | "website", reference: string): string;
