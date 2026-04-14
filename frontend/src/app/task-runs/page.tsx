"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TaskRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

const ACTIVE = new Set(["PENDING", "RUNNING"]);

export default function TaskRunsPage() {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.taskRuns.list().then((r) => { setRuns(r.items); setTotal(r.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    const iv = setInterval(() => {
      api.taskRuns.list().then((r) => { setRuns(r.items); setTotal(r.total); });
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  const hasActive = runs.some((r) => ACTIVE.has(r.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Task Runs</h1>
          {!loading && <p className="mt-0.5 text-sm text-zinc-500">{total} total</p>}
        </div>
        {hasActive && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-800 bg-amber-950/50 px-2.5 py-0.5 text-xs text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            {runs.filter((r) => ACTIVE.has(r.status)).length} active
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}
      {error && <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>}
      {!loading && !error && runs.length === 0 && (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-zinc-500">No task runs yet.</p>
          <p className="text-xs text-zinc-600">Task runs are created automatically when you register servers or run SSH commands.</p>
        </div>
      )}

      <div className="space-y-2">
        {runs.map((r) => (
          <Link
            key={r.id}
            href={`/task-runs/${r.id}`}
            className="card flex items-center gap-4 px-5 py-4 hover:border-zinc-700 transition-colors"
          >
            <StatusBadge status={r.status} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-100">{r.task_type}</p>
              {r.metadata_json?.command && (
                <p className="mt-0.5 truncate font-mono text-xs text-zinc-600">
                  $ {String(r.metadata_json.command)}
                </p>
              )}
              {r.error_summary && (
                <p className="mt-0.5 truncate text-xs text-rose-400">{r.error_summary}</p>
              )}
            </div>
            <div className="shrink-0 text-right text-xs text-zinc-500">
              <p>{r.started_at ? new Date(r.started_at).toLocaleString() : "queued"}</p>
              {r.duration_seconds != null && <p>{r.duration_seconds}s</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
