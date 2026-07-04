"use client";

// Stage 121 — minimal beta admin console for saved agent workflow records.
// Operator-only. Records are scoped by client-supplied userKey, NOT full account
// authentication. Summaries only (no snapshot JSON). Admin key is entered at
// query time and never stored.
import { useState } from "react";
import {
  listAdminAgentWorkflows,
  updateAdminAgentWorkflowStatus,
  deleteAdminAgentWorkflow,
} from "@/lib/admin-agent-workflows-api";
import type {
  AdminWorkflowRecord,
  AdminWorkflowSummary,
} from "@/lib/admin-agent-workflows-api";
import {
  ADMIN_USAGE_BOUNDARY_NOTE,
  ADMIN_COUNTS_SIGNAL_NOTE,
} from "@/lib/beta-usage-boundary.mjs";

const STATUS_OPTIONS = ["", "planned", "needs_evidence", "archived"];

export default function AdminWorkflowsPage() {
  const [adminKey, setAdminKey] = useState("");
  const [userKey, setUserKey] = useState("");
  const [status, setStatus] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [records, setRecords] = useState<AdminWorkflowRecord[] | null>(null);
  const [summary, setSummary] = useState<AdminWorkflowSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!adminKey.trim()) {
      setError("Enter the admin key.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await listAdminAgentWorkflows(adminKey.trim(), {
      userKey: userKey.trim() || undefined,
      status: status || undefined,
      includeArchived,
    });
    if (res.ok) {
      setRecords(res.records);
      setSummary(res.summary);
    } else {
      setError(res.error);
      setRecords(null);
      setSummary(null);
    }
    setLoading(false);
  }

  async function setRecordStatus(id: string, next: "planned" | "archived") {
    setBusyId(id);
    const res = await updateAdminAgentWorkflowStatus(adminKey.trim(), id, next);
    if (!res.ok) setError(res.error);
    await load();
    setBusyId(null);
  }

  async function remove(id: string) {
    if (typeof window !== "undefined" && !window.confirm(`Delete record ${id}? This cannot be undone.`)) {
      return;
    }
    setBusyId(id);
    const res = await deleteAdminAgentWorkflow(adminKey.trim(), id);
    if (!res.ok) setError(res.error);
    await load();
    setBusyId(null);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
        Beta admin · Saved workflow records
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        Beta admin console. Records are scoped by client-supplied userKey, not full
        account authentication. Avoid exposing or copying sensitive workflow content.
      </p>
      {/* Stage 122 — usage boundary note */}
      <p className="mt-1 text-xs text-gray-500">
        {ADMIN_USAGE_BOUNDARY_NOTE} {ADMIN_COUNTS_SIGNAL_NOTE}
      </p>

      {/* Controls */}
      <div className="card mt-6 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Admin key</label>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="x-admin-key"
              className="input w-full rounded-lg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">User key filter</label>
            <input
              type="text"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              placeholder="uk_… (optional)"
              className="input w-full rounded-lg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Status filter</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input w-full rounded-lg"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "any"} value={s}>
                  {s || "Any"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Include archived
            </label>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="btn btn-primary btn-md"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryCard label="Total" value={summary.total} />
          <SummaryCard label="Planned" value={summary.byStatus.planned ?? 0} />
          <SummaryCard label="Needs evidence" value={summary.byStatus.needs_evidence ?? 0} />
          <SummaryCard label="Archived" value={summary.byStatus.archived ?? 0} />
          <SummaryCard label="Unique user keys" value={summary.uniqueUserKeys} />
        </div>
      )}

      {/* Records table */}
      {records !== null && (
        <div className="card mt-6 p-5">
          {records.length === 0 ? (
            <p className="text-sm text-gray-500">No records for this filter.</p>
          ) : (
            <ul className="space-y-2">
              {records.map((r) => (
                <li key={r.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{r.title}</span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {r.intakeType.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {r.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{r.sourceSummary}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {r.id} · userKey {r.userKey} · created {r.createdAt} · updated {r.updatedAt}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.status === "archived" ? (
                      <button
                        type="button"
                        onClick={() => setRecordStatus(r.id, "planned")}
                        disabled={busyId === r.id}
                        className="btn btn-secondary btn-sm"
                      >
                        {busyId === r.id ? "…" : "Restore"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRecordStatus(r.id, "archived")}
                        disabled={busyId === r.id}
                        className="btn btn-secondary btn-sm"
                      >
                        {busyId === r.id ? "…" : "Archive"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      disabled={busyId === r.id}
                      className="btn btn-secondary btn-sm text-red-600"
                    >
                      {busyId === r.id ? "…" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
      <p className="text-xl font-semibold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
    </div>
  );
}
