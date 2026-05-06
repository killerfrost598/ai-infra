"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { useSettings, useSaveSetting, useDeleteSetting } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

// ── Clore marketplace filter definitions ────────────────────────────────────

const CLORE_FILTERS = [
  {
    key: "clore_min_pcie_gen",
    label: "Min PCIe Gen",
    placeholder: "e.g. 3",
    tip: "Exclude servers below this PCIe generation. PCIe < 3 creates GPU↔host bandwidth bottlenecks for inference workloads. Recommended: 3.",
  },
  {
    key: "clore_min_pcie_width",
    label: "Min PCIe Width",
    placeholder: "e.g. 8",
    tip: "Exclude servers with a PCIe link narrower than this. x8 is the minimum for reliable inference throughput. Recommended: 8.",
  },
  {
    key: "clore_min_disk_gb",
    label: "Min Disk (GB)",
    placeholder: "e.g. 100",
    tip: "Exclude servers with less total storage than this. 100 GB is the practical minimum for a single large model. Recommended: 100.",
  },
  {
    key: "clore_min_dl_mbps",
    label: "Min Download (Mbps)",
    placeholder: "e.g. 500",
    tip: "Exclude servers with download bandwidth below this threshold. Low bandwidth makes model pulls painfully slow.",
  },
  {
    key: "clore_min_ul_mbps",
    label: "Min Upload (Mbps)",
    placeholder: "e.g. 200",
    tip: "Exclude servers with upload bandwidth below this threshold.",
  },
  {
    key: "clore_min_cuda",
    label: "Min CUDA Version",
    placeholder: "e.g. 12.0",
    tip: "Exclude servers running a CUDA version older than this. Use major.minor format (e.g. 12.0). vLLM and SGLang require at least 11.8.",
  },
  {
    key: "clore_min_vram_gb",
    label: "Min Total VRAM (GB)",
    placeholder: "e.g. 24",
    tip: "Exclude servers whose total VRAM (gpu_count × per_gpu_vram) is below this. Useful for filtering out single-GPU rigs that can't load your target models.",
  },
] as const;

// ── Quant format definitions ─────────────────────────────────────────────────

const QUANT_FORMATS = [
  {
    key: "gguf",
    tip: "GGUF — CPU/Mac llama.cpp + Ollama only. vLLM/SGLang servers don't load GGUF; exclude if you only deploy on Clore GPUs.",
  },
  {
    key: "mlx",
    tip: "MLX — Apple Silicon only. Cannot run on Clore CUDA servers; exclude unless testing on Mac.",
  },
  { key: "awq",  tip: "AWQ — 4-bit weight quantization. Requires CC ≥ 7.5 (Turing+)." },
  { key: "gptq", tip: "GPTQ — 4-bit weight quantization. Older sibling of AWQ; widely supported." },
  { key: "bnb",  tip: "bitsandbytes (NF4) — fast loading, modest throughput. Requires CC ≥ 7.5." },
  { key: "fp8",  tip: "FP8 native — H100 / L40S / Blackwell only (CC ≥ 8.9)." },
  { key: "fp16", tip: "FP16 / BF16 — full half-precision. Largest VRAM footprint, no quant loss." },
  { key: "int8", tip: "INT8 — W8A8 quantization. Requires CC ≥ 6.1; modest VRAM savings." },
  { key: "int4", tip: "INT4 — generic 4-bit weight quant. CC ≥ 7.5." },
  { key: "fp4",  tip: "FP4 (MXFP4) — Blackwell-only (CC ≥ 10.0)." },
  { key: "unknown", tip: "Unknown — quant format detection failed; treat these entries with caution." },
] as const;

// ── Sub-components ───────────────────────────────────────────────────────────

function TipIcon({ tip }: { tip: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <HelpCircle className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs text-xs leading-snug">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FilterRow({
  filterKey,
  label,
  placeholder,
  tip,
  currentValue,
}: {
  filterKey: string;
  label: string;
  placeholder: string;
  tip: string;
  currentValue: string | null | undefined;
}) {
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();
  const [input, setInput] = useState("");

  function handleSet() {
    const v = input.trim();
    if (!v) return;
    saveSetting.mutate({ key: filterKey, value: v }, { onSuccess: () => setInput("") });
  }

  function handleClear() {
    deleteSetting.mutate(filterKey);
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex w-44 shrink-0 items-center gap-1.5">
        <span className="text-sm">{label}</span>
        <TipIcon tip={tip} />
      </div>
      <div className="flex flex-1 items-center gap-2">
        {currentValue && (
          <span className="shrink-0 text-xs text-muted-foreground/50">
            {currentValue} →
          </span>
        )}
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSet()}
        />
        <Button
          size="sm"
          className="h-7 shrink-0 px-2.5 text-xs"
          disabled={!input.trim()}
          loading={saveSetting.isPending}
          onClick={handleSet}
        >
          Set
        </Button>
        {currentValue && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-xs text-destructive hover:text-destructive"
            loading={deleteSetting.isPending}
            onClick={handleClear}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function GlobalFiltersCard() {
  const { data } = useSettings();
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();

  const settings = data?.settings ?? [];

  function getVal(key: string) {
    return settings.find((s) => s.key === key)?.value ?? null;
  }

  const rawExcluded = getVal("excluded_quant_formats") ?? "";
  const excluded = new Set(
    rawExcluded
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  function toggleFormat(fmt: string) {
    const next = new Set(excluded);
    if (next.has(fmt)) next.delete(fmt);
    else next.add(fmt);

    const value = [...next].join(",");
    if (value) {
      saveSetting.mutate({ key: "excluded_quant_formats", value });
    } else {
      deleteSetting.mutate("excluded_quant_formats");
    }
  }

  return (
    <Card className="px-6 py-5">
      <p className="font-semibold">Platform Filters</p>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        Applied globally across Marketplace, GPU Finder, and the Models knowledge base.
        The offer list is cached for 10 minutes — saving a GPU filter immediately
        busts the cache. All fields are optional; leave blank to skip filtering on that dimension.
      </p>

      {/* ── Clore GPU Quality Bar ────────────────────────────────────────────── */}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Clore GPU Quality Bar
        </p>
        <div className="divide-y divide-border/30">
          {CLORE_FILTERS.map((f) => (
            <FilterRow
              key={f.key}
              filterKey={f.key}
              label={f.label}
              placeholder={f.placeholder}
              tip={f.tip}
              currentValue={getVal(f.key)}
            />
          ))}
        </div>
      </div>

      {/* ── Quant Format Exclusion ────────────────────────────────────────────── */}
      <div className="mt-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Excluded Quant Formats
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Checked formats are hidden from the Models knowledge base globally. Models where every
          quant is excluded are removed from results entirely.
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {QUANT_FORMATS.map(({ key, tip }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 text-sm select-none"
            >
              <input
                type="checkbox"
                checked={excluded.has(key)}
                onChange={() => toggleFormat(key)}
                className="h-3.5 w-3.5 rounded accent-primary"
              />
              <span className={excluded.has(key) ? "line-through text-muted-foreground/40" : ""}>
                {key}
              </span>
              <TipIcon tip={tip} />
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}
