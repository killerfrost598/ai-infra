"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { TaskRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

const TERMINAL = new Set(["SUCCESS", "FAILED", "PARTIAL"]);

export default function TaskRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<TaskRun | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function fetchLogs() {
    try { setLogs(await api.taskRuns.logs(id)); setLogsError(null); }
    catch (e: unknown) { setLogsError(e instanceof Error ? e.message : "Logs unavailable"); }
  }

  useEffect(() => {
    async function init() {
      try {
        const taskRun = await api.taskRuns.get(id);
        setRun(taskRun);
        if (TERMINAL.has(taskRun.status)) { fetchLogs(); return; }
        pollRef.current = setInterval(async () => {
          try {
            const updated = await api.taskRuns.get(id);
            setRun(updated);
            if (TERMINAL.has(updated.status)) { stopPoll(); fetchLogs(); }
          } catch { stopPoll(); }
        }, 1500);
      } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to load"); }
    }
    init();
    return stopPoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [logs]);

  if (error) return (
    <div className="space-y-3">
      <Link href="/task-runs" className="btn-ghost px-0 text-zinc-500">← Task Runs</Link>
      <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
    </div>
  );

  if (!run) return (
    <div className="space-y-3">
      <Link href="/task-runs" className="btn-ghost px-0 text-zinc-500">← Task Runs</Link>
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        Loading…
      </div>
    </div>
  );

  const command = run.metadata_json?.command as string | undefined;
  const isActive = !TERMINAL.has(run.status);

  return (
    <div className="space-y-6">
      <Link href="/task-runs" className="btn-ghost px-0 text-zinc-500">← Task Runs</Link>

      {/* Metadata card */}
      <div className="card px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-zinc-100">{run.task_type}</h1>
            {command && (
              <p className="mt-1 font-mono text-sm text-zinc-500">$ {command}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isActive && <span className="animate-pulse text-xs text-amber-400">live</span>}
            <StatusBadge status={run.status} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Started", value: run.started_at ? new Date(run.started_at).toLocaleString() : "—" },
            { label: "Finished", value: run.finished_at ? new Date(run.finished_at).toLocaleString() : "—" },
            { label: "Duration", value: run.duration_seconds != null ? `${run.duration_seconds}s` : "—" },
            { label: "Run ID", value: run.id.slice(0, 8) + "…" },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-zinc-900/60 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{label}</p>
              <p className="mt-0.5 truncate text-sm text-zinc-300">{value}</p>
            </div>
          ))}
        </div>

        {run.server_id && (
          <div className="mt-3">
            <Link href={`/servers/${run.server_id}`} className="text-xs text-indigo-400 hover:text-indigo-300">
              View server →
            </Link>
          </div>
        )}

        {run.error_summary && (
          <div className="mt-4 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3">
            <p className="text-xs font-medium text-rose-500">Error</p>
            <p className="mt-1 text-sm text-rose-300">{run.error_summary}</p>
          </div>
        )}
      </div>

      {/* Log viewer */}
      <div className="space-y-2">
        <h2 className="section-label">Output</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            </div>
            <p className="text-xs text-zinc-600">stdout / stderr</p>
            {isActive && <span className="animate-pulse text-xs text-amber-400">waiting…</span>}
          </div>
          {logsError ? (
            <p className="terminal p-4 text-zinc-500">{logsError}</p>
          ) : logs !== null ? (
            <pre ref={outputRef} className="terminal max-h-[36rem] overflow-auto p-5 scrollbar-thin whitespace-pre-wrap">
              {logs}
            </pre>
          ) : (
            <div className="terminal flex items-center gap-2 p-5 text-zinc-600">
              {isActive
                ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-500" /> Waiting for task to complete…</>
                : "No log output available."
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
