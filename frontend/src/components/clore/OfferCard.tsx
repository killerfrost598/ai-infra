"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import type { CloreOffer } from "@/lib/types";
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
  onRent: () => void;
  onAdvise: () => void;
}

export function OfferCard({ offer, onRent, onAdvise }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const pcieColor = pcieBadgeColor(offer.pcie_version);

  return (
    <Card className="overflow-hidden">
      <button
        onClick={onAdvise}
        className="w-full px-4 py-3.5 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{offer.gpu_name}</p>
              {offer.gpu_count > 1 && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">×{offer.gpu_count}</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span className="text-indigo-400">{offer.vram_gb * offer.gpu_count} GB VRAM</span>
              {offer.cuda_version && <span className="text-muted-foreground">CUDA {offer.cuda_version}</span>}
              <span className={`font-mono ${pcieColor}`}>
                PCIe {offer.pcie_version ?? "?"}{offer.pcie_width ? ` x${offer.pcie_width}` : ""}
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

      <div className="flex items-center gap-2 border-t border-border/40 px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDetailsOpen(true)}
          className="gap-1.5 text-xs"
          title={`View specs for ${offer.gpu_name}`}
        >
          <Info className="size-3.5" />
          Specs
        </Button>
        <div className="ml-auto">
          <Button size="sm" onClick={onRent}>Rent</Button>
        </div>
      </div>

      <ServerInfoModal offer={offer} open={detailsOpen} onOpenChange={setDetailsOpen} onRent={onRent} />
    </Card>
  );
}
