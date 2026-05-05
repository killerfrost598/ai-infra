"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { CloreOffer } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtSpeed, pcieBadgeColor } from "./OfferCard";

interface Props {
  offer: CloreOffer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type HealthPill = { label: string; className: string };

function Row({
  label,
  value,
  valueClass,
  className,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </dt>
      <dd className={`mt-1 text-sm ${valueClass ?? "text-foreground/90"}`}>
        {value ?? (
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            Unknown
          </span>
        )}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
        {title}
      </h4>
      {children}
    </section>
  );
}

function fmtMrl(hours: number | null): string | null {
  if (hours == null) return null;
  if (hours < 24) return `${hours}h`;
  if (hours < 168) return `${Math.round(hours / 24)} days`;
  if (hours < 720) return `${Math.round(hours / 168)} weeks`;
  return `${Math.round(hours / 720)} months`;
}

function SummaryPill({ label, className }: HealthPill) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function diskHealth(diskGb: number | null): HealthPill {
  if (diskGb == null) {
    return {
      label: "Disk unknown",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  if (diskGb < 100) {
    return {
      label: `Low disk (${diskGb} GB)`,
      className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    };
  }
  if (diskGb < 250) {
    return {
      label: `Disk ${diskGb} GB`,
      className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  return {
    label: `Disk ${diskGb} GB`,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  };
}

function networkHealth(upload: number | null, download: number | null): HealthPill {
  if (upload == null || download == null) {
    return {
      label: "Network unknown",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  const slower = Math.min(upload, download);
  if (slower >= 1000) {
    return {
      label: "High network",
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    };
  }
  if (slower >= 300) {
    return {
      label: "Good network",
      className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    };
  }
  return {
    label: "Limited network",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  };
}

export function ServerInfoModal({ offer, open, onOpenChange }: Props) {
  if (!offer) return null;

  const pcieColor = pcieBadgeColor(offer.pcie_version);
  const totalVram = offer.vram_gb * offer.gpu_count;
  const minRental = fmtMrl(offer.mrl);
  const diskStatus = diskHealth(offer.disk_gb);
  const networkStatus = networkHealth(offer.upload_mbps, offer.download_mbps);
  const diskValue =
    offer.disk_gb == null ? null :
    offer.disk_gb < 100 ? (
      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
        {offer.disk_gb} GB (low)
      </span>
    ) : (
      `${offer.disk_gb} GB`
    );

  const copyServerId = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Clipboard unavailable");
      return;
    }
    navigator.clipboard
      .writeText(offer.id)
      .then(() => toast.success("Server ID copied"))
      .catch(() => toast.error("Copy failed. Try again."));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="space-y-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="min-w-0 truncate">{offer.gpu_name}</span>
            {offer.gpu_count > 1 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                ×{offer.gpu_count}
              </span>
            )}
            <span className="ml-auto text-sm font-medium text-muted-foreground">Server details</span>
          </DialogTitle>

          <div className="rounded-lg border bg-muted/25 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Server ID
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-sm text-foreground/90">#{offer.id}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={copyServerId}
                    aria-label={`Copy server ID ${offer.id}`}
                  >
                    <Copy className="size-3.5" />
                    Copy
                  </Button>
                </div>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  On-demand
                </p>
                <p className="text-lg font-semibold">
                  ${offer.price_per_day.toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground">/day</span>
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <SummaryPill
                label={`${totalVram} GB total VRAM`}
                className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
              />
              <SummaryPill label={diskStatus.label} className={diskStatus.className} />
              <SummaryPill label={networkStatus.label} className={networkStatus.className} />
              {minRental && (
                <SummaryPill
                  label={`Min rental ${minRental}`}
                  className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                />
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <Section title="GPU">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row label="VRAM / GPU" value={`${offer.vram_gb} GB`} />
              <Row label="GPU count" value={String(offer.gpu_count)} />
              <Row label="VRAM total" value={`${totalVram} GB`} valueClass="text-indigo-500 font-medium" />
              <Row label="CUDA" value={offer.cuda_version} />
            </dl>
            {offer.gpu_array.length > 1 && (
              <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Mixed rig — {offer.gpu_array.join(" · ")}
              </div>
            )}
          </Section>

          <Section title="System">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row label="CPU" value={offer.cpu_model} className="col-span-2 sm:col-span-2" />
              <Row
                label="RAM"
                value={offer.ram_gb != null ? `${offer.ram_gb} GB` : null}
              />
              <Row
                label="SSD / Disk"
                value={diskValue}
              />
              <Row
                label="PCIe"
                value={
                  offer.pcie_version
                    ? `${offer.pcie_version} x${offer.pcie_width ?? "?"}`
                    : null
                }
                valueClass={pcieColor}
              />
              {offer.score != null && (
                <Row label="Score" value={offer.score.toFixed(2)} />
              )}
            </dl>
          </Section>

          <Section title="Networking">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row
                label="Upload"
                value={offer.upload_mbps != null ? fmtSpeed(offer.upload_mbps) : null}
              />
              <Row
                label="Download"
                value={offer.download_mbps != null ? fmtSpeed(offer.download_mbps) : null}
              />
            </dl>
          </Section>

          <Section title="Pricing & Rental">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row
                label="On-demand"
                value={`$${offer.price_per_day.toFixed(2)}/day`}
                valueClass="font-medium"
              />
              <Row
                label="Spot"
                value={
                  offer.spot_price_per_day != null
                    ? `$${offer.spot_price_per_day.toFixed(2)}/day`
                    : null
                }
              />
              <Row label="Min rental" value={minRental} />
            </dl>
            {offer.allowed_coins.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
                  Accepted currencies
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {offer.allowed_coins.map((coin) => (
                    <span
                      key={coin}
                      className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {coin}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
