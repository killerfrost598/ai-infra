"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { InferenceBenchmark, ModelDeployment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConcurrencyChart } from "./ConcurrencyChart";

interface Props {
  serverId: string;
  gpuModel: string | null;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground/50">{sub}</p>}
    </div>
  );
}

export function PerformanceTab({ serverId, gpuModel }: Props) {
  const qc = useQueryClient();
  const [runProfile, setRunProfile] = useState("default");
  const [runError, setRunError] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState(false);

  const { data: benchData, isLoading: loadingBench } = useQuery({
    queryKey: ["benchmarks", "gpu", gpuModel],
    queryFn: () => api.benchmarks.forGpu(gpuModel!),
    enabled: !!gpuModel,
    staleTime: 60_000,
  });

  const { data: deploymentsData } = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api.deployments.list(0, 100),
    staleTime: 30_000,
  });

  // Pick the latest deployment for this server that has inference_base_url
  const deployments = (deploymentsData?.items ?? []) as (ModelDeployment & { inference_base_url?: string })[];
  const latestDeployment = deployments
    .filter((d) => d.server_id === serverId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  const runMutation = useMutation({
    mutationFn: ({ deploymentId, profile }: { deploymentId: string; profile: string }) =>
      api.benchmarks.run(deploymentId, profile),
    onSuccess: () => {
      setRunSuccess(true);
      setRunError(null);
      setTimeout(() => setRunSuccess(false), 4000);
      qc.invalidateQueries({ queryKey: ["benchmarks", "gpu", gpuModel] });
    },
    onError: (e: Error) => {
      setRunError(e.message);
      setRunSuccess(false);
    },
  });

  const benches: InferenceBenchmark[] = benchData?.items ?? [];
  const latest = benches[0] ?? null;

  function fmtMs(ms: number | null | undefined): string {
    if (ms == null) return "—";
    return `${ms.toFixed(0)} ms`;
  }
  function fmtTps(tps: number | null | undefined): string {
    if (tps == null) return "—";
    return `${tps.toFixed(1)} t/s`;
  }
  function fmtColdStart(s: number | null | undefined): string {
    if (s == null) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  if (!gpuModel) {
    return <p className="text-xs text-muted-foreground/60">No GPU detected for this server.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Run benchmark bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <select
            value={runProfile}
            onChange={(e) => setRunProfile(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none"
          >
            <option value="quick">Quick (~5 min)</option>
            <option value="default">Default (~10 min)</option>
            <option value="thorough">Thorough (~20 min)</option>
          </select>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!latestDeployment || runMutation.isPending}
            onClick={() => {
              if (!latestDeployment) return;
              setRunError(null);
              runMutation.mutate({ deploymentId: latestDeployment.id, profile: runProfile });
            }}
          >
            {runMutation.isPending ? "Queued…" : runSuccess ? "Queued ✓" : "Run benchmark"}
          </Button>
        </div>
        {!latestDeployment && (
          <p className="text-xs text-muted-foreground/60">No deployment on this server yet.</p>
        )}
        {runError && <p className="text-xs text-rose-500">{runError}</p>}
      </div>

      {/* Loading */}
      {loadingBench && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          Loading benchmarks…
        </div>
      )}

      {/* No data */}
      {!loadingBench && !latest && (
        <Card className="px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">No benchmark data for {gpuModel} yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Run a benchmark after deploying a model.
          </p>
        </Card>
      )}

      {/* Latest benchmark */}
      {latest && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">
              {latest.model_name}
              {latest.quantization && <span className="ml-1.5 text-muted-foreground/60">({latest.quantization})</span>}
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              {latest.profile ?? "default"} · {latest.measured_at ? new Date(latest.measured_at).toLocaleString() : "—"}
            </p>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Cold start" value={fmtColdStart(latest.cold_start_seconds)} />
            <StatTile label="TTFT p95" value={fmtMs(latest.ttft_ms_p95)} sub={latest.ttft_ms_p50 ? `p50: ${fmtMs(latest.ttft_ms_p50)}` : undefined} />
            <StatTile label="Throughput" value={fmtTps(latest.tokens_per_second_avg)} sub={`p95: ${fmtTps(latest.tokens_per_second_p95)}`} />
            <StatTile label="Max concurrency" value={latest.knee_concurrency?.toString() ?? "—"} sub="before degradation" />
          </div>

          {/* VRAM */}
          {latest.vram_used_gb && (
            <p className="text-xs text-muted-foreground">
              VRAM used: <span className="font-medium">{latest.vram_used_gb} GB</span>
              {latest.gpu_vram_gb && <span className="text-muted-foreground/60"> / {latest.gpu_vram_gb} GB</span>}
            </p>
          )}

          {/* Concurrency curve */}
          {latest.concurrency_curve && latest.concurrency_curve.length > 1 && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Concurrency curve
              </p>
              <ConcurrencyChart curve={latest.concurrency_curve} />
              <div className="mt-1 flex items-center gap-4 text-[10px] text-muted-foreground/50">
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-red-400" /> p95 TTFT (ms)</span>
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-emerald-400" /> Agg TPS</span>
              </div>
            </div>
          )}

          {/* Previous runs */}
          {benches.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Previous runs</p>
              {benches.slice(1, 6).map((b) => (
                <div key={b.id} className="flex items-center gap-4 rounded-lg border border-border/40 px-3 py-2 text-xs">
                  <span className="flex-1 truncate text-muted-foreground">{b.model_name} {b.quantization ? `(${b.quantization})` : ""}</span>
                  <span className="font-mono">{fmtTps(b.tokens_per_second_avg)}</span>
                  <span className="text-muted-foreground/50">{b.measured_at ? new Date(b.measured_at).toLocaleDateString() : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
