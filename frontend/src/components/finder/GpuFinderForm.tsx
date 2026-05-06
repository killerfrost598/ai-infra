"use client";

import { useEffect, useRef, useState } from "react";
import type { EngineName, Model } from "@/lib/models/schema";
import { CONTEXT_STEPS_K, type ContextStepK, type KvDtype } from "@/lib/vram";
import { USE_CASE_LABELS, type UseCase } from "@/lib/engine-advisor";
import { Input } from "@/components/ui/input";
import { quantStyle } from "@/lib/quant-styles";

const LS_KEY = "gpu-finder:config:v1";

const ALL_ENGINES: EngineName[] = ["vllm", "sglang", "ollama"];

const ENGINE_BADGE: Record<EngineName, string> = {
  vllm:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  ollama: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export interface GpuFinderFormState {
  modelId: string;
  quantName: string;
  engine: EngineName;
  contextK: ContextStepK;
  batch: number;
  kvDtype: KvDtype;
  useCase: UseCase;
  concurrency: number;
  minDiskGb: string;
  minDownloadMbps: string;
}

export function defaultFormState(models: Model[]): GpuFinderFormState {
  const first = models[0];
  const firstQuant = first?.quants.slice().sort((a, b) => b.quality_score - a.quality_score)[0];
  const firstEngine = (first?.recommended_engines[0]?.engine ?? "vllm") as EngineName;
  return {
    modelId: first?.id ?? "",
    quantName: firstQuant?.name ?? "",
    engine: firstEngine,
    contextK: 8,
    batch: 4,
    kvDtype: "fp16",
    useCase: "chat",
    concurrency: 1,
    minDiskGb: "",
    minDownloadMbps: "",
  };
}

export function loadFromLocalStorage(models: Model[]): GpuFinderFormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GpuFinderFormState>;
    if (!models.some((m) => m.id === parsed.modelId)) return null;
    return { ...defaultFormState(models), ...parsed };
  } catch {
    return null;
  }
}

interface Props {
  models: Model[];
  state: GpuFinderFormState;
  onChange: (next: GpuFinderFormState) => void;
}

export function GpuFinderForm({ models, state, onChange }: Props) {
  const modelSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    modelSelectRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !state.modelId) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const [quantsExpanded, setQuantsExpanded] = useState(false);

  const selectedModel = models.find((m) => m.id === state.modelId) ?? models[0];
  const availableEngines: string[] = selectedModel?.recommended_engines.length
    ? selectedModel.recommended_engines.map((e) => e.engine)
    : ["vllm", "sglang", "ollama"];
  const quants = selectedModel?.quants.slice().sort((a, b) => b.quality_score - a.quality_score) ?? [];
  const selectedQuant = quants.find((q) => q.name === state.quantName);

  function set<K extends keyof GpuFinderFormState>(key: K, value: GpuFinderFormState[K]) {
    onChange({ ...state, [key]: value });
  }

  function handleModelChange(modelId: string) {
    const model = models.find((m) => m.id === modelId);
    if (!model) return;
    const firstQuant = model.quants.slice().sort((a, b) => b.quality_score - a.quality_score)[0];
    const firstEngine = (model.recommended_engines[0]?.engine ?? "vllm") as EngineName;
    onChange({ ...state, modelId, quantName: firstQuant?.name ?? "", engine: firstEngine });
  }

  return (
    <div className="space-y-5 text-sm">
      {/* Model */}
      <div className="space-y-1.5">
        <Label>Model</Label>
        <select
          ref={modelSelectRef}
          value={state.modelId}
          onChange={(e) => handleModelChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Quantization */}
      <div className="space-y-1.5">
        <button
          onClick={() => setQuantsExpanded((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <Label>Quantization</Label>
          <div className="flex items-center gap-1.5">
            {selectedQuant && !quantsExpanded && (
              <span className={[
                "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                quantStyle((selectedQuant as { quant_format?: string }).quant_format),
              ].join(" ")}>
                {selectedQuant.name}
                {selectedQuant.vram_weights_gb > 0 && (
                  <span className="ml-1 opacity-60">{selectedQuant.vram_weights_gb.toFixed(0)}GB</span>
                )}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/50">{quantsExpanded ? "▲" : "▼"}</span>
          </div>
        </button>
        {quantsExpanded && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {quants.map((q) => {
              const fmt = (q as { quant_format?: string }).quant_format;
              const colorCls = fmt ? quantStyle(fmt) : "";
              const isActive = state.quantName === q.name;
              return (
                <button
                  key={q.name}
                  onClick={() => { set("quantName", q.name); setQuantsExpanded(false); }}
                  className={[
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    colorCls,
                    isActive ? "ring-2 ring-offset-1 ring-indigo-500" : "opacity-60 hover:opacity-90",
                  ].filter(Boolean).join(" ")}
                >
                  {q.name}
                  {q.vram_weights_gb > 0
                    ? <span className="ml-1 text-[9px] opacity-60">{q.vram_weights_gb.toFixed(0)}GB</span>
                    : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Engine */}
      <div className="space-y-1.5">
        <Label>Engine</Label>
        <div className="flex gap-1.5">
          {ALL_ENGINES.map((e) => {
            const supported = availableEngines.includes(e);
            const active = state.engine === e;
            return (
              <button
                key={e}
                disabled={!supported}
                onClick={() => supported && set("engine", e)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  !supported
                    ? "border-border/30 text-muted-foreground/30 cursor-not-allowed"
                    : active
                      ? `${ENGINE_BADGE[e]} border-transparent`
                      : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {e}
              </button>
            );
          })}
        </div>
      </div>

      {/* Context */}
      <SliderField
        label="Context length"
        value={CONTEXT_STEPS_K.indexOf(state.contextK)}
        max={CONTEXT_STEPS_K.length - 1}
        onChange={(i) => set("contextK", CONTEXT_STEPS_K[i]!)}
        display={`${state.contextK}K tokens`}
      />

      {/* Batch */}
      <SliderField
        label="Batch size"
        value={state.batch}
        min={1}
        max={64}
        onChange={(v) => set("batch", v)}
        display={String(state.batch)}
      />

      {/* KV dtype */}
      <div className="space-y-1.5">
        <Label>KV dtype</Label>
        <div className="flex gap-1.5">
          {(["fp16", "bf16", "fp8"] as KvDtype[]).map((dtype) => (
            <button
              key={dtype}
              onClick={() => set("kvDtype", dtype)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                state.kvDtype === dtype
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {dtype}
            </button>
          ))}
        </div>
      </div>

      {/* Use case */}
      <div className="space-y-1.5">
        <Label>Use case</Label>
        <select
          value={state.useCase}
          onChange={(e) => set("useCase", e.target.value as UseCase)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {Object.entries(USE_CASE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Concurrency */}
      <SliderField
        label="Concurrent users"
        value={state.concurrency}
        min={1}
        max={50}
        onChange={(v) => set("concurrency", v)}
        display={String(state.concurrency)}
      />

      {/* Optional hard filters */}
      <div className="space-y-3 border-t border-border/40 pt-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Optional filters</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Min disk (GB)</label>
            <Input
              type="number"
              min={0}
              placeholder="any"
              value={state.minDiskGb}
              onChange={(e) => set("minDiskGb", e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Min download (Mbps)</label>
            <Input
              type="number"
              min={0}
              placeholder="any"
              value={state.minDownloadMbps}
              onChange={(e) => set("minDownloadMbps", e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
  );
}

function SliderField({
  label,
  value,
  min = 0,
  max,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="font-mono text-xs text-muted-foreground">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-indigo-600"
      />
    </div>
  );
}
