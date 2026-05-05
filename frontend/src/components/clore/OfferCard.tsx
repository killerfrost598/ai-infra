"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import type { CloreOffer, InferenceBenchmark } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ServerInfoModal } from "./ServerInfoModal";

export function fmtSpeed(mbps: number | null | undefined): string {
  if (mbps == null) return "—";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${Math.round(mbps)} Mbps`;
}

export function pcieBadgeColor(version: string | null): string {
  if (!version) return "text-muted-foreground/40";
  const v = parseFloat(version);
  if (v >= 4) return "text-emerald-600 dark:text-emerald-500";
  if (v >= 3) return "text-yellow-600 dark:text-yellow-500";
  return "text-rose-600 dark:text-rose-400";
}

interface Props {
  offer: CloreOffer;
  benchmarks: InferenceBenchmark[];
  onRent: () => void;
  onAdvise: () => void;
}

export function OfferCard({ offer, benchmarks, onRent, onAdvise }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const pcieColor = pcieBadgeColor(offer.pcie_version);
  const pcieWidthColor =
    !offer.pcie_width ? "text-muted-foreground/40" :
    offer.pcie_width >= 16 ? "text-emerald-600 dark:text-emerald-500" :
    offer.pcie_width >= 8  ? "text-yellow-600 dark:text-yellow-500" :
    "text-rose-600 dark:text-rose-400";

  return (
    <Card className="overflow-hidden">
      <button
        onClick={onAdvise}
        className="w-full px-6 py-5 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">{offer.gpu_name}</p>
              {offer.gpu_count > 1 && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">×{offer.gpu_count}</span>
              )}
              <span className="text-[10px] text-indigo-400/60">Model Advisor →</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span className="text-indigo-400">{offer.vram_gb} GB VRAM</span>
              {offer.cuda_version && <span className="text-muted-foreground">CUDA {offer.cuda_version}</span>}
              <span className={`font-mono ${pcieColor}`}>
                PCIe {offer.pcie_version ?? "?"} {offer.pcie_width ? `x${offer.pcie_width}` : ""}
              </span>
              {offer.disk_gb != null && (
                <span className={offer.disk_gb >= 100 ? "text-muted-foreground" : "text-rose-400"}>
                  {offer.disk_gb} GB disk
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right space-y-1">
            <p className="text-sm font-semibold">
              ${offer.price_per_day.toFixed(2)}<span className="text-xs text-muted-foreground">/day</span>
            </p>
            {offer.upload_mbps != null && (
              <p className="text-xs text-muted-foreground">↑ {fmtSpeed(offer.upload_mbps)} · ↓ {fmtSpeed(offer.download_mbps)}</p>
            )}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-2 border-t border-border/40 px-6 py-2">
        <Button variant="ghost" size="sm" onClick={() => setExpanded((x) => !x)} title="Show full specs">
          {expanded ? "Hide specs" : "Specs"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDetailsOpen(true)}
          className="gap-1.5 text-xs"
          title={`View details for ${offer.gpu_name}`}
          aria-label={`View details for ${offer.gpu_name}`}
        >
          <Info className="size-3.5" />
          View details
        </Button>
        <div className="ml-auto">
          <Button size="sm" onClick={onRent}>Rent</Button>
        </div>
      </div>

      <ServerInfoModal offer={offer} open={detailsOpen} onOpenChange={setDetailsOpen} />

      {expanded && (
        <div className="border-t border-border px-6 pb-4 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <SpecRow label="CPU" value={offer.cpu_model} />
            <SpecRow label="System RAM" value={offer.ram_gb != null ? `${offer.ram_gb} GB` : null} />
            <SpecRow label="Disk" value={offer.disk_gb != null ? `${offer.disk_gb} GB` : null} />
            <SpecRow label="PCIe version" value={offer.pcie_version} colorClass={pcieColor} />
            <SpecRow label="PCIe width" value={offer.pcie_width != null ? `x${offer.pcie_width}` : null} colorClass={pcieWidthColor} />
            <SpecRow label="Upload" value={offer.upload_mbps != null ? fmtSpeed(offer.upload_mbps) : null} />
            <SpecRow label="Download" value={offer.download_mbps != null ? fmtSpeed(offer.download_mbps) : null} />
            <SpecRow label="CUDA" value={offer.cuda_version} />
            <SpecRow label="GPU count" value={String(offer.gpu_count)} />
          </div>

          {benchmarks.length > 0 && (
            <div className="border-t border-border/60 pt-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Performance data</p>
              <div className="space-y-1.5">
                {benchmarks.slice(0, 4).map((b) => (
                  <div key={b.id} className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground truncate flex-1">
                      {b.model_name}{b.quantization ? ` (${b.quantization})` : ""}
                    </span>
                    {b.tokens_per_second_avg != null && (
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 shrink-0">
                        {b.tokens_per_second_avg.toFixed(1)} t/s
                      </span>
                    )}
                    {b.max_parallel_connections != null && (
                      <span className="text-muted-foreground/60 shrink-0">{b.max_parallel_connections} concurrent</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {benchmarks.length === 0 && (
            <div className="border-t border-border/60 pt-2 text-xs text-muted-foreground/40">
              No benchmarks recorded for this GPU.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function SpecRow({
  label,
  value,
  colorClass = "text-foreground/80",
}: {
  label: string;
  value: string | null | undefined;
  colorClass?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground/60 shrink-0">{label}</span>
      <span className={value ? colorClass : "text-muted-foreground/30 italic"}>{value ?? "unknown"}</span>
    </div>
  );
}
