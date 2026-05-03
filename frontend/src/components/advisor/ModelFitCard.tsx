"use client";

import { useMemo } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { EngineName, Model } from "@/lib/models/schema";
import { bestQuantForGpu, fitStatusBg, fitStatusLabel } from "@/lib/vram";
import { topEngine } from "@/lib/engine-advisor";

const ENGINE_BADGE: Record<EngineName, string> = {
  vllm: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  ollama: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const TAG_ICONS: Partial<Record<string, string>> = {
  reasoning: "◇",
  code: "⌨",
  multimodal: "◎",
  moe: "⊕",
  "tool-calling": "⚙",
  "long-context": "↔",
};

interface Props {
  model: Model;
  gpuVramGb: number;
  gpuCount?: number;
  onSelect: (model: Model) => void;
}

export function ModelFitCard({ model, gpuVramGb, gpuCount = 1, onSelect }: Props) {
  const { quant, fit } = useMemo(
    () => bestQuantForGpu(model, gpuVramGb, gpuCount),
    [model, gpuVramGb, gpuCount],
  );

  const best = useMemo(
    () => topEngine(model, gpuVramGb, gpuCount),
    [model, gpuVramGb, gpuCount],
  );

  return (
    <button
      onClick={() => onSelect(model)}
      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/30 active:bg-muted/50 ${
        fit.status === "OOM" ? "border-border/40 opacity-55" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Name row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{model.name}</span>
            <span className="text-[10px] text-muted-foreground">{model.param_count_b}B params</span>
            {model.is_moe && model.moe_active_params_b && (
              <span className="text-[10px] text-indigo-400">{model.moe_active_params_b}B active</span>
            )}
            {model.tags
              .filter((t) => TAG_ICONS[t])
              .map((t) => (
                <span key={t} className="text-[10px] text-muted-foreground/50" title={t}>
                  {TAG_ICONS[t]}
                </span>
              ))}
          </div>

          {/* Fit + engine badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${fitStatusBg(fit.status)}`}>
              {quant.name} — {fitStatusLabel(fit.status)}
            </span>
            {best && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ENGINE_BADGE[best.engine]}`}>
                {best.engine}
              </span>
            )}
            {fit.status !== "OOM" && (
              <span className="text-[10px] text-muted-foreground/50">
                {fit.headroomGb.toFixed(1)} GB headroom
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/50">
            <span>↓ {quant.disk_size_gb} GB download</span>
            <span>up to {model.max_context_k}K ctx</span>
            <a
              href={model.huggingface_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-0.5 hover:text-indigo-400 transition-colors"
            >
              <ExternalLink className="size-2.5" />
              HF
            </a>
          </div>
        </div>

        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/30" />
      </div>
    </button>
  );
}
