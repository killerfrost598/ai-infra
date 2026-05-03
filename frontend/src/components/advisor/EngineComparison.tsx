"use client";

import { useState } from "react";
import type { EngineName, Model } from "@/lib/models/schema";
import {
  recommendEngines,
  USE_CASE_LABELS,
  ENGINE_DESCRIPTIONS,
  type UseCase,
} from "@/lib/engine-advisor";

const ENGINE_BADGE: Record<EngineName, string> = {
  vllm: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  ollama: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

interface Props {
  model: Model;
  gpuVramGb: number;
  gpuCount?: number;
}

export function EngineComparison({ model, gpuVramGb, gpuCount = 1 }: Props) {
  const [useCase, setUseCase] = useState<UseCase>("chat");
  const [concurrency, setConcurrency] = useState(4);

  const recs = recommendEngines(model, gpuVramGb, gpuCount, useCase, concurrency);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Use case</Label>
          <select
            value={useCase}
            onChange={(e) => setUseCase(e.target.value as UseCase)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {Object.entries(USE_CASE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>Concurrent users</Label>
            <span className="text-xs font-semibold">{concurrency}</span>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground/50">
            <span>1</span>
            <span>50</span>
          </div>
        </div>
      </div>

      {recs.every((r) => !r.meetsVramMin) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          No engine has sufficient VRAM for this model at any quantization. Try a smaller model or add a second GPU.
        </div>
      )}

      {/* Engine cards */}
      <div className="space-y-2">
        {recs.map((rec, i) => (
          <div
            key={rec.engine}
            className={`rounded-lg border px-4 py-3 space-y-2 transition-opacity ${
              rec.meetsVramMin ? "border-border bg-card" : "border-border/30 bg-muted/20 opacity-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ENGINE_BADGE[rec.engine]}`}
              >
                {rec.engine}
              </span>
              {i === 0 && rec.meetsVramMin && (
                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ Recommended
                </span>
              )}
              {!rec.meetsVramMin && (
                <span className="text-[10px] text-destructive/80">Insufficient VRAM</span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${(rec.score * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className="w-6 text-right text-[10px] text-muted-foreground">
                  {(rec.score * 100).toFixed(0)}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{rec.reason}</p>

            {rec.flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {rec.flags.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/70"
                  >
                    {f}
                  </code>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bottom note on top engine */}
      {recs[0] && (
        <p className="text-[10px] text-muted-foreground/50">
          {ENGINE_DESCRIPTIONS[recs[0].engine]}
        </p>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}
