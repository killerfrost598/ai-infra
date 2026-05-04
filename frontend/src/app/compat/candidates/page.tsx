"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { api } from "@/lib/api";
import type { ScrapeRun, CompatCandidate, ApproveCandidate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const STATUS_ICON: Record<string, React.ReactNode> = {
  SUCCESS: <CheckCircle className="h-4 w-4 text-emerald-500" />,
  FAILED: <AlertTriangle className="h-4 w-4 text-red-500" />,
  RUNNING: <Clock className="h-4 w-4 text-amber-500 animate-pulse" />,
};

function CandidateRow({
  candidate,
  runId,
}: {
  candidate: CompatCandidate;
  runId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<ApproveCandidate>>({
    engine: candidate.engine,
    version: candidate.latest_version,
    cc_min: "8.0",
  });
  const [open, setOpen] = useState(false);

  const approve = useMutation({
    mutationFn: (payload: ApproveCandidate) => api.compat.approve(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compat", "scrape-runs"] });
      setOpen(false);
    },
  });

  const upToDate = !candidate.is_newer;

  return (
    <div className="border-b border-border/40 py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{candidate.engine}</span>
            {upToDate ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                Up to date
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                Update available
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Latest: <span className="font-mono">{candidate.latest_version}</span>
            {candidate.current_version && (
              <> · Current: <span className="font-mono">{candidate.current_version}</span></>
            )}
          </p>
          {candidate.error && (
            <p className="text-xs text-red-500">{candidate.error}</p>
          )}
        </div>
        {candidate.is_newer && !candidate.error && (
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setOpen((o) => !o)}>
            Approve
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">New StackMatrix row for {candidate.engine} {candidate.latest_version}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(
              [
                ["cc_min", "CC min", "8.0"],
                ["cc_max", "CC max (blank = any)", ""],
                ["driver_min", "Driver min", "525.85"],
                ["cuda_runtime", "CUDA runtime", "12.1"],
                ["torch", "PyTorch", "2.3.0"],
                ["container_image", "Container image", ""],
                ["pip_index_url", "pip index URL", ""],
              ] as [keyof ApproveCandidate, string, string][]
            ).map(([field, label, placeholder]) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-muted-foreground">{label}</span>
                <input
                  className="rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  placeholder={placeholder}
                  value={String(form[field] ?? "")}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value || undefined }))}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={approve.isPending || !form.cc_min}
              onClick={() =>
                approve.mutate({
                  engine: candidate.engine,
                  version: candidate.latest_version,
                  cc_min: form.cc_min!,
                  cc_max: form.cc_max,
                  driver_min: form.driver_min ?? "525.85",
                  cuda_runtime: form.cuda_runtime ?? "12.1",
                  torch: form.torch ?? "2.3.0",
                  container_image: form.container_image,
                  pip_index_url: form.pip_index_url,
                })
              }
            >
              {approve.isPending ? "Saving…" : "Confirm"}
            </Button>
          </div>
          {approve.isError && (
            <p className="text-xs text-red-500">
              {(approve.error as Error)?.message ?? "Failed to approve"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function CompatCandidatesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ScrapeRun[]>({
    queryKey: ["compat", "scrape-runs"],
    queryFn: () => api.compat.scrapeRuns(),
    staleTime: 60_000,
  });

  const trigger = useMutation({
    mutationFn: () => api.compat.triggerScrape(),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["compat", "scrape-runs"] }), 2000);
    },
  });

  const latestRun = data?.[0];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Compat Drift</h1>
          <p className="text-sm text-muted-foreground">Weekly version scrape · approve to update StackMatrix</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          disabled={trigger.isPending}
          onClick={() => trigger.mutate()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${trigger.isPending ? "animate-spin" : ""}`} />
          Run now
        </Button>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground/60">Loading…</p>
      )}

      {latestRun && (
        <Card>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {STATUS_ICON[latestRun.status] ?? <Clock className="h-4 w-4 text-muted-foreground" />}
              <span className="text-sm font-medium">
                Latest scrape · <span className="font-normal text-muted-foreground">{latestRun.status}</span>
              </span>
              {latestRun.started_at && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(latestRun.started_at).toLocaleString()}
                </span>
              )}
            </div>

            {latestRun.candidates ? (
              <div>
                {latestRun.candidates.map((c) => (
                  <CandidateRow key={`${c.engine}-${latestRun.task_run_id}`} candidate={c} runId={latestRun.task_run_id} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">No candidate data</p>
            )}
          </div>
        </Card>
      )}

      {data && data.length > 1 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">History</h2>
          {data.slice(1).map((run) => (
            <Card key={run.task_run_id} className="px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                {STATUS_ICON[run.status] ?? <Clock className="h-4 w-4 text-muted-foreground" />}
                <span className="text-muted-foreground">{run.status}</span>
                {run.started_at && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(run.started_at).toLocaleString()}
                  </span>
                )}
                {run.candidates && (
                  <span className="text-xs text-muted-foreground">
                    {run.candidates.filter((c) => c.is_newer).length} new
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && !latestRun && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No scrape runs yet. Click "Run now" to check for updates.</p>
        </Card>
      )}
    </div>
  );
}
