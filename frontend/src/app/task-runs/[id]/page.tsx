"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { TaskRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";
import { Spinner } from "@/components/ui/spinner";

const TERMINAL = new Set(["SUCCESS", "FAILED", "PARTIAL"]);

export default function TaskRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<TaskRun | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [logsError, setLogsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function stopStream() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStreaming(false);
  }

  // Auto-scroll log output to bottom when new content arrives
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    async function init() {
      try {
        const taskRun = await api.taskRuns.get(id);
        setRun(taskRun);
        startLogStream(taskRun.status);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    }

    function startLogStream(initialStatus: string) {
      const es = new EventSource(`/api/v1/task-runs/${id}/logs/stream`);
      esRef.current = es;
      setStreaming(!TERMINAL.has(initialStatus));

      es.onmessage = (e) => {
        setLogs((prev) => prev + e.data + "\n");
      };

      es.addEventListener("done", () => {
        stopStream();
        // Fetch final task run status once stream closes
        api.taskRuns.get(id).then(setRun).catch(() => null);
      });

      es.onerror = () => {
        stopStream();
        setLogsError("Log stream disconnected.");
        // Still show whatever we got; attempt final status fetch
        api.taskRuns.get(id).then(setRun).catch(() => null);
      };

      // Poll task run metadata while active (status badge + timing)
      if (!TERMINAL.has(initialStatus)) {
        pollRef.current = setInterval(async () => {
          try {
            const updated = await api.taskRuns.get(id);
            setRun(updated);
            if (TERMINAL.has(updated.status)) stopPoll();
          } catch {
            stopPoll();
          }
        }, 2000);
      }
    }

    init();
    return () => { stopPoll(); stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return (
    <div className="space-y-3">
      <Link href="/task-runs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Task Runs</Link>
      <ErrorState message={error} />
    </div>
  );

  if (!run) return (
    <div className="space-y-3">
      <Link href="/task-runs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Task Runs</Link>
      <LoadingState />
    </div>
  );

  const command = run.metadata_json?.command as string | undefined;
  const isActive = !TERMINAL.has(run.status);

  return (
    <div className="space-y-6">
      <Link href="/task-runs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Task Runs</Link>

      {/* Metadata card */}
      <Card className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold">{run.task_type}</h1>
            {command && (
              <p className="mt-1 font-mono text-sm text-muted-foreground">$ {command}</p>
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
            <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</p>
              <p className="mt-0.5 truncate text-sm text-foreground/80">{value}</p>
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
          <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <p className="text-xs font-medium text-destructive">Error</p>
            <p className="mt-1 text-sm text-destructive/80">{run.error_summary}</p>
          </div>
        )}
      </Card>

      {/* Log viewer */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Output</h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
              <span className="h-2.5 w-2.5 rounded-full bg-border" />
            </div>
            <p className="text-xs text-muted-foreground/60">stdout / stderr</p>
            {streaming && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                streaming
              </span>
            )}
          </div>

          {logsError && !logs ? (
            <p className="terminal p-4 text-zinc-500">{logsError}</p>
          ) : logs ? (
            <pre
              ref={outputRef}
              className="terminal max-h-[36rem] overflow-auto p-5 scrollbar-thin whitespace-pre-wrap"
            >
              {logs}
              {streaming && <span className="animate-pulse text-zinc-600">▌</span>}
            </pre>
          ) : (
            <div className="terminal flex items-center gap-2 p-5 text-muted-foreground">
              <Spinner />
              Waiting for task output…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
