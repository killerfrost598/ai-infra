"use client";

import { useState, useMemo } from "react";
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
  Building2,
  Users,
  User,
} from "lucide-react";
import type { ModelEntry, ModelQuant } from "@/lib/types";
import type { GpuProfile } from "@/lib/gpu-profiles";
import { quantFitsGpu } from "@/lib/gpu-profiles";
import { Card } from "@/components/ui/card";
import { QuantChip } from "./QuantChip";

const MAX_CHIPS_COLLAPSED = 8;

type QuantSort = "none" | "size_desc" | "downloads_desc" | "likes_desc";

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
  excludedFormats?: Set<string>;
  activeFormatFilter?: string;
}

export function ModelCard({
  model,
  targetGpu,
  onEdit,
  onDelete,
  onAddQuant,
  onEditQuant,
  onDeleteQuant,
  excludedFormats,
  activeFormatFilter,
}: ModelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAllChips, setShowAllChips] = useState(false);
  const [quantSort, setQuantSort] = useState<QuantSort>("none");

  const { quants } = model;

  // Phase 3: client-side filtering
  const visibleQuants = useMemo(() => {
    let result = quants;
    if (activeFormatFilter) {
      result = result.filter((q) => q.quant_format === activeFormatFilter);
    }
    if (excludedFormats && excludedFormats.size > 0) {
      result = result.filter((q) => !excludedFormats.has(q.quant_format));
    }
    return result;
  }, [quants, activeFormatFilter, excludedFormats]);

  const hiddenByFilter = quants.length - visibleQuants.length;

  // Phase 4: sort
  const sortedQuants = useMemo(() => {
    if (quantSort === "size_desc") return [...visibleQuants].sort((a, b) => b.vram_weights_gb - a.vram_weights_gb);
    if (quantSort === "downloads_desc") return [...visibleQuants].sort((a, b) => (b.hf_downloads ?? 0) - (a.hf_downloads ?? 0));
    if (quantSort === "likes_desc") return [...visibleQuants].sort((a, b) => (b.hf_likes ?? 0) - (a.hf_likes ?? 0));
    return visibleQuants;
  }, [visibleQuants, quantSort]);

  const compatQuants = targetGpu ? sortedQuants.filter((q) => quantFitsGpu(q, targetGpu, model.param_count_b)) : null;
  const hasCompat = compatQuants !== null && compatQuants.length > 0;
  const isIncompat = !!targetGpu && !hasCompat;

  const visibleChips = showAllChips ? sortedQuants : sortedQuants.slice(0, MAX_CHIPS_COLLAPSED);
  const hiddenCount = sortedQuants.length - MAX_CHIPS_COLLAPSED;

  const capTags = [
    model.is_reasoning && "reasoning",
    model.is_code_model && "code",
    model.is_moe && "MoE",
    model.supports_tools && "tools",
  ].filter(Boolean) as string[];

  // Phase 5: kv_cache info
  const kvCache = model.kv_cache as { num_layers?: number; num_kv_heads?: number; head_dim?: number } | null;

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
            <Badge>{quants.length} quants</Badge>
            {targetGpu && hasCompat && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                fits {targetGpu.name}
              </span>
            )}
          </div>

          {/* HF stats + author */}
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
            {model.author_label && <AuthorBadge model={model} />}
          </div>

          {/* Quant chips (collapsed view) */}
          {!expanded && sortedQuants.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {visibleChips.map((q) => (
                <QuantChip key={q.id} quant={q} targetGpu={targetGpu} modelKey={model.model_key} />
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
          {!expanded && hiddenByFilter > 0 && (
            <p className="mt-1 text-[9px] text-muted-foreground/40">
              {hiddenByFilter} quant{hiddenByFilter !== 1 ? "s" : ""} hidden by filters
            </p>
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
          {/* Phase 4: Sort controls */}
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Sort:</span>
            {(["none", "size_desc", "downloads_desc", "likes_desc"] as QuantSort[]).map((s) => (
              <button
                key={s}
                onClick={() => setQuantSort(s)}
                className={[
                  "rounded px-1.5 py-0.5 text-[9px] transition-colors",
                  quantSort === s
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                ].join(" ")}
              >
                {s === "none" ? "Default" : s === "size_desc" ? "Size" : s === "downloads_desc" ? "Downloads" : "Likes"}
              </button>
            ))}
          </div>

          {/* Phase 5: Model info panel */}
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground/60">
            {kvCache && kvCache.num_layers != null && kvCache.num_layers > 0 && (
              <span>{kvCache.num_layers} layers · {kvCache.num_kv_heads} KV heads · {kvCache.head_dim} head dim</span>
            )}
            {model.max_context_k > 0 && (
              <span>up to {model.max_context_k}K context</span>
            )}
            {model.family && (
              <span className="capitalize">{model.family} family</span>
            )}
          </div>

          {hiddenByFilter > 0 && (
            <p className="text-[9px] text-muted-foreground/40 mb-1">
              {hiddenByFilter} quant{hiddenByFilter !== 1 ? "s" : ""} hidden by filters
            </p>
          )}

          {sortedQuants.map((q) => (
            <ExpandedQuantRow
              key={q.id}
              quant={q}
              targetGpu={targetGpu}
              modelKey={model.model_key}
              onEdit={() => onEditQuant(q)}
              onDelete={() => onDeleteQuant(q)}
            />
          ))}
          {sortedQuants.length === 0 && (
            <p className="text-xs text-muted-foreground/60">
              {quants.length > 0 ? "All quants hidden by filters." : "No quants yet."}
            </p>
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
  modelKey,
  onEdit,
  onDelete,
}: {
  quant: ModelQuant;
  targetGpu?: GpuProfile;
  modelKey?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full py-0.5">
      <QuantChip quant={quant} targetGpu={targetGpu} modelKey={modelKey} />
      {/* Phase 6: disk_size_gb cleanup */}
      <span className="text-[10px] text-muted-foreground/60 min-w-0 truncate">
        {quant.bits_per_weight}bpw
        {quant.vram_weights_gb > 0 && ` · ${quant.vram_weights_gb.toFixed(1)} GB size`}
        {quant.disk_size_gb > 0 && ` · ${quant.disk_size_gb.toFixed(1)} GB disk`}
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

function AuthorBadge({ model }: { model: ModelEntry }) {
  const { author_class, author_label, author_url } = model;
  if (!author_label) return null;

  const icon =
    author_class === "standard" ? <Building2 className="size-2.5" /> :
    author_class === "community" ? <Users className="size-2.5" /> :
    <User className="size-2.5" />;

  const cls =
    author_class === "standard"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : author_class === "community"
      ? "border-border/60 text-muted-foreground"
      : "border-transparent text-muted-foreground/40";

  const inner = (
    <span
      className={[
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[9px] font-medium",
        cls,
      ].join(" ")}
    >
      {icon}
      {author_label}
    </span>
  );

  return author_url ? (
    <a
      href={author_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </a>
  ) : (
    inner
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
