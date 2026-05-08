"use client";

import { ArrowRight, Copy, Cpu, Globe, Microchip, Zap } from "lucide-react";
import { toast } from "sonner";
import type { CloreOffer } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtSpeed } from "./OfferCard";

interface Props {
  offer: CloreOffer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRent?: () => void;
}

type Tone = "neutral" | "info" | "ok" | "warn" | "err";

function valueToneClass(tone: Tone): string {
  if (tone === "info") return "text-indigo-600 dark:text-indigo-300";
  if (tone === "ok") return "text-emerald-600 dark:text-emerald-300";
  if (tone === "warn") return "text-amber-600 dark:text-amber-300";
  if (tone === "err") return "text-rose-600 dark:text-rose-300";
  return "text-slate-800 dark:text-zinc-100";
}

function eyebrowClassName() {
  return "text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-400";
}

function UnknownValue() {
  return (
    <span className="font-mono text-[12px] text-slate-500 dark:text-zinc-400">
      unknown
    </span>
  );
}

function DashValue() {
  return (
    <span className="font-mono text-[13px] text-slate-400 dark:text-zinc-500">
      —
    </span>
  );
}

function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-1 font-mono text-[11px] ${
        tone === "info"
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
          : "border-slate-300 bg-slate-100 text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {label}
    </span>
  );
}

function KeyValue({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode | null;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className={`font-mono text-[13px] ${valueToneClass(tone)}`}>
        {value ?? <UnknownValue />}
      </dd>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500 dark:text-zinc-400">{icon}</span>
      <h4 className={eyebrowClassName()}>{title}</h4>
    </div>
  );
}

function diskTone(diskGb: number | null): Tone {
  if (diskGb == null) return "neutral";
  if (diskGb < 100) return "err";
  if (diskGb < 250) return "warn";
  return "ok";
}

function speedTone(value: number | null): Tone {
  if (value == null) return "neutral";
  if (value >= 300) return "ok";
  if (value >= 100) return "warn";
  return "err";
}

const dashedDivider = "border-t border-dashed border-slate-300 dark:border-zinc-800";

function summarizeGpuArray(gpuArray: string[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const name of gpuArray) {
    const count = counts.get(name);
    if (count == null) {
      counts.set(name, 1);
      order.push(name);
      continue;
    }
    counts.set(name, count + 1);
  }

  return order
    .map((name) => {
      const count = counts.get(name) ?? 0;
      return count > 1 ? `${name} ×${count}` : name;
    })
    .join(" · ");
}

