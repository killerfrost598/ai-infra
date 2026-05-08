"use client";

import { useState } from "react";
import { CheckCircle, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveRuns, useUpdateModelRun } from "@/lib/queries";
import type { FailureStage } from "@/lib/types";

interface OutcomeBannerProps {
  serverId: string | null;
}

const FAILURE_STAGES: FailureStage[] = [
  "PLAN", "IMAGE_PULL", "OOM", "CC_MISMATCH", "CUDA_MISMATCH", "TIMEOUT", "HEALTH_CHECK", "OTHER",
];

export function OutcomeBanner({ serverId }: OutcomeBannerProps) {
  const { data } = useActiveRuns(serverId ?? undefined);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [showFailed, setShowFailed] = useState(false);
  const updateRun = useUpdateModelRun();

  const runs = (data?.items ?? []).filter((r) => !dismissed.has(r.id));
  const run = runs[0];

  if (!run) return null;

  function dismiss() {
    setDismissed((prev) => new Set([...prev, run.id]));
    setNote("");
    setShowFailed(false);
  }

  function markSuccess() {
    updateRun.mutate(
      { id: run.id, data: { status: "SUCCESS", succeeded: true, operator_notes: note || undefined } },
      { onSuccess: dismiss },
    );
  }

  function markFailed(stage: FailureStage) {
    updateRun.mutate(
      { id: run.id, data: { status: "FAILED", succeeded: false, failure_stage: stage, operator_notes: note || undefined } },
      { onSuccess: dismiss },
    );
    setShowFailed(false);
  }

  return (
    <div className="shrink-0 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
            Active run: {run.engine} · {run.mode}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-blue-600/70 dark:text-blue-400/70">
            {run.launch_command || "Command pending…"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Notes (optional)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-6 w-40 rounded border border-blue-300/40 bg-background/50 px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              className="h-6 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
              onClick={markSuccess}
              disabled={updateRun.isPending}
            >
              <CheckCircle className="h-3 w-3" /> Success
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="destructive"
                className="h-6 px-2 text-[11px]"
                onClick={() => setShowFailed((v) => !v)}
                disabled={updateRun.isPending}
              >
                Failed ▾
              </Button>
              {showFailed && (
                <div className="absolute bottom-8 left-0 z-50 w-40 rounded-md border border-border bg-popover p-1 shadow-md">
                  {FAILURE_STAGES.map((s) => (
                    <button
                      key={s}
                      onClick={() => markFailed(s)}
                      className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      {s.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
