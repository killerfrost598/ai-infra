"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  ExternalLink,
  Pencil,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Download,
  Heart,
  TrendingUp,
} from "lucide-react";
import type { ModelEntry, ModelQuant } from "@/lib/types";
import type { GpuProfile } from "@/lib/gpu-profiles";
import { quantFitsGpu } from "@/lib/gpu-profiles";
import { Card } from "@/components/ui/card";
import { QuantChip } from "./QuantChip";

const MAX_CHIPS_COLLAPSED = 8;

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

interface ModelCardProps {
  model: ModelEntry;
  targetGpu?: GpuProfile;
  onEdit: () => void;
  onDelete: () => void;
  onAddQuant: () => void;
  onEditQuant: (q: ModelQuant) => void;
  onDeleteQuant: (q: ModelQuant) => void;
}

export function ModelCard({
  model,
  targetGpu,
  onEdit,
  onDelete,
  onAddQuant,
  onEditQuant,
  onDeleteQuant,
}: ModelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);

  const { quants } = model;
  const compatQuants = targetGpu ? quants.filter((q) => quantFitsGpu(q, targetGpu)) : null;
  const hasCompat = compatQuants !== null && compatQuants.length > 0;
  const isIncompat = !!targetGpu && !hasCompat;

  const visibleChips = showAllChips ? quants : quants.slice(0, MAX_CHIPS_COLLAPSED);
  const hiddenCount = quants.length - MAX_CHIPS_COLLAPSED;

  const capTags = [
    model.is_reasoning && "reasoning",
    model.is_code_model && "code",
    model.is_moe && "MoE",
    model.supports_tools && "tools",
  ].filter(Boolean) as string[];

  return (
    <Card className={["overflow-hidden transition-opacity", isIncompat ? "opacity-35" : ""].join(" ")}>
      {/* ── Header row ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="min-w-0 flex-1">
          {/* Name + badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{model.name}</span>
            {model.param_count_b > 0 && (
              <Badge>{model.param_count_b}B</Badge>
            )}
            {model.max_context_k > 0 && (
              <Badge>{model.max_context_k}k ctx</Badge>
            )}
            {capTags.map((t) => <Badge key={t}>{t}</Badge>)}
            {targetGpu && hasCompat && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                fits {targetGpu.name}
              </span>
            )}
          </div>

          {/* HF stats */}
          {(model.hf_downloads != null || model.hf_likes != null || model.hf_trending_score != null) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground/60">
              {model.hf_downloads != null && (
                <span className="flex items-center gap-0.5">
                  <Download className="size-2.5" />
                  {fmtNum(model.hf_downloads)}
                </span>
              )}
              {model.hf_likes != null && (
                <span className="flex items-center gap-0.5">
                  <Heart className="size-2.5" />
                  {fmtNum(model.hf_likes)}
                </span>
              )}
              {model.hf_trending_score != null && (
                <span className="flex items-center gap-0.5">
                  <TrendingUp className="size-2.5" />
                  {model.hf_trending_score.toFixed(1)}
                </span>
              )}
              {model.family && (
                <span className="text-muted-foreground/40">{model.family}</span>
              )}
            </div>
          )}

          {/* Quant chips (collapsed view) */}
          {!expanded && quants.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {visibleChips.map((q) => (
                <QuantChip key={q.id} quant={q} targetGpu={targetGpu} />
              ))}
              {!showAllChips && hiddenCount > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAllChips(true); }}
                  className="inline-flex items-center rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  +{hiddenCount} more
                </button>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {model.hf_url && (
            <a
              href={model.hf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
              title="Open on HuggingFace"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
          <IconBtn icon={<Pencil className="size-3" />} label="Edit model" onClick={onEdit} />
          <IconBtn icon={<Trash2 className="size-3" />} label="Delete model" onClick={onDelete} danger />
        </div>
      </div>

      {/* ── Expanded quant list ──────────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-border/30 bg-muted/20 px-4 pb-3 pt-2 space-y-1.5">
          {quants.map((q) => (
            <ExpandedQuantRow
              key={q.id}
              quant={q}
              targetGpu={targetGpu}
              onEdit={() => onEditQuant(q)}
              onDelete={() => onDeleteQuant(q)}
            />
          ))}
          {quants.length === 0 && (
            <p className="text-xs text-muted-foreground/60">No quants yet.</p>
          )}
          <button
            onClick={onAddQuant}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            <Plus className="size-3" /> Add quant
          </button>
        </div>
      )}
    </Card>
  );
}

function ExpandedQuantRow({
  quant,
  targetGpu,
  onEdit,
  onDelete,
}: {
  quant: ModelQuant;
  targetGpu?: GpuProfile;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full py-0.5">
      <QuantChip quant={quant} targetGpu={targetGpu} />
      <span className="text-[10px] text-muted-foreground/60 min-w-0 truncate">
        {quant.bits_per_weight}bpw · {quant.disk_size_gb.toFixed(1)} GB disk ·{" "}
        {quant.vram_weights_gb.toFixed(1)} GB VRAM
        {quant.cc_min ? ` · CC≥${quant.cc_min}` : ""}
        {quant.arch_vllm ? " · vLLM" : ""}
        {quant.arch_sglang ? " · SGLang" : ""}
      </span>
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        <IconBtn icon={<Pencil className="size-2.5" />} label="Edit" onClick={onEdit} />
        <IconBtn icon={<Trash2 className="size-2.5" />} label="Delete" onClick={onDelete} danger />
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function IconBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        "rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        danger
          ? "text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}
