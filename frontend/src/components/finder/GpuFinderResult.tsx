"use client";

import { useQuery } from "@tanstack/react-query";
import type { RankedOffer } from "@/lib/gpu-finder";
import { fitStatusBg } from "@/lib/vram";
import { fmtSpeed } from "@/components/clore/OfferCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { FeasibilityReport, FeasibilityCheck } from "@/lib/types";

const ENGINE_BADGE: Record<string, string> = {
  vllm:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  ollama: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const BUCKET_LABEL: Record<string, string> = {
  comfortable: "✓ Comfortable",
  ok:          "✓ OK",
  tight:       "≈ Tight",
  oom:         "✗ OOM",
};

const CHECK_LABELS: Record<string, string> = {
  gpu_arch_known: "GPU arch",
  driver_min: "Driver",
  vram_sufficient: "VRAM",
  cc_supports_quant: "CC/quant",
  fp8_native: "FP8",
  arch_supported_engine: "Arch",
  tp_divides_heads: "TP heads",
  tp_size_allowed: "TP size",
  tp_size_fits_host: "TP fit",
  gpu_homogeneous: "Homogeneous",
  stack_available: "Stack",
};

interface Props {
  rankedOffer: RankedOffer;
  modelKey: string;
  quant: string;
  onRent: () => void;
  onAdvise: () => void;
}

function CompatChips({ offerId, modelKey, quant, engine }: {
  offerId: number;
  modelKey: string;
  quant: string;
  engine: string;
}) {
  const engineUpper = engine.toUpperCase() as "VLLM" | "SGLANG" | "OLLAMA";
  const { data, isLoading } = useQuery<FeasibilityReport>({
    queryKey: ["feasibility", offerId, modelKey, quant, engineUpper],
    queryFn: () => api.feasibility.check({ offer_id: offerId, model_key: modelKey, quant, engine: engineUpper }),
    enabled: offerId > 0 && modelKey !== "" && quant !== "",
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/30" />
        checking compat…
      </div>
    );
  }
  if (!data) return null;

  const fails = data.checks.filter((c: FeasibilityCheck) => c.status === "FAIL");
  const unknowns = data.checks.filter((c: FeasibilityCheck) => c.status === "UNKNOWN" && c.id !== "gpu_homogeneous" && c.id !== "tp_size_fits_host");
  const allPass = fails.length === 0 && data.checks.filter((c: FeasibilityCheck) => c.status === "PASS").length > 0;

  // Derive stack label from stack check PASS reason
  const stackCheck = data.checks.find((c: FeasibilityCheck) => c.id === "stack_available" && c.status === "PASS");
  const stackLabel = stackCheck
    ? stackCheck.reason.match(/vllm\/vllm-openai:([^\s']+)/)?.[1] ?? "Stack ✓"
    : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allPass && stackLabel && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          Stack: {stackLabel} ✓
        </span>
      )}
      {fails.map((c: FeasibilityCheck) => (
        <span
          key={c.id}
          className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300"
          title={c.reason}
        >
          {CHECK_LABELS[c.id] ?? c.id} ✗
        </span>
      ))}
      {unknowns.slice(0, 2).map((c: FeasibilityCheck) => (
        <span
          key={c.id}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          title={c.reason}
        >
          {CHECK_LABELS[c.id] ?? c.id} ?
        </span>
      ))}
    </div>
  );
}

export function GpuFinderResult({ rankedOffer, modelKey, quant, onRent, onAdvise }: Props) {
  const { offer, fit, pickedEngine, topEngine, diskOk, diskHeadroomGb, downloadEtaMin, scores, bucket } = rankedOffer;
  const totalVram = offer.vram_gb * offer.gpu_count;
  const compositePercent = Math.round(scores.composite * 100);
  const offerId = parseInt(offer.id, 10);
  const engine = pickedEngine?.engine ?? "vllm";
  const showBetterEngine =
    topEngine && pickedEngine &&
    topEngine.engine !== pickedEngine.engine &&
    topEngine.meetsVramMin;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3.5 space-y-2.5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{offer.gpu_name}</span>
              {offer.gpu_count > 1 && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  ×{offer.gpu_count}
                </span>
              )}
              <span className="text-xs text-indigo-400">{totalVram} GB VRAM</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold">
              ${offer.price_per_day.toFixed(2)}
              <span className="text-xs font-normal text-muted-foreground">/day</span>
            </p>
            <p className="text-[10px] text-muted-foreground/60">{compositePercent}% match</p>
          </div>
        </div>

        {/* Fit badge + headroom */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${fitStatusBg(fit.status)}`}>
            {BUCKET_LABEL[bucket]}
          </span>
          {fit.headroomGb >= 0 ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              +{fit.headroomGb.toFixed(1)} GB free
            </span>
          ) : (
            <span className="text-xs text-red-600 dark:text-red-400">
              −{Math.abs(fit.headroomGb).toFixed(1)} GB short
            </span>
          )}
        </div>

        {/* Engine + download ETA */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {pickedEngine && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ENGINE_BADGE[pickedEngine.engine]}`}>
              {pickedEngine.engine} {pickedEngine.meetsVramMin ? "✓" : "✗"}
            </span>
          )}
          {showBetterEngine && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Better: {topEngine!.engine}
            </span>
          )}
          {downloadEtaMin !== null ? (
            <span className="text-muted-foreground">
              ~{Math.ceil(downloadEtaMin)} min download
              {offer.download_mbps !== null && (
                <span className="text-muted-foreground/50"> · {fmtSpeed(offer.download_mbps)}</span>
              )}
            </span>
          ) : offer.download_mbps === null ? (
            <span className="italic text-muted-foreground/50">Speed unknown</span>
          ) : null}
        </div>

        {/* Compat chips */}
        {!isNaN(offerId) && modelKey && quant && (
          <CompatChips
            offerId={offerId}
            modelKey={modelKey}
            quant={quant}
            engine={engine}
          />
        )}

        {/* Disk */}
        {diskOk ? (
          diskHeadroomGb !== null ? (
            <p className="text-xs text-muted-foreground">
              Disk OK ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {Math.floor(diskHeadroomGb)} GB free
              </span>
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground/50">Disk size unknown</p>
          )
        ) : (
          <p className="text-xs text-rose-600 dark:text-rose-400">
            Disk: need{" "}
            {diskHeadroomGb !== null
              ? `${Math.ceil(Math.abs(diskHeadroomGb))} GB more`
              : "more space"}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border/40 pt-2">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onAdvise}>
            Advisor →
          </Button>
          <div className="ml-auto">
            <Button size="sm" className="text-xs" onClick={onRent}>
              Rent
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
