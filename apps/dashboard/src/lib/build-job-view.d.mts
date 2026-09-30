// Type declarations for build-job-view.mjs (SI 티어 Train B — B-8 문 (a) "만들기").

export type BuildJobStatus =
  | "queued"
  | "scaffolding"
  | "implementing"
  | "building"
  | "testing"
  | "pushed"
  | "deploying"
  | "done"
  | "failed";

export type BuildStageKey = "prepare" | "skeleton" | "features" | "verify" | "test" | "publish" | "done";
export type BuildStageState = "done" | "current" | "todo" | "stopped";

export type BuildFailureKind =
  | "notImplemented"
  | "budget"
  | "interrupted"
  | "startFailed"
  | "buildFailed"
  | "testFailed"
  | "publishFailed"
  | "generic";

export type StartErrorKey =
  | "unavailable"
  | "notSynced"
  | "needSpec"
  | "noWorkItems"
  | "alreadyActive"
  | "notReady"
  | "paused"
  | "dailyLimitReached"
  | "hostingFailed"
  | "network"
  | "generic";

/** A build job as the dashboard draws it (parsed at the wire — see parseBuildJob). */
export type BuildJobView = {
  id: string;
  /** Server status as sent (unknown values are kept and drawn as "todo"). */
  status: string;
  slug: string | null;
  failedStage: string | null;
  error: string | null;
  wbsDone: number;
  wbsTotal: number;
  budgetUsd: number | null;
  spentUsd: number | null;
  deployedUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BuildJobEventView = { id: string; at: string; stage: string; message: string };

export const BUILD_JOB_STATUSES: readonly BuildJobStatus[];
export const BUILD_ACTIVE_STATUSES: readonly Exclude<BuildJobStatus, "done" | "failed">[];
export const BUILD_STAGES: readonly BuildStageKey[];
export const BUILD_FAILURE_KINDS: readonly BuildFailureKind[];
export const START_ERROR_CODES: Readonly<Record<string, StartErrorKey>>;
export const BUILD_POLL_INTERVAL_MS: number;
export const BUILD_POLL_SLOW_MS: number;
export const BUILD_POLL_SLOW_AFTER_MS: number;
export const BUILD_EXPECTED_MAX_MINUTES: number;
export const HOSTED_REPORT_PATH: string;

export function stageForStatus(status: unknown): BuildStageKey | null;
export function isBuildActive(status: unknown): boolean;
export function stoppedStage(
  job: { status?: unknown; failedStage?: unknown } | null | undefined,
  events: ReadonlyArray<{ stage?: unknown }> | null | undefined,
): BuildStageKey | null;
export function buildStageRow(
  job: { status?: unknown; failedStage?: unknown } | null | undefined,
  events?: ReadonlyArray<{ stage?: unknown }> | null,
): Array<{ key: BuildStageKey; state: BuildStageState }>;
export function buildFailureKind(job: { status?: unknown; failedStage?: unknown; error?: unknown } | null | undefined): BuildFailureKind;
export function failureActions(kind: BuildFailureKind): { primary: "retry" | "takeSpec"; secondary: "retry" | "takeSpec" };
export function nextBuildPollDelayMs(status: unknown, opts?: { hidden?: boolean; elapsedMs?: number }): number | null;
export function isRouteMissing(status: number, body: unknown): boolean;
export function startErrorNotice(
  status: number,
  body: unknown,
): { errorKey: StartErrorKey; resetAt: string | null; activeJobId: string | null };
export function startErrorTone(key: StartErrorKey): "info" | "error";
export function safeHttpsUrl(v: unknown): string | null;
export function parseBuildJob(raw: unknown): BuildJobView | null;
export function parseBuildEvents(raw: unknown): BuildJobEventView[];
export function latestBuildJob<J extends { createdAt: string }>(jobs: readonly J[] | null | undefined): J | null;
export function buildAvailability(
  res: { ok: boolean; status?: number; routeMissing?: boolean } | null | undefined,
): "loading" | "available" | "missing" | "unknown";
export function hostedBuildFact(
  res: { ok: boolean; jobs?: unknown[]; status?: number; routeMissing?: boolean } | null | undefined,
): boolean | null;
export function makePanelVisible(input: {
  entryPath?: string | null;
  presence: boolean | null;
  specSource?: string | null;
  availability: "loading" | "available" | "missing" | "unknown";
}): boolean | null;
export function makePanelState(latestJob: { status?: unknown } | null | undefined): "make" | "active" | "done";
export function makeIntroKeys(input: {
  developerMode: boolean;
  hasExcluded: boolean;
}): Array<"what" | "excluded" | "eta" | "free" | "hosted" | "devPath">;
export function hostedReportUrl(appUrl: unknown): string | null;
export function latestCheckForApp(
  checks: ReadonlyArray<{ id?: string; targetUrl?: string; status?: string; createdAt?: string }> | null | undefined,
  appUrl: unknown,
): string | null;
export function appCardView(
  job: { status?: unknown; deployedUrl?: unknown; downloadUrl?: unknown } | null | undefined,
  checks?: ReadonlyArray<{ id?: string; targetUrl?: string; status?: string; createdAt?: string }> | null,
): { url: string; reportUrl: string; checkRunId: string | null; downloadUrl: string | null } | null;
export function budgetLine(job: { budgetUsd?: unknown; spentUsd?: unknown } | null | undefined): { budget: string; spent: string } | null;