export function ServerInfoModal({ offer, open, onOpenChange, onRent }: Props) {
  if (!offer) return null;

  const totalVram = offer.vram_gb * offer.gpu_count;
  const pcieVersion = offer.pcie_version ? parseFloat(offer.pcie_version) : null;
  const pcieTone: Tone =
    pcieVersion == null ? "neutral"
    : pcieVersion >= 4 ? "ok"
    : pcieVersion >= 3 ? "warn"
    : "err";
  const pcieValue = offer.pcie_version
    ? `${offer.pcie_version} ×${offer.pcie_width ?? "?"}`
    : null;
  const coinValues = offer.allowed_coins.length > 0 ? offer.allowed_coins : ["CLORE", "USD", "bitcoin"];
  const canShowMixedRig = offer.gpu_array.length > 1;
  const mixedRigSummary = summarizeGpuArray(offer.gpu_array);

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

  const handleRent = () => {
    onOpenChange(false);
    onRent?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-black/70 backdrop-blur-[2px]"
        className="max-h-[90vh] max-w-[760px] overflow-hidden rounded-xl border border-slate-300 p-0 dark:border-zinc-800"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{offer.gpu_name} server details</DialogTitle>
        </DialogHeader>

        <div className="max-h-[90vh] overflow-y-auto bg-slate-100 text-slate-900 dark:bg-[#0d0d11] dark:text-zinc-100">
          <div className="grid" style={{ gridTemplateColumns: "1.9fr 1fr" }}>

            {/* ── Left: spec sheet ── */}
            <div className="border-r border-slate-300 p-5 dark:border-zinc-800">

              {/* Header */}
              <div className="pb-4">
                <h3 className="text-xl font-semibold leading-none">
                  {offer.gpu_name}
                  {offer.gpu_count > 1 && (
                    <span className="ml-2 text-sm font-medium text-slate-500 dark:text-zinc-400">
                      ×{offer.gpu_count}
                    </span>
                  )}
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge label={`${totalVram} GB VRAM`} tone="info" />
                  <Badge label={offer.cuda_version ? `CUDA ${offer.cuda_version}` : "CUDA unknown"} />
                  <Badge label={`#${offer.id}`} />
                </div>
              </div>

              {/* Compute */}
              <section className="border-t border-slate-300 pt-4 dark:border-zinc-800">
                <SectionHeader icon={<Microchip className="size-3.5" />} title="Compute" />
                <div className="mt-2">
                  <div className="grid grid-cols-2 gap-x-4">
                    <KeyValue label="VRAM / GPU" value={`${offer.vram_gb} GB`} />
                    <KeyValue label="GPU count" value={String(offer.gpu_count)} />
                  </div>
                  <div className={`grid grid-cols-2 gap-x-4 ${dashedDivider}`}>
                    <KeyValue label="Total VRAM" value={`${totalVram} GB`} tone="info" />
                    <KeyValue label="CUDA" value={offer.cuda_version} />
                  </div>
                  <div className={`grid grid-cols-2 gap-x-4 ${dashedDivider}`}>
                    <KeyValue label="PCIe" value={pcieValue} tone={pcieTone} />
                    <KeyValue label="Score" value={offer.score != null ? offer.score.toFixed(2) : null} />
                  </div>
                </div>
                {canShowMixedRig && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    <Zap className="size-3 text-indigo-500 dark:text-indigo-300" />
                    Mixed rig:{" "}
                    <span className="font-mono text-[12px] text-slate-700 dark:text-zinc-300">
                      {mixedRigSummary}
                    </span>
                  </p>
                )}
              </section>

              {/* Host */}
              <section className="mt-4 border-t border-slate-300 pt-4 dark:border-zinc-800">
                <SectionHeader icon={<Cpu className="size-3.5" />} title="Host" />
                <dl className="mt-2">
                  <KeyValue label="CPU" value={offer.cpu_model} />
                  <div className={`grid grid-cols-2 gap-x-4 ${dashedDivider}`}>
                    <KeyValue
                      label="RAM"
                      value={offer.ram_gb != null ? `${offer.ram_gb} GB` : null}
                    />
                    <KeyValue
                      label="Disk"
                      value={offer.disk_gb != null ? `${offer.disk_gb} GB` : null}
                      tone={diskTone(offer.disk_gb)}
                    />
                  </div>
                </dl>
              </section>

              {/* Network */}
              <section className="mt-4 border-t border-slate-300 pt-4 dark:border-zinc-800">
                <SectionHeader icon={<Globe className="size-3.5" />} title="Network" />
                <dl className={`mt-2 grid grid-cols-2 gap-x-4`}>
                  <div className="flex items-center justify-between gap-4 py-1.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-400">
                      Upload
                    </dt>
                    <dd className={`font-mono text-[13px] ${valueToneClass(speedTone(offer.upload_mbps))}`}>
                      {offer.upload_mbps != null ? fmtSpeed(offer.upload_mbps) : <DashValue />}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-1.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-zinc-400">
                      Download
                    </dt>
                    <dd className={`font-mono text-[13px] ${valueToneClass(speedTone(offer.download_mbps))}`}>
                      {offer.download_mbps != null ? fmtSpeed(offer.download_mbps) : <DashValue />}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            {/* ── Right: checkout rail ── */}
            <aside className="flex flex-col bg-slate-50 p-5 dark:bg-zinc-900/70">
              <div>
                <p className={eyebrowClassName()}>On-demand</p>
                <p className="mt-1 flex items-end gap-1 font-mono">
                  <span className="text-4xl font-semibold tracking-tight">
                    ${offer.price_per_day.toFixed(2)}
                  </span>
                  <span className="pb-1 text-xs text-slate-500 dark:text-zinc-400">/day</span>
                </p>
                {offer.spot_price_per_day != null ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-zinc-400">
                    Spot from{" "}
                    <span className="font-mono text-emerald-600 dark:text-emerald-300">
                      ${offer.spot_price_per_day.toFixed(2)}/day
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 dark:text-zinc-400">
                    No spot pricing
                  </p>
                )}
              </div>

              <div className="mt-6 border-t border-slate-300 pt-4 dark:border-zinc-800">
                <p className={eyebrowClassName()}>Pays in</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {coinValues.map((coin) => (
                    <span
                      key={coin}
                      className="rounded-md border border-slate-300 bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {coin}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-6 border-t border-slate-300 pt-4 dark:border-zinc-800">
                <p className={eyebrowClassName()}>Server</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="font-mono text-[13px] text-slate-800 dark:text-zinc-200">
                    #{offer.id}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-100"
                    onClick={copyServerId}
                    aria-label={`Copy server ID ${offer.id}`}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-auto space-y-2 pt-8">
                <Button
                  className="h-10 w-full justify-center rounded-md bg-indigo-600 px-3 text-sm text-white hover:bg-indigo-500 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                  onClick={handleRent}
                >
                  Rent this server
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-10 w-full rounded-md border-slate-300 bg-transparent text-sm dark:border-zinc-700 dark:text-zinc-300"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
