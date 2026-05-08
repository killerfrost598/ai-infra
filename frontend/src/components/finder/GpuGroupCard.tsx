"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CloreOffer, CloreOfferGroup } from "@/lib/types";
import type { RankedBucket, RankedOffer } from "@/lib/gpu-finder";
import { GpuFinderResult } from "./GpuFinderResult";

export const BUCKET_PRIORITY: Record<RankedBucket, number> = {
  comfortable: 0,
  ok: 1,
  tight: 2,
  oom: 3,
};

export const BEST_BUCKET_STYLE: Record<RankedBucket, string> = {
  comfortable: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  ok:          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  tight:       "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  oom:         "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export const BEST_BUCKET_LABEL: Record<RankedBucket, string> = {
  comfortable: "✓ Comfortable",
  ok:          "✓ OK",
  tight:       "≈ Tight",
  oom:         "✗ OOM",
};

interface GpuGroupCardProps {
  group: CloreOfferGroup;
  offers: RankedOffer[];
  expanded: boolean;
  onToggle: () => void;
}

export function GpuGroupCard({ group, offers, expanded, onToggle }: GpuGroupCardProps) {
  const bestBucket = offers.reduce<RankedBucket | null>((best, ro) => {
    if (!best) return ro.bucket;
    return BUCKET_PRIORITY[ro.bucket] < BUCKET_PRIORITY[best] ? ro.bucket : best;
  }, null);

  const vramLabel =
    group.vram_min_gb === group.vram_max_gb
      ? `${group.vram_min_gb} GB`
      : `${group.vram_min_gb}–${group.vram_max_gb} GB`;

  const priceMin = group.price_min_per_day.toFixed(2);
  const priceMax = group.price_max_per_day.toFixed(2);
  const priceLabel =
    priceMin === priceMax ? `$${priceMin}/day` : `$${priceMin}–$${priceMax}/day`;

  const serverWord = offers.length === 1 ? "server" : "servers";

  return (
    <Card className={`overflow-hidden transition-colors ${expanded ? "border-indigo-500/40" : ""}`}>
      <button
        className="w-full px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{group.display_name}</span>
              {group.vendor && group.vendor !== "Unknown" && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {group.vendor}
                </span>
              )}
              {bestBucket && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BEST_BUCKET_STYLE[bestBucket]}`}>
                  {BEST_BUCKET_LABEL[bestBucket]}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {offers.length} {serverWord}
              {" · "}
              {vramLabel} VRAM
              {" · "}
              {priceLabel}
            </p>
          </div>
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        </div>
      </button>
    </Card>
  );
}

interface GpuGroupDrawerProps {
  group: CloreOfferGroup;
  offers: RankedOffer[];
  modelKey: string;
  quant: string;
  onRent: (offer: CloreOffer) => void;
  onAdvise: (offer: CloreOffer) => void;
}

export function GpuGroupDrawer({ group, offers, modelKey, quant, onRent, onAdvise }: GpuGroupDrawerProps) {
  return (
    <div style={{ gridColumn: "1 / -1" }}
      className="rounded-xl border border-indigo-500/20 bg-card px-3 py-3">
      <p className="mb-2 text-xs font-medium text-foreground/60 px-1">
        {group.display_name} — {offers.length} {offers.length === 1 ? "server" : "servers"}
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {offers.map((ro) => (
          <GpuFinderResult
            key={ro.offer.id}
            rankedOffer={ro}
            modelKey={modelKey}
            quant={quant}
            onRent={() => onRent(ro.offer)}
            onAdvise={() => onAdvise(ro.offer)}
          />
        ))}
      </div>
    </div>
  );
}
