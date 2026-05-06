"use client";

import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import type { ModelQuant } from "@/lib/types";
import type { GpuProfile } from "@/lib/gpu-profiles";
import { quantFitsGpu } from "@/lib/gpu-profiles";

const FORMAT_STYLE: Record<string, string> = {
  gguf:    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300/50 dark:border-amber-700/40",
  awq:     "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-violet-300/50 dark:border-violet-700/40",
  gptq:    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border-sky-300/50 dark:border-sky-700/40",
  fp8:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-700/40",
  bnb:     "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300 border-pink-300/50 dark:border-pink-700/40",
  fp16:    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 border-slate-300/50 dark:border-slate-600/40",
  int8:    "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-teal-300/50 dark:border-teal-700/40",
  int4:    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-300/50 dark:border-orange-700/40",
  fp4:     "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-300/50 dark:border-rose-700/40",
  mlx:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-300/50 dark:border-indigo-700/40",
  unknown: "bg-muted text-muted-foreground border-border/50",
};

function fmtGb(n: number): string {
  return n >= 10 ? `${n.toFixed(0)} GB` : `${n.toFixed(1)} GB`;
}

interface QuantChipProps {
  quant: ModelQuant;
  targetGpu?: GpuProfile;
}

export function QuantChip({ quant, targetGpu }: QuantChipProps) {
  const style = FORMAT_STYLE[quant.quant_format] ?? FORMAT_STYLE.unknown;
  const fits = targetGpu ? quantFitsGpu(quant, targetGpu) : null;

  function handleClick() {
    const cmd = quant.hf_repo
      ? `huggingface-cli download ${quant.hf_repo}`
      : quant.name;
    navigator.clipboard.writeText(cmd)
      .then(() => toast.success("Copied!"))
      .catch(() => toast.error("Copy failed — clipboard access denied"));
  }

  const chip = (
    <button
      onClick={handleClick}
      className={[
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium transition-all hover:opacity-80",
        style,
        fits === false ? "opacity-30" : "",
        fits === true ? "ring-1 ring-emerald-500/50" : "",
      ].filter(Boolean).join(" ")}
    >
      {quant.name}
    </button>
  );

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="max-w-56 text-xs">
          <div className="space-y-1.5">
            <p className="font-semibold">{quant.name}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>Format</span>
              <span className="text-foreground">{quant.quant_format}</span>
              <span>bpw</span>
              <span className="text-foreground">{quant.bits_per_weight}</span>
              <span>Disk</span>
              <span className="text-foreground">
                {quant.disk_size_gb > 0 ? fmtGb(quant.disk_size_gb) : "unknown"}
              </span>
              <span>VRAM</span>
              <span className="text-foreground">
                {quant.vram_weights_gb > 0 ? fmtGb(quant.vram_weights_gb) : "unknown"}
              </span>
              {quant.cc_min && (
                <>
                  <span>CC min</span>
                  <span className="text-foreground">{quant.cc_min}</span>
                </>
              )}
              {quant.arch_vllm && (
                <>
                  <span>vLLM</span>
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                </>
              )}
              {quant.arch_sglang && (
                <>
                  <span>SGLang</span>
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                </>
              )}
            </div>
            {quant.hf_repo && (
              <p className="text-[10px] text-muted-foreground/60">Click to copy download cmd</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
