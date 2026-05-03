"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { useCloreOffers } from "@/lib/queries";
import { useCatalogue } from "@/lib/models/catalogue";
import {
  rankOffersForConfig,
  type FinderConfig,
  type RankedBucket,
  type RankedOffer,
} from "@/lib/gpu-finder";
import type { CloreOffer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { RentDialog } from "@/components/clore/RentDialog";
import {
  GpuFinderForm,
  defaultFormState,
  loadFromLocalStorage,
  type GpuFinderFormState,
} from "./GpuFinderForm";
import { GpuFinderResult } from "./GpuFinderResult";

const ModelAdvisorSheet = dynamic(
  () => import("@/components/advisor/ModelAdvisorSheet").then((m) => m.ModelAdvisorSheet),
  { ssr: false },
);

type BucketChip = RankedBucket | null;

export function GpuFinderPanel() {
  const { data: catalogue, isLoading: loadingCatalogue } = useCatalogue();
  const { data: offersData, isLoading: loadingOffers, refetch, dataUpdatedAt } = useCloreOffers();
  const offers = offersData?.offers;
  const models = catalogue?.models ?? [];

  const [formState, setFormState] = useState<GpuFinderFormState>(() => ({
    modelId: "",
    quantName: "",
    engine: "vllm",
    contextK: 8,
    batch: 4,
    kvDtype: "fp16",
    useCase: "chat",
    concurrency: 1,
    minDiskGb: "",
    minDownloadMbps: "",
  }));
  const [formReady, setFormReady] = useState(false);
  const [bucketFilter, setBucketFilter] = useState<BucketChip>(null);
  const [showUnfit, setShowUnfit] = useState(false);
  const [rentTarget, setRentTarget] = useState<CloreOffer | null>(null);
  const [advisorOffer, setAdvisorOffer] = useState<CloreOffer | null>(null);
  const [advisorOpen, setAdvisorOpen] = useState(false);

  // Initialise form once catalogue is available
  useEffect(() => {
    if (!models.length || formReady) return;
    const saved = loadFromLocalStorage(models);
    setFormState(saved ?? defaultFormState(models));
    setFormReady(true);
  }, [models, formReady]);

  // Escape key collapses unfit section
  useEffect(() => {
    if (!showUnfit) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowUnfit(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showUnfit]);

  const selectedModel = models.find((m) => m.id === formState.modelId) ?? models[0];
  const selectedQuant =
    selectedModel?.quants.find((q) => q.name === formState.quantName) ??
    selectedModel?.quants.slice().sort((a, b) => b.quality_score - a.quality_score)[0];

  const rankResult = useMemo(() => {
    if (!offers?.length || !selectedModel || !selectedQuant || !formReady) return null;
    const config: FinderConfig = {
      contextK: formState.contextK,
      batch: formState.batch,
      kvDtype: formState.kvDtype,
      useCase: formState.useCase,
      concurrency: formState.concurrency,
      ...(formState.minDiskGb ? { minDiskGb: parseFloat(formState.minDiskGb) } : {}),
      ...(formState.minDownloadMbps ? { minDownloadMbps: parseFloat(formState.minDownloadMbps) } : {}),
    };
    return rankOffersForConfig(offers, selectedModel, selectedQuant, formState.engine, config);
  }, [offers, selectedModel, selectedQuant, formState, formReady]);

  const comfortableCount = rankResult?.ranked.filter((r) => r.bucket === "comfortable").length ?? 0;
  const okCount          = rankResult?.ranked.filter((r) => r.bucket === "ok").length ?? 0;
  const tightCount       = rankResult?.ranked.filter((r) => r.bucket === "tight").length ?? 0;

  const displayedRanked: RankedOffer[] = bucketFilter
    ? rankResult?.ranked.filter((r) => r.bucket === bucketFilter) ?? []
    : rankResult?.ranked ?? [];

  function openRent(offer: CloreOffer) {
    setRentTarget(offer);
  }

  function openAdvisor(offer: CloreOffer) {
    setAdvisorOffer(offer);
    setAdvisorOpen(true);
  }

  const updatedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* ── Left: requirements form ───────────────────────────────────── */}
      <div className="shrink-0 lg:w-72 xl:w-80">
        <div className="sticky top-4 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">Requirements</h2>
          {loadingCatalogue ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : (
            <GpuFinderForm models={models} state={formState} onChange={setFormState} />
          )}
        </div>
      </div>

      {/* ── Right: results ────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Toolbar: chips + refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bucket filter chips */}
          {rankResult && (
            <>
              <button
                onClick={() => setBucketFilter(null)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  bucketFilter === null
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                All {rankResult.ranked.length}
              </button>
              {comfortableCount > 0 && (
                <button
                  onClick={() => setBucketFilter(bucketFilter === "comfortable" ? null : "comfortable")}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    bucketFilter === "comfortable"
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-border text-emerald-600 dark:text-emerald-400 hover:bg-muted"
                  }`}
                >
                  Comfortable {comfortableCount}
                </button>
              )}
              {okCount > 0 && (
                <button
                  onClick={() => setBucketFilter(bucketFilter === "ok" ? null : "ok")}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    bucketFilter === "ok"
                      ? "border-yellow-600 bg-yellow-600 text-white"
                      : "border-border text-yellow-600 dark:text-yellow-400 hover:bg-muted"
                  }`}
                >
                  OK {okCount}
                </button>
              )}
              {tightCount > 0 && (
                <button
                  onClick={() => setBucketFilter(bucketFilter === "tight" ? null : "tight")}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    bucketFilter === "tight"
                      ? "border-orange-600 bg-orange-600 text-white"
                      : "border-border text-orange-600 dark:text-orange-400 hover:bg-muted"
                  }`}
                >
                  Tight {tightCount}
                </button>
              )}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {updatedAt && (
              <span className="text-[10px] text-muted-foreground/50">Updated {updatedAt}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              disabled={loadingOffers}
              onClick={() => refetch()}
            >
              <RefreshCw className={`size-3 ${loadingOffers ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Loading state ── */}
        {(loadingOffers || loadingCatalogue) && !rankResult && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {/* ── Empty: no offers fetched yet ── */}
        {!loadingOffers && !loadingCatalogue && !offers?.length && (
          <EmptyState
            title="No marketplace data"
            body="Could not load Clore.ai offers. Check your API key in Settings."
          />
        )}

        {/* ── Empty: no offers pass config ── */}
        {rankResult && rankResult.totalEvaluated === 0 && (
          <EmptyState
            title="No offers passed your filters"
            body="Try loosening the min disk or min download requirements."
          />
        )}

        {/* ── Empty: all filtered by bucket chips ── */}
        {rankResult && rankResult.ranked.length > 0 && displayedRanked.length === 0 && bucketFilter && (
          <EmptyState
            title={`No ${bucketFilter} offers`}
            body="Remove the filter to see all ranked offers."
          />
        )}

        {/* ── Empty: catalogue loaded but no ranked results ── */}
        {rankResult && rankResult.ranked.length === 0 && rankResult.unfit.length > 0 && !bucketFilter && (
          <EmptyState
            title="No GPU fits your config"
            body={`All ${rankResult.unfit.length} offers are out of memory for this model and quantization. Try a smaller quant or shorter context.`}
          />
        )}

        {/* ── Ranked results ── */}
        {displayedRanked.length > 0 && (
          <div className="space-y-3">
            {displayedRanked.map((r) => (
              <GpuFinderResult
                key={r.offer.id}
                rankedOffer={r}
                modelKey={selectedModel?.id ?? ""}
                quant={selectedQuant?.name ?? ""}
                onRent={() => openRent(r.offer)}
                onAdvise={() => openAdvisor(r.offer)}
              />
            ))}
          </div>
        )}

        {/* ── Unfit section ── */}
        {rankResult && rankResult.unfit.length > 0 && (
          <div className="border-t border-border/40 pt-4">
            <button
              onClick={() => setShowUnfit((v) => !v)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>{showUnfit ? "▲" : "▼"}</span>
              {showUnfit
                ? `Hide ${rankResult.unfit.length} out-of-memory offers`
                : `Show ${rankResult.unfit.length} out-of-memory offers`}
              {showUnfit && (
                <span className="ml-2 text-[10px] text-muted-foreground/50">(Esc to close)</span>
              )}
            </button>

            {showUnfit && (
              <div className="mt-3 space-y-3 opacity-60">
                {rankResult.unfit.map((r) => (
                  <GpuFinderResult
                    key={r.offer.id}
                    rankedOffer={r}
                    modelKey={selectedModel?.id ?? ""}
                    quant={selectedQuant?.name ?? ""}
                    onRent={() => openRent(r.offer)}
                    onAdvise={() => openAdvisor(r.offer)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Overlays ──────────────────────────────────────────────────── */}
      {rentTarget && <RentDialog offer={rentTarget} onClose={() => setRentTarget(null)} />}
      <ModelAdvisorSheet
        offer={advisorOffer}
        open={advisorOpen}
        onOpenChange={setAdvisorOpen}
        onDeployRequested={() => {
          setAdvisorOpen(false);
          if (advisorOffer) setRentTarget(advisorOffer);
        }}
      />
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground/70">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
