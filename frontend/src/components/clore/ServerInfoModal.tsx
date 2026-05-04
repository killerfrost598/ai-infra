"use client";

import type { CloreOffer } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtSpeed, pcieBadgeColor } from "./OfferCard";

interface Props {
  offer: CloreOffer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm ${valueClass ?? "text-foreground/90"}`}>
        {value ?? <span className="italic text-muted-foreground/30">unknown</span>}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
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

export function ServerInfoModal({ offer, open, onOpenChange }: Props) {
  if (!offer) return null;

  const pcieColor = pcieBadgeColor(offer.pcie_version);
  const totalVram = offer.vram_gb * offer.gpu_count;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-y-auto max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{offer.gpu_name}</span>
            {offer.gpu_count > 1 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground font-normal">
                ×{offer.gpu_count}
              </span>
            )}
            <span className="ml-auto text-sm font-semibold">
              ${offer.price_per_day.toFixed(2)}
              <span className="text-xs font-normal text-muted-foreground">/day</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* GPU */}
          <Section title="GPU">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row
                label="Server ID"
                value={`#${offer.id}`}
                valueClass="font-mono text-muted-foreground"
              />
              <Row label="VRAM total" value={`${totalVram} GB`} valueClass="text-indigo-500 font-medium" />
              <Row label="CUDA" value={offer.cuda_version} />
            </dl>
            {offer.gpu_array.length > 1 && (
              <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Mixed rig — {offer.gpu_array.join(" · ")}
              </div>
            )}
          </Section>

          {/* System */}
          <Section title="System">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row label="CPU" value={offer.cpu_model} className="col-span-2 sm:col-span-2" />
              <Row
                label="RAM"
                value={offer.ram_gb != null ? `${offer.ram_gb} GB` : null}
              />
              <Row
                label="SSD / Disk"
                value={offer.disk_gb != null ? `${offer.disk_gb} GB` : null}
                valueClass={
                  offer.disk_gb == null ? undefined :
                  offer.disk_gb < 100 ? "text-rose-500" : "text-foreground/90"
                }
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

          {/* Networking */}
          <Section title="Networking">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Row label="Upload" value={fmtSpeed(offer.upload_mbps)} />
              <Row label="Download" value={fmtSpeed(offer.download_mbps)} />
            </dl>
          </Section>

          {/* Pricing & rental */}
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
              <Row label="Min rental" value={fmtMrl(offer.mrl)} />
            </dl>
            {offer.allowed_coins.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
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
