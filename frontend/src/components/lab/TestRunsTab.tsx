"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Clock, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useModelRuns } from "@/lib/queries";
import { RunDetailDrawer } from "@/components/lab/RunDetailDrawer";
import type { ModelRunAttempt, RunStatus } from "@/lib/types";

interface TestRunsTabProps {
  serverId: string | null;
}

export function TestRunsTab({ serverId }: TestRunsTabProps) {
  const { data, isLoading } = useModelRuns(serverId ?? undefined, 50);
  const [selectedRun, setSelectedRun] = useState<ModelRunAttempt | null>(null);
  const runs = data?.items ?? [];

  if (!serverId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No active session selected
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Test Runs</h2>
          <span className="text-xs text-muted-foreground">{data?.total ?? 0} total</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : runs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No test runs yet. Use the Run Model panel to launch a model.
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} onClick={() => setSelectedRun(run)} />
            ))}
          </div>
        )}
      </div>

      <RunDetailDrawer run={selectedRun} onClose={() => setSelectedRun(null)} />
    </div>
  );
}

function RunRow({ run, onClick }: { run: ModelRunAttempt; onClick: () => void }) {
  return (
    <button
      className="w-full text-left"
      onClick={onClick}
    >
      <Card className="p-3 transition-colors hover:bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <RunStatusIcon status={run.status} />
              <span className="text-sm font-medium">
                {run.engine} {run.mode !== "container" ? `(${run.mode})` : ""}
              </span>
              <RunStatusPill status={run.status} />
            </div>
            {run.launch_command && (
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {run.launch_command}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {run.tps_steady != null && <span>{run.tps_steady.toFixed(1)} tok/s</span>}
              {run.vram_used_gb != null && <span>{run.vram_used_gb.toFixed(1)} GB VRAM</span>}
              {run.ttft_ms != null && <span>TTFT {run.ttft_ms.toFixed(0)} ms</span>}
              {run.duration_seconds != null && <span>{run.duration_seconds}s</span>}
              <span>{new Date(run.started_at).toLocaleString()}</span>
            </div>
            {run.failure_message && (
              <p className="mt-1 text-[11px] text-red-500">{run.failure_message}</p>
            )}
            {run.operator_notes && (
              <p className="mt-1 text-[11px] italic text-muted-foreground">{run.operator_notes}</p>
            )}
          </div>
        </div>
      </Card>
    </button>
  );
}

function RunStatusIcon({ status }: { status: RunStatus }) {
  const cls = "h-4 w-4 shrink-0";
  switch (status) {
    case "SUCCESS":   return <CheckCircle className={`${cls} text-emerald-500`} />;
    case "FAILED":    return <XCircle className={`${cls} text-red-500`} />;
    case "RUNNING":   return <Loader2 className={`${cls} animate-spin text-blue-500`} />;
    case "ABANDONED": return <AlertCircle className={`${cls} text-muted-foreground`} />;
    default:          return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function RunStatusPill({ status }: { status: RunStatus }) {
  const styles: Record<RunStatus, string> = {
    SUCCESS:   "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    FAILED:    "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    RUNNING:   "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
    PLANNED:   "bg-muted/50 text-muted-foreground border-border",
    ABANDONED: "bg-muted/50 text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
