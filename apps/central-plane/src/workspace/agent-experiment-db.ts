/**
 * workspace/agent-experiment-db.ts — Stage 72
 *
 * D1 persistence for Manual Multi-Agent Experiments. The experiment holds the
 * saved plan snapshot (plan_json); candidates live in their own table because
 * their PR / review-run / benchmark links are updated often.
 */
import type { Env } from "../env.js";

export type DbExperiment = {
  id: string;
  projectId: string;
  userKey: string;
  title: string;
  templateId: string;
  status: string;
  planJson: string;
  createdAt: string;
  updatedAt: string;
  decisionStatus?: string;
  selectedCandidateId?: string;
  decisionNote?: string;
  decidedAt?: string;
};

export type DbExperimentCandidate = {
  id: string;
  experimentId: string;
  candidateId: string;
  label: string;
  mode: string;
  role: string;
  suggestedAgent: string;
  status: string;
  pullRequestNumber?: number;
  reviewRunId?: string;
  benchmarkId?: string;
  outcome?: string;
  outcomeNote?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentListItem = {
  id: string;
  title: string;
  templateId: string;
  status: string;
  candidateCount: number;
  createdAt: string;
};

type ExpRow = {
  id: string;
  project_id: string;
  user_key: string;
  title: string;
  template_id: string;
  status: string;
  plan_json: string;
  created_at: string;
  updated_at: string;
  decision_status: string | null;
  selected_candidate_id: string | null;
  decision_note: string | null;
  decided_at: string | null;
};

type CandRow = {
  id: string;
  experiment_id: string;
  candidate_id: string;
  label: string;
  mode: string;
  role: string;
  suggested_agent: string;
  status: string;
  pull_request_number: number | null;
  review_run_id: string | null;
  benchmark_id: string | null;
  outcome: string | null;
  outcome_note: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

function randId(prefix: string): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${r}`;
}

function mapCand(row: CandRow): DbExperimentCandidate {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    candidateId: row.candidate_id,
    label: row.label,
    mode: row.mode,
    role: row.role,
    suggestedAgent: row.suggested_agent,
    status: row.status,
    pullRequestNumber: row.pull_request_number ?? undefined,
    reviewRunId: row.review_run_id ?? undefined,
    benchmarkId: row.benchmark_id ?? undefined,
    outcome: row.outcome ?? undefined,
    outcomeNote: row.outcome_note ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertExperiment(
  env: Env,
  input: {
    projectId: string;
    userKey: string;
    title: string;
    templateId: string;
    planJson: string;
    candidates: Array<{ candidateId: string; label: string; mode: string; role: string; suggestedAgent: string }>;
    now?: string;
  },
): Promise<{ experiment: DbExperiment; candidates: DbExperimentCandidate[] }> {
  const id = randId("wexp");
  const now = input.now ?? new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO workspace_agent_experiments
       (id, project_id, user_key, title, template_id, status, plan_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  )
    .bind(id, input.projectId, input.userKey, input.title, input.templateId, input.planJson, now, now)
    .run();

  const candidates: DbExperimentCandidate[] = [];
  for (const c of input.candidates) {
    const cid = randId("wexc");
    await env.DB.prepare(
      `INSERT INTO workspace_agent_experiment_candidates
         (id, experiment_id, candidate_id, label, mode, role, suggested_agent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`,
    )
      .bind(cid, id, c.candidateId, c.label, c.mode, c.role, c.suggestedAgent, now, now)
      .run();
    candidates.push({
      id: cid,
      experimentId: id,
      candidateId: c.candidateId,
      label: c.label,
      mode: c.mode,
      role: c.role,
      suggestedAgent: c.suggestedAgent,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    experiment: {
      id,
      projectId: input.projectId,
      userKey: input.userKey,
      title: input.title,
      templateId: input.templateId,
      status: "draft",
      planJson: input.planJson,
      createdAt: now,
      updatedAt: now,
    },
    candidates,
  };
}

export async function listExperiments(
  env: Env,
  projectId: string,
  opts: { limit?: number } = {},
): Promise<ExperimentListItem[]> {
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 50;
  const res = await env.DB.prepare(
    `SELECT e.id, e.title, e.template_id, e.status, e.created_at,
            (SELECT COUNT(*) FROM workspace_agent_experiment_candidates c WHERE c.experiment_id = e.id) AS candidate_count
       FROM workspace_agent_experiments e
      WHERE e.project_id = ?
      ORDER BY e.created_at DESC
      LIMIT ?`,
  )
    .bind(projectId, limit)
    .all();

  const rows = (res?.results ?? []) as Array<{
    id: string;
    title: string;
    template_id: string;
    status: string;
    created_at: string;
    candidate_count: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    status: row.status,
    candidateCount: row.candidate_count,
    createdAt: row.created_at,
  }));
}

export async function getExperimentById(env: Env, id: string): Promise<DbExperiment | null> {
  const row = (await env.DB.prepare(
    `SELECT id, project_id, user_key, title, template_id, status, plan_json, created_at, updated_at,
            decision_status, selected_candidate_id, decision_note, decided_at
       FROM workspace_agent_experiments WHERE id = ?`,
  )
    .bind(id)
    .first()) as ExpRow | null;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    userKey: row.user_key,
    title: row.title,
    templateId: row.template_id,
    status: row.status,
    planJson: row.plan_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decisionStatus: row.decision_status ?? undefined,
    selectedCandidateId: row.selected_candidate_id ?? undefined,
    decisionNote: row.decision_note ?? undefined,
    decidedAt: row.decided_at ?? undefined,
  };
}

const CAND_COLS = `id, experiment_id, candidate_id, label, mode, role, suggested_agent, status,
            pull_request_number, review_run_id, benchmark_id, outcome, outcome_note, decided_at, created_at, updated_at`;

export async function listExperimentCandidates(env: Env, experimentId: string): Promise<DbExperimentCandidate[]> {
  const res = await env.DB.prepare(
    `SELECT ${CAND_COLS}
       FROM workspace_agent_experiment_candidates
      WHERE experiment_id = ?
      ORDER BY created_at ASC
      LIMIT 50`,
  )
    .bind(experimentId)
    .all();
  return ((res?.results ?? []) as CandRow[]).map(mapCand);
}

export async function getCandidateById(env: Env, candidateId: string): Promise<DbExperimentCandidate | null> {
  const row = (await env.DB.prepare(
    `SELECT ${CAND_COLS}
       FROM workspace_agent_experiment_candidates WHERE id = ?`,
  )
    .bind(candidateId)
    .first()) as CandRow | null;
  return row ? mapCand(row) : null;
}

export async function updateExperimentStatus(env: Env, id: string, status: string, now?: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_agent_experiments SET status = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(status, now ?? new Date().toISOString(), id)
    .run();
}

/** Stage 74: record a candidate's outcome + note (and reflect it in status). */
export async function updateCandidateOutcome(
  env: Env,
  candidateRowId: string,
  fields: { outcome: string; outcomeNote?: string; status: string; decidedAt: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_agent_experiment_candidates
        SET outcome = ?, outcome_note = ?, status = ?, decided_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(fields.outcome, fields.outcomeNote ?? null, fields.status, fields.decidedAt, fields.decidedAt, candidateRowId)
    .run();
}

/** Stage 74: store the experiment-level decision summary. */
export async function updateExperimentDecision(
  env: Env,
  id: string,
  fields: { decisionStatus: string; selectedCandidateId?: string; decisionNote?: string; status: string; decidedAt: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE workspace_agent_experiments
        SET decision_status = ?, selected_candidate_id = ?, decision_note = ?, status = ?, decided_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      fields.decisionStatus,
      fields.selectedCandidateId ?? null,
      fields.decisionNote ?? null,
      fields.status,
      fields.decidedAt,
      fields.decidedAt,
      id,
    )
    .run();
}

export async function updateCandidateLink(
  env: Env,
  candidateId: string,
  fields: { pullRequestNumber?: number; reviewRunId?: string; benchmarkId?: string; status: string; now?: string },
): Promise<void> {
  const now = fields.now ?? new Date().toISOString();
  await env.DB.prepare(
    `UPDATE workspace_agent_experiment_candidates
        SET pull_request_number = ?, review_run_id = ?, benchmark_id = ?, status = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      fields.pullRequestNumber ?? null,
      fields.reviewRunId ?? null,
      fields.benchmarkId ?? null,
      fields.status,
      now,
      candidateId,
    )
    .run();
}
