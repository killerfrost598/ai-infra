"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCatalogue } from "@/lib/models/catalogue";
import { VramCalculator } from "@/components/advisor/VramCalculator";
import type { Model } from "@/lib/models/schema";

const GPU_PROFILES = [
  { id: "rtx-3090",    label: "RTX 3090 — 24 GB",        vram_gb: 24,  count: 1 },
  { id: "rtx-4090",    label: "RTX 4090 — 24 GB",        vram_gb: 24,  count: 1 },
  { id: "rtx-5090",    label: "RTX 5090 — 32 GB",        vram_gb: 32,  count: 1 },
  { id: "a100-40",     label: "A100 — 40 GB",            vram_gb: 40,  count: 1 },
  { id: "a100-80",     label: "A100 — 80 GB",            vram_gb: 80,  count: 1 },
  { id: "h100-80",     label: "H100 SXM — 80 GB",        vram_gb: 80,  count: 1 },
  { id: "h200-141",    label: "H200 — 141 GB",           vram_gb: 141, count: 1 },
  { id: "2x-rtx-4090", label: "2× RTX 4090 — 48 GB",    vram_gb: 24,  count: 2 },
  { id: "2x-a100-80",  label: "2× A100 80 GB — 160 GB", vram_gb: 80,  count: 2 },
  { id: "2x-h100-80",  label: "2× H100 80 GB — 160 GB", vram_gb: 80,  count: 2 },
] as const;

const QUANT_TABLE = [
  { name: "BF16",   factor: "×2.0",  example: "8B → 16 GB",   quality: 100, note: "Full precision. Baseline." },
  { name: "FP8",    factor: "×1.0",  example: "8B → 8 GB",    quality: 98,  note: "Lossless on H100/H200/RTX 4090. Halves weights." },
  { name: "Q8",     factor: "×1.0",  example: "8B → 8.4 GB",  quality: 97,  note: "Any GPU. Near-lossless quality." },
  { name: "Q4_K_M", factor: "×0.55", example: "8B → 4.7 GB",  quality: 93,  note: "Sweet spot for most consumer GPUs." },
  { name: "Q2",     factor: "×0.30", example: "8B → 2.7 GB",  quality: 78,  note: "Extreme compression. Noticeable degradation." },
];

export default function VramCalculatorPage() {
  const { data: catalogue, isLoading } = useCatalogue();
  const [modelId, setModelId] = useState<string>("");
  const [gpuId, setGpuId] = useState("rtx-4090");

  const models = catalogue?.models ?? [];
  const selectedModel: Model | undefined = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    [models, modelId],
  );
  const gpu = GPU_PROFILES.find((g) => g.id === gpuId) ?? GPU_PROFILES[1];

  return (
    <div className="space-y-10 pb-12">
      {/* Mental model */}
      <section className="space-y-4">
        <SectionHeading>The key mental model</SectionHeading>
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-5 py-4 text-sm leading-relaxed">
          <span className="font-semibold text-foreground">Disk size ≠ VRAM size ≠ VRAM needed.</span>
          {" "}Disk size is the download. VRAM for weights = disk size × precision factor
          (1.0 for BF16 in VRAM, ~0.5 for FP8/Q8, ~0.25 for Q4). Total VRAM = weights + KV-cache
          (grows with context × batch) + framework overhead (~2–3 GB).
          <br className="mt-2 block" />
          The two biggest levers:{" "}
          <span className="text-indigo-400 font-medium">quantization</span> (shrinks weights) and{" "}
          <span className="text-indigo-400 font-medium">--max-model-len</span> (shrinks KV-cache).
        </div>

        {/* Formula breakdown */}
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Model weights", color: "bg-indigo-500", desc: "Stored once. Controlled by quantization. Dominates for large models." },
            { label: "KV-cache", color: "bg-violet-500", desc: "Grows with context length × batch size. Controlled by --max-model-len." },
            { label: "Activations", color: "bg-zinc-400", desc: "Intermediate computation tensors. ~15% of weights, floor at 1.5 GB." },
            { label: "CUDA overhead", color: "bg-zinc-600", desc: "Framework buffers, CUDA graphs, streams. Fixed ~1 GB." },
          ].map(({ label, color, desc }) => (
            <div key={label} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-sm ${color}`} />
                <span className="text-xs font-medium">{label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quantization table */}
      <section className="space-y-4">
        <SectionHeading>Quantization reference</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>Format</Th>
                <Th>Size factor</Th>
                <Th>8B model example</Th>
                <Th>Quality</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {QUANT_TABLE.map((q) => (
                <tr key={q.name} className="border-b border-border/50">
                  <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-indigo-400">{q.name}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{q.factor}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{q.example}</td>
                  <td className="py-2.5 pr-6">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${q.quality}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{q.quality}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-xs text-muted-foreground">{q.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive calculator */}
      <section className="space-y-4">
        <SectionHeading>Interactive calculator</SectionHeading>

        {/* Selectors */}
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1 min-w-[220px]">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Model
            </label>
            {isLoading ? (
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
            ) : (
              <select
                value={selectedModel?.id ?? ""}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1 min-w-[220px]">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              GPU
            </label>
            <select
              value={gpuId}
              onChange={(e) => setGpuId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {GPU_PROFILES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedModel && (
          <div className="rounded-xl border border-border bg-card p-6">
            <VramCalculator
              model={selectedModel}
              gpuVramGb={gpu.vram_gb}
              gpuCount={gpu.count}
            />
          </div>
        )}
      </section>

      {/* KV-cache explainer */}
      <section className="space-y-4">
        <SectionHeading>Why KV-cache grows with context × batch</SectionHeading>
        <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground space-y-3 text-sm leading-relaxed">
          <p>
            During the decode phase, each token needs access to every previous token's key and
            value vectors. This cached tensor is the <strong className="text-foreground">KV-cache</strong>.
            Its size is exactly:
          </p>
          <pre className="rounded-lg bg-muted px-4 py-3 text-xs font-mono overflow-x-auto">
{`KV bytes = 2 × layers × kv_heads × head_dim
          × context_length × batch_size × bytes_per_elem`}
          </pre>
          <p>
            The <code className="rounded bg-muted px-1 py-0.5 text-xs">2</code> accounts for both Key and Value tensors.
            For a typical 8B model (32 layers, 8 KV heads, head_dim 128) at 32K context, batch 4, FP16:
          </p>
          <pre className="rounded-lg bg-muted px-4 py-3 text-xs font-mono overflow-x-auto">
{`= 2 × 32 × 8 × 128 × 32768 × 4 × 2
= ~17 GB of KV-cache alone`}
          </pre>
          <p>
            This is why <code className="rounded bg-muted px-1 py-0.5 text-xs">--max-model-len</code> (vLLM) and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">--context-length</code> (SGLang) are critical on
            constrained hardware — set them to the longest context you actually need, not the model's
            native maximum.
          </p>
        </div>
      </section>

      {/* Deploy CTA */}
      <DeployCta
        text="Ready to pick a GPU? The GPU Finder matches current marketplace offers to your exact model and quantization requirements."
        href="/find"
        label="Find a GPU →"
      />
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold">{children}</h2>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function DeployCta({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <p className="flex-1 text-sm text-muted-foreground">{text}</p>
      <Link
        href={href}
        className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
      >
        {label}
      </Link>
    </div>
  );
}
