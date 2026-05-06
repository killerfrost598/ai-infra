"use client";

import { useMemo, useState } from "react";
import type { Model, Quant } from "@/lib/models/schema";
import {
  estimateVramNeed,
  fitForGpu,
  fitStatusBg,
  CONTEXT_STEPS_K,
  type KvDtype,
} from "@/lib/vram";
import { quantStyle } from "@/lib/quant-styles";

interface Props {
  model: Model;
  gpuVramGb: number;
  gpuCount?: number;
}

export function VramCalculator({ model, gpuVramGb, gpuCount = 1 }: Props) {
  const [quantIdx, setQuantIdx] = useState(0);
  const [contextIdx, setContextIdx] = useState(2); // default 8K
  const [batchSize, setBatchSize] = useState(4);
  const [kvDtype, setKvDtype] = useState<KvDtype>("fp16");

  const quant: Quant = model.quants[quantIdx] ?? model.quants[0];
  const contextLenK = CONTEXT_STEPS_K[contextIdx] ?? 8;
  const availableGb = gpuVramGb * gpuCount;

  const estimate = useMemo(
    () => estimateVramNeed(model, quant, contextLenK, batchSize, kvDtype),
    [model, quant, contextLenK, batchSize, kvDtype],
  );

  const fit = useMemo(
    () => fitForGpu(model, quant, gpuVramGb, gpuCount, contextLenK, batchSize, kvDtype),
    [model, quant, gpuVramGb, gpuCount, contextLenK, batchSize, kvDtype],
  );

  const maxBar = availableGb * 1.1;
  function pct(gb: number) {
    return `${Math.min(100, (gb / maxBar) * 100).toFixed(1)}%`;
  }

  return (
    <div className="space-y-5">
      {/* Quant picker */}
      <div className="space-y-2">
        <SectionLabel>Quantization</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {model.quants.map((q, i) => {
            const fmt = (q as { quant_format?: string }).quant_format;
            const colorCls = fmt ? quantStyle(fmt) : "";
            return (
              <button
                key={q.name}
                onClick={() => setQuantIdx(i)}
                className={[
                  "rounded border px-2.5 py-1 text-xs transition-colors",
                  colorCls,
                  quantIdx === i ? "ring-2 ring-offset-1 ring-indigo-500" : "opacity-70 hover:opacity-100",
                ].filter(Boolean).join(" ")}
              >
                {q.name}
                {q.vram_weights_gb > 0
                  ? <span className="ml-1 text-[9px] opacity-70">{q.vram_weights_gb.toFixed(1)}GB</span>
                  : null}
              </button>
            );
          })}
        </div>
        {quant.notes && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">{quant.notes}</p>
        )}
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-2 gap-4">
        <SliderField
          label="Context length"
          value={`${contextLenK}K`}
          min={0}
          max={CONTEXT_STEPS_K.length - 1}
          step={1}
          sliderValue={contextIdx}
          onChange={setContextIdx}
          minLabel="2K"
          maxLabel="128K"
        />
        <SliderField
          label="Batch size"
          value={String(batchSize)}
          min={1}
          max={64}
          step={1}
          sliderValue={batchSize}
          onChange={setBatchSize}
          minLabel="1"
          maxLabel="64"
        />
      </div>

      {/* KV dtype */}
      <div className="flex items-center gap-3 flex-wrap">
        <SectionLabel>KV cache dtype</SectionLabel>
        <div className="flex gap-1">
          {(["fp16", "bf16", "fp8"] as KvDtype[]).map((d) => (
            <button
              key={d}
              onClick={() => setKvDtype(d)}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                kvDtype === d
                  ? "border-border bg-muted text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        {kvDtype === "fp8" && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">H100 / Ada only</span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Model weights" value={`${estimate.weightsGb.toFixed(1)} GB`} sub="from quantization" />
        <StatCard label="KV-cache" value={`${estimate.kvCacheGb.toFixed(1)} GB`} sub="ctx × batch" />
        <StatCard
          label="Overhead"
          value={`${(estimate.activationGb + estimate.overheadGb).toFixed(1)} GB`}
          sub="activations + CUDA"
        />
        <StatCard
          label="Total needed"
          value={`${estimate.totalGb.toFixed(1)} GB`}
          sub={`GPU: ${availableGb} GB`}
          highlight
        />
      </div>

      {/* Allocation bars */}
      <div className="space-y-1.5">
        <SectionLabel>VRAM allocation</SectionLabel>
        <BarRow label="Weights" color="bg-indigo-500" width={pct(estimate.weightsGb)} value={`${estimate.weightsGb.toFixed(1)} GB`} />
        <BarRow label="KV-cache" color="bg-violet-500" width={pct(estimate.kvCacheGb)} value={`${estimate.kvCacheGb.toFixed(1)} GB`} />
        <BarRow
          label="Overhead"
          color="bg-zinc-400"
          width={pct(estimate.activationGb + estimate.overheadGb)}
          value={`${(estimate.activationGb + estimate.overheadGb).toFixed(1)} GB`}
        />
        <div className="flex items-center gap-2">
          <span className="min-w-[72px] text-right text-[11px] text-foreground/60 font-medium">
            GPU cap
          </span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
            <div
              className="absolute inset-y-0 left-0 rounded border border-green-600/40 bg-green-500/15"
              style={{ width: pct(availableGb) }}
            />
          </div>
          <span className="min-w-[52px] text-right font-mono text-[11px] text-green-600 dark:text-green-400">
            {availableGb} GB
          </span>
        </div>
      </div>

      {/* Fit message */}
      <div className={`rounded-lg px-3 py-2.5 text-xs font-medium ${fitStatusBg(fit.status)}`}>
        {fit.status === "OOM"
          ? `Out of memory — ${Math.abs(fit.headroomGb).toFixed(1)} GB over budget. Try a lower quant or reduce context / batch size.`
          : fit.status === "TIGHT"
            ? `Very tight — only ${fit.headroomGb.toFixed(1)} GB headroom (${(fit.headroomPct * 100).toFixed(0)}%). Use --enforce-eager and lower --max-model-len.`
            : fit.status === "OK"
              ? `Fits — ${fit.headroomGb.toFixed(1)} GB headroom (${(fit.headroomPct * 100).toFixed(0)}%). Watch for OOM at very long contexts.`
              : `Comfortable — ${fit.headroomGb.toFixed(1)} GB headroom (${(fit.headroomPct * 100).toFixed(0)}%). Room to increase batch size or context.`}
      </div>

      <p className="text-[10px] text-muted-foreground/40">
        Estimates are ±10%. Real usage varies by engine version, CUDA graph capture, and activation reuse.
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  sliderValue,
  onChange,
  minLabel,
  maxLabel,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  sliderValue: number;
  onChange: (v: number) => void;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <SectionLabel>{label}</SectionLabel>
        <span className="text-xs font-semibold">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600"
      />
      <div className="flex justify-between text-[9px] text-muted-foreground/50">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg p-2.5 ${highlight ? "border border-border bg-muted" : "bg-muted/50"}`}>
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-base font-semibold leading-none">{value}</p>
      {sub && <p className="mt-1 text-[10px] text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

function BarRow({
  label,
  color,
  width,
  value,
}: {
  label: string;
  color: string;
  width: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-[72px] text-right text-[11px] text-muted-foreground">{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
        <div className={`h-full rounded transition-all duration-300 ${color}`} style={{ width }} />
      </div>
      <span className="min-w-[52px] text-right font-mono text-[11px] font-medium">{value}</span>
    </div>
  );
}
