"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { useCloreOffers, useRefreshCloreOffers } from "@/lib/queries";
import { useCatalogue } from "@/lib/models/catalogue";
import {
  rankOffersForConfig,
  type FinderConfig,
  type RankedBucket,
  type RankedOffer,
} from "@/lib/gpu-finder";
import type { CloreOffer, CloreOfferGroup } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { RentDialog } from "@/components/clore/RentDialog";
import {
  GpuFinderForm,
  defaultFormState,
  loadFromLocalStorage,
  type GpuFinderFormState,
} from "./GpuFinderForm";
import { GpuFinderResult } from "./GpuFinderResult";
import { GpuGroupCard, GpuGroupDrawer } from "./GpuGroupCard";

const ModelAdvisorSheet = dynamic(
  () => import("@/components/advisor/ModelAdvisorSheet").then((m) => m.ModelAdvisorSheet),
  { ssr: false },
);

type BucketChip = RankedBucket | null;
type ViewMode = "grouped" | "list";

const VIEW_MODE_KEY = "gpu-finder:view-mode:v1";

function loadViewMode(): ViewMode {
  if (typeof window === "undefined") return "grouped";
  return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "grouped";
}

export function GpuFinderPanel() {
  const { data: catalogue, isLoading: loadingCatalogue } = useCatalogue();
  const { data: offersData, isLoading: loadingOffers } = useCloreOffers();
  const refreshMutation = useRefreshCloreOffers();
  const offers = offersData?.offers;
  const groups = offersData?.groups ?? [];
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
  const [visibleCount, setVisibleCount] = useState(20);
  const [visibleGroupCount, setVisibleGroupCount] = useState(15);
  const [sortKey, setSortKey] = useState<"rank" | "price_asc" | "price_desc">("rank");
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [rentTarget, setRentTarget] = useState<CloreOffer | null>(null);
  const [advisorOffer, setAdvisorOffer] = useState<CloreOffer | null>(null);
  const [advisorOpen, setAdvisorOpen] = useState(false);

  function switchViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

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

  const baseRanked: RankedOffer[] = bucketFilter
    ? rankResult?.ranked.filter((r) => r.bucket === bucketFilter) ?? []
    : rankResult?.ranked ?? [];

  const filteredRanked: RankedOffer[] = useMemo(() => {
    if (sortKey === "rank") return baseRanked;
    return [...baseRanked].sort((a, b) =>
      sortKey === "price_asc"
        ? a.offer.price_per_day - b.offer.price_per_day
        : b.offer.price_per_day - a.offer.price_per_day,
    );
  }, [baseRanked, sortKey]);

  const displayedRanked = filteredRanked.slice(0, visibleCount);
  const hasMore = filteredRanked.length > visibleCount;

  // Build offer-id → group-key map for fast lookup
  const offerIdToGroupKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      for (const id of g.offer_ids) {
        map.set(id, g.key);
      }
    }
    return map;
  }, [groups]);

  // Group the sorted ranked offers (preserves sort order for group ordering)
  const groupedRanked = useMemo(() => {
    if (!groups.length || !rankResult) return [];
    const groupByKey = new Map<string, CloreOfferGroup>(groups.map((g) => [g.key, g]));
    const byKey = new Map<string, RankedOffer[]>();
    const order: string[] = [];

    for (const ro of filteredRanked) {
      const groupKey = offerIdToGroupKey.get(ro.offer.id);
      if (!groupKey) continue; // mixed / unrecognised rigs — list mode only
      if (!byKey.has(groupKey)) {
        byKey.set(groupKey, []);
        order.push(groupKey);
      }
      byKey.get(groupKey)!.push(ro);
    }

    return order
      .map((key) => ({ group: groupByKey.get(key)!, offers: byKey.get(key)! }))
      .filter(({ group }) => !!group);
  }, [groups, filteredRanked, offerIdToGroupKey, rankResult]);

  const displayedGroups = groupedRanked.slice(0, visibleGroupCount);
  const hasMoreGroups = groupedRanked.length > visibleGroupCount;

  // Reset pagination + expand state when the result set changes (new model/quant/filter)
  useEffect(() => {
    setVisibleCount(20);
    setVisibleGroupCount(15);
    setExpandedGroupKey(null);
  }, [rankResult, bucketFilter]);

  function openRent(offer: CloreOffer) {
    setRentTarget(offer);
  }

  function openAdvisor(offer: CloreOffer) {
    setAdvisorOffer(offer);
    setAdvisorOpen(true);
  }

  const updatedAt = offersData?.meta?.fetched_at
    ? new Date(offersData.meta.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
            {offersData?.meta && offersData.meta.total_filtered < offersData.meta.total_raw && (
              <span className="text-[10px] text-muted-foreground/50">
                {offersData.meta.total_filtered}/{offersData.meta.total_raw} passed quality bar
              </span>
            )}
            {viewMode === "grouped" && groupedRanked.length > 0 && (
              <span className="text-[10px] text-muted-foreground/50">
                {groupedRanked.length} types / {filteredRanked.length} offers
              </span>
            )}
            <div className="flex items-center gap-1 border-l border-border pl-2">
              {(["rank", "price_asc", "price_desc"] as const).map((k) => (
                <button key={k} onClick={() => setSortKey(k)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${sortKey === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {k === "rank" ? "Rank" : k === "price_asc" ? "Price ↑" : "Price ↓"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 border-l border-border pl-2">
              {(["grouped", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => switchViewMode(mode)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${viewMode === mode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {mode === "grouped" ? "Grouped" : "List"}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              disabled={loadingOffers || refreshMutation.isPending}
              onClick={() => refreshMutation.mutate()}
            >
              <RefreshCw className={`size-3 ${loadingOffers || refreshMutation.isPending ? "animate-spin" : ""}`} />
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

        {/* ── Grouped results ── */}
        {viewMode === "grouped" && groupedRanked.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {displayedGroups.map(({ group, offers: groupOffers }) => (
                <Fragment key={group.key}>
                  <GpuGroupCard
                    group={group}
                    offers={groupOffers}
                    expanded={expandedGroupKey === group.key}
                    onToggle={() => setExpandedGroupKey(expandedGroupKey === group.key ? null : group.key)}
                  />
                  {expandedGroupKey === group.key && (
                    <GpuGroupDrawer
                      group={group}
                      offers={groupOffers}
                      modelKey={selectedModel?.id ?? ""}
                      quant={selectedQuant?.name ?? ""}
                      onRent={openRent}
                      onAdvise={openAdvisor}
                    />
                  )}
                </Fragment>
              ))}
            </div>
            {hasMoreGroups && (
              <button
                onClick={() => setVisibleGroupCount((c) => c + 15)}
                className="w-full rounded-xl border border-border py-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Show {Math.min(15, groupedRanked.length - visibleGroupCount)} more GPU types
                <span className="ml-1 text-muted-foreground/50">
                  ({groupedRanked.length - visibleGroupCount} remaining)
                </span>
              </button>
            )}
          </>
        )}

        {/* ── Grouped empty: offers exist but none could be grouped (all mixed/unrecognised) ── */}
        {viewMode === "grouped" && rankResult && displayedRanked.length > 0 && groupedRanked.length === 0 && (
          <EmptyState
            title="No GPU groups to show"
            body="GPU names could not be parsed. Switch to List view to see all offers."
          />
        )}

        {/* ── List results ── */}
        {viewMode === "list" && displayedRanked.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            {hasMore && (
              <button
                onClick={() => setVisibleCount((c) => c + 20)}
                className="w-full rounded-xl border border-border py-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Show {Math.min(20, filteredRanked.length - visibleCount)} more
                <span className="ml-1 text-muted-foreground/50">
                  ({filteredRanked.length - visibleCount} remaining)
                </span>
              </button>
            )}
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
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 opacity-60">
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
