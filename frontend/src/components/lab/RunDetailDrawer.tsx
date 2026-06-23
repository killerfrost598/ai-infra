"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Clock, Loader2, AlertCircle, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { PublishReportDialog } from "@/components/lab/PublishReportDialog";
import type { ModelRunAttempt, RunStatus } from "@/lib/types";

interface RunDetailDrawerProps {
  run: ModelRunAttempt | null;
  onClose: () => void;
}

function fmt(v: number | null | undefined, unit: string) {
  if (v == null) return "—";
  return `${v.toFixed(1)} ${unit}`;
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

export function RunDetailDrawer({ run, onClose }: RunDetailDrawerProps) {
  const [publishOpen, setPublishOpen] = useState(false);

  if (!run) return null;

  return (
    <>
      <Sheet open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent side="right">
          <SheetHeader>
            <div className="flex items-center gap-2 pr-8">
              <RunStatusIcon status={run.status} />
              <SheetTitle className="pr-0">{run.engine} · {run.mode}</SheetTitle>
            </div>
          </SheetHeader>

          <SheetBody>
            {/* Metrics */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Status", run.status],
                ["Verdict", run.feasibility_verdict],
                ["TPS", fmt(run.tps_steady, "tok/s")],
                ["TTFT", fmt(run.ttft_ms, "ms")],
                ["VRAM used", fmt(run.vram_used_gb, "GB")],
                ["Duration", run.duration_seconds != null ? `${run.duration_seconds}s` : "—"],
                ["Started", new Date(run.started_at).toLocaleString()],
                ["Completed", run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              ))}
            </div>

            {/* Failure info */}
            {run.failure_stage && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  Failure: {run.failure_stage.replace(/_/g, " ")}
                </p>
                {run.failure_message && (
                  <p className="mt-1 text-[11px] text-red-500">{run.failure_message}</p>
                )}
              </div>
            )}

            {/* Launch command */}
            {run.launch_command && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Launch Command</p>
                <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-[11px] leading-relaxed">
                  {run.launch_command}
                </pre>
              </div>
            )}

            {/* Operator notes */}
            {run.operator_notes && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
                <p className="text-sm italic text-muted-foreground">{run.operator_notes}</p>
              </div>
            )}

            {/* Health check */}
            {run.health_check_url && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Health Check</p>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{run.health_check_url}</span>
                  {run.health_check_ok === true && <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
                  {run.health_check_ok === false && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                </div>
              </div>
            )}

            {/* Launch plan JSON */}
            {run.launch_plan_json && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Launch Plan</p>
                <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(run.launch_plan_json, null, 2)}
                </pre>
              </div>
            )}
          </SheetBody>

          <SheetFooter className="sm:justify-between">
            {run.published_url ? (
              <a
                href={run.published_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> View published report
              </a>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setPublishOpen(true)}
              >
                <Upload className="h-3 w-3" /> Publish report
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <PublishReportDialog
        runId={run.id}
        open={publishOpen}
        onOpenChange={setPublishOpen}
      />
    </>
  );
}
