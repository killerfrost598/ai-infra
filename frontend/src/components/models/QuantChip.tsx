"use client";

import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { ModelQuant } from "@/lib/types";
import type { GpuProfile } from "@/lib/gpu-profiles";
import { quantFitsGpu } from "@/lib/gpu-profiles";
import { quantStyle } from "@/lib/quant-styles";

function fmtGb(n: number): string {
  return n >= 10 ? `${n.toFixed(0)} GB` : `${n.toFixed(1)} GB`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

interface QuantChipProps {
  quant: ModelQuant;
  targetGpu?: GpuProfile;
}

export function QuantChip({ quant, targetGpu }: QuantChipProps) {
  const style = quantStyle(quant.quant_format);
  const fits = targetGpu ? quantFitsGpu(quant, targetGpu) : null;

  function copyCmd() {
    const cmd = quant.hf_repo
      ? `huggingface-cli download ${quant.hf_repo}`
      : quant.name;
    navigator.clipboard.writeText(cmd)
      .then(() => toast.success("Copied!"))
      .catch(() => toast.error("Copy failed"));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={[
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium transition-all hover:opacity-80",
            style,
            fits === false ? "opacity-30" : "",
            fits === true ? "ring-1 ring-emerald-500/50" : "",
          ].filter(Boolean).join(" ")}
        >
          {quant.name}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="top">
        <div className="space-y-2.5">
          <p className="text-sm font-semibold leading-tight">{quant.name}</p>

          {/* Core stats grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">Format</span>
            <span>
              {quant.quant_format}
              {quant.quant_variant ? ` / ${quant.quant_variant}` : ""}
            </span>

            <span className="text-muted-foreground">bpw</span>
            <span>{quant.bits_per_weight}</span>

            <span className="text-muted-foreground">Size</span>
            <span>{quant.vram_weights_gb > 0 ? fmtGb(quant.vram_weights_gb) : "—"}</span>

            <span className="text-muted-foreground">Disk</span>
            <span>{quant.disk_size_gb > 0 ? fmtGb(quant.disk_size_gb) : "—"}</span>

            {quant.cc_min && (
              <>
                <span className="text-muted-foreground">CC min</span>
                <span>{quant.cc_min}</span>
              </>
            )}

            {(quant.arch_vllm || quant.arch_sglang) && (
              <>
                <span className="text-muted-foreground">Engines</span>
                <span className="flex gap-1.5">
                  {quant.arch_vllm && (
                    <span className="text-emerald-600 dark:text-emerald-400">vLLM</span>
                  )}
                  {quant.arch_sglang && (
                    <span className="text-emerald-600 dark:text-emerald-400">SGLang</span>
                  )}
                </span>
              </>
            )}

            {quant.library_name && (
              <>
                <span className="text-muted-foreground">Library</span>
                <span>{quant.library_name}</span>
              </>
            )}

            {quant.gated && (
              <>
                <span className="text-muted-foreground">Gated</span>
                <span className="text-amber-600 dark:text-amber-400">{quant.gated}</span>
              </>
            )}

            {(quant.hf_downloads != null || quant.hf_likes != null) && (
              <>
                <span className="text-muted-foreground">HF stats</span>
                <span className="text-muted-foreground/80">
                  {quant.hf_downloads != null && `↓${fmtNum(quant.hf_downloads)}`}
                  {quant.hf_downloads != null && quant.hf_likes != null && " · "}
                  {quant.hf_likes != null && `♥${fmtNum(quant.hf_likes)}`}
                </span>
              </>
            )}
          </div>

          {/* Author */}
          {quant.author_label && (
            <p className="text-[11px] text-muted-foreground">
              by{" "}
              {quant.author_url ? (
                <a
                  href={quant.author_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {quant.author_label}
                </a>
              ) : (
                quant.author_label
              )}
            </p>
          )}

          {/* Tags */}
          {quant.tags && quant.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {quant.tags.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Notes */}
          {quant.notes && (
            <p className="text-[11px] leading-snug text-muted-foreground/80">{quant.notes}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 border-t border-border/40 pt-2">
            <button
              onClick={copyCmd}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Copy className="size-3" /> Copy download cmd
            </button>
            {quant.hf_url && (
              <a
                href={quant.hf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                HF <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
