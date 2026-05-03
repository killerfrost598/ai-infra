"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LeaderboardRow } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LeaderboardPage() {
  const [modelFilter, setModelFilter] = useState("");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery<LeaderboardRow[]>({
    queryKey: ["benchmarks", "leaderboard", search],
    queryFn: () => api.benchmarks.leaderboard(search || undefined),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Benchmark Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">GPU throughput rankings from verified inference runs</p>
        </div>
        <div className="w-56">
          <Input
            placeholder="Filter by model…"
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearch(modelFilter); }}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No benchmark data yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Trigger a benchmark run from a server with an active deployment.
          </p>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">GPU</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Median TPS</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">p95 TTFT</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Max concurrent</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">$/1M tokens</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Samples</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row, idx) => (
                <tr key={row.gpu_model} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground/50">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium">{row.gpu_model}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {row.tps_median.toFixed(1)} t/s
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.ttft_p95_median != null ? `${row.ttft_p95_median.toFixed(0)} ms` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.knee_median ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.cost_per_million_tokens != null ? `$${row.cost_per_million_tokens.toFixed(4)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground/60">{row.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
