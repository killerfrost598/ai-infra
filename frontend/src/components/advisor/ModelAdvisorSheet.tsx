"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import type { CloreOffer } from "@/lib/types";
import type { EngineName, Model } from "@/lib/models/schema";
import {
  useCatalogue,
  filterByFamily,
  searchModels,
  uniqueFamilies,
} from "@/lib/models/catalogue";
import { bestQuantForGpu, fitStatusBg, fitStatusLabel } from "@/lib/vram";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetBody,
  SheetTitle,
} from "@/components/ui/sheet";
import { ErrorState } from "@/components/layouts/page-states";
import { Spinner } from "@/components/ui/spinner";
import { ModelFitCard } from "./ModelFitCard";
import { VramCalculator } from "./VramCalculator";
import { EngineComparison } from "./EngineComparison";

const ENGINE_BADGE: Record<EngineName, string> = {
  vllm: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  ollama: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

type SheetTab = "recommended" | "all" | "calculator";
type DetailTab = "vram" | "engines";

interface Props {
  offer: CloreOffer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeployRequested: () => void;
}

export function ModelAdvisorSheet({ offer, open, onOpenChange, onDeployRequested }: Props) {
  const { data: catalogue, isLoading, error } = useCatalogue();
  const [sheetTab, setSheetTab] = useState<SheetTab>("recommended");
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("vram");
  const [searchQuery, setSearchQuery] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");

  // Reset panel state when offer changes
  useEffect(() => {
    setSelectedModel(null);
    setSheetTab("recommended");
    setSearchQuery("");
    setFamilyFilter("");
  }, [offer?.id]);

  // ── All hooks must be called before any early return ──────────────────────
  const models = catalogue?.models ?? [];

  const families = useMemo(() => uniqueFamilies(models), [models]);

  const recommended = useMemo(() => {
    if (!offer || !models.length) return [];
    const ORDER: Record<string, number> = { COMFORTABLE: 0, OK: 1, TIGHT: 2, OOM: 3 };
    return models
      .map((m) => ({ m, r: bestQuantForGpu(m, offer.vram_gb, offer.gpu_count) }))
      .sort((a, b) => {
        const diff = (ORDER[a.r.fit.status] ?? 3) - (ORDER[b.r.fit.status] ?? 3);
        return diff !== 0 ? diff : b.m.param_count_b - a.m.param_count_b;
      })
      .filter(({ r }) => r.fit.status !== "OOM")
      .map(({ m }) => m);
  }, [models, offer?.vram_gb, offer?.gpu_count]);

  const filteredAll = useMemo(() => {
    if (!offer || !models.length) return [];
    let list = models;
    if (familyFilter) list = filterByFamily(list, familyFilter);
    if (searchQuery.trim()) list = searchModels(list, searchQuery);
    const ORDER: Record<string, number> = { COMFORTABLE: 0, OK: 1, TIGHT: 2, OOM: 3 };
    return [...list].sort((a, b) => {
      const af = bestQuantForGpu(a, offer.vram_gb, offer.gpu_count).fit.status;
      const bf = bestQuantForGpu(b, offer.vram_gb, offer.gpu_count).fit.status;
      return (ORDER[af] ?? 3) - (ORDER[bf] ?? 3);
    });
  }, [models, familyFilter, searchQuery, offer?.vram_gb, offer?.gpu_count]);

  // Safe to return early now — all hooks have been called above
  if (!offer) return null;

  const totalVram = offer.vram_gb * offer.gpu_count;

  function handleSelectModel(m: Model) {
    setSelectedModel(m);
    setDetailTab("vram");
  }

  function handleBack() {
    setSelectedModel(null);
  }

  function handleDeploy() {
    onOpenChange(false);
    onDeployRequested();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <SheetHeader>
          {selectedModel ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleBack}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                Back
              </button>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate">{selectedModel.name}</SheetTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {selectedModel.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                  <a
                    href={selectedModel.huggingface_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-indigo-400 hover:text-indigo-300"
                  >
                    <ExternalLink className="size-2.5" />
                    HuggingFace
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <>
              <SheetTitle>{offer.gpu_name} — Model Advisor</SheetTitle>
              <SheetDescription>
                {totalVram} GB VRAM
                {offer.gpu_count > 1 && ` · ${offer.gpu_count}× GPU`}
                {" · "}
                {isLoading ? "loading…" : `${recommended.length} models fit`}
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <SheetBody className="min-h-0 overflow-hidden p-0 gap-0">
          {/* Error state */}
          {error && <ErrorState message="Failed to load model catalogue. Check console for details." className="mx-6 my-4" />}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner size="md" />
              Loading catalogue…
            </div>
          )}

          {/* Detail view */}
          {!isLoading && selectedModel && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Detail tabs */}
              <div className="flex shrink-0 gap-1 border-b border-border bg-muted/20 px-6 py-3">
                <TabButton active={detailTab === "vram"} onClick={() => setDetailTab("vram")}>
                  VRAM Calculator
                </TabButton>
                <TabButton active={detailTab === "engines"} onClick={() => setDetailTab("engines")}>
                  Engine Guide
                </TabButton>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {detailTab === "vram" && (
                  <VramCalculator
                    model={selectedModel}
                    gpuVramGb={offer.vram_gb}
                    gpuCount={offer.gpu_count}
                  />
                )}
                {detailTab === "engines" && (
                  <EngineComparison
                    model={selectedModel}
                    gpuVramGb={offer.vram_gb}
                    gpuCount={offer.gpu_count}
                  />
                )}
              </div>

              {/* Deploy CTA */}
              <div className="shrink-0 border-t border-border px-6 py-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDeploy}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 active:bg-indigo-700"
                  >
                    Deploy with {selectedModel.name}
                  </button>
                  <a
                    href={selectedModel.huggingface_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="size-3" />
                    HF
                  </a>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground/50">
                  Opens the rent dialog for {offer.gpu_name}. Configure docker image and SSH access.
                </p>
              </div>
            </div>
          )}

          {/* List view */}
          {!isLoading && !selectedModel && catalogue && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Sheet tabs */}
              <div className="shrink-0 border-b border-border px-6 py-3">
                <div className="flex gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
                  {(["recommended", "all", "calculator"] as SheetTab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setSheetTab(t)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs capitalize transition-colors ${
                        sheetTab === t
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t === "recommended"
                        ? `Fits (${recommended.length})`
                        : t === "all"
                          ? `All (${models.length})`
                          : "Calculator"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* Recommended tab */}
                {sheetTab === "recommended" && (
                  <div className="space-y-1.5 px-6 py-3">
                    {recommended.length === 0 && (
                      <EmptyState message="No models fit this GPU at the default context/batch settings." />
                    )}
                    {recommended.map((m) => (
                      <ModelFitCard
                        key={m.id}
                        model={m}
                        gpuVramGb={offer.vram_gb}
                        gpuCount={offer.gpu_count}
                        onSelect={handleSelectModel}
                      />
                    ))}
                  </div>
                )}

                {/* All models tab */}
                {sheetTab === "all" && (
                  <div className="flex flex-col">
                    {/* Search + family filter */}
                    <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-3 space-y-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                        <input
                          type="text"
                          placeholder="Search models…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full rounded-md border border-border bg-muted/30 py-1.5 pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => setFamilyFilter("")}
                          className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
                            !familyFilter
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          All
                        </button>
                        {families.map((f) => (
                          <button
                            key={f}
                            onClick={() => setFamilyFilter(f === familyFilter ? "" : f)}
                            className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
                              familyFilter === f
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5 px-6 py-3">
                      {filteredAll.length === 0 && (
                        <EmptyState message="No models match your search." />
                      )}
                      {filteredAll.map((m) => (
                        <ModelFitCard
                          key={m.id}
                          model={m}
                          gpuVramGb={offer.vram_gb}
                          gpuCount={offer.gpu_count}
                          onSelect={handleSelectModel}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Calculator tab */}
                {sheetTab === "calculator" && (
                  <CalculatorTab models={models} offer={offer} onSelectModel={handleSelectModel} />
                )}
              </div>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

// ── Calculator tab ────────────────────────────────────────────────────────────

function CalculatorTab({
  models,
  offer,
  onSelectModel,
}: {
  models: Model[];
  offer: CloreOffer;
  onSelectModel: (m: Model) => void;
}) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const selected = models.find((m) => m.id === modelId) ?? models[0];

  if (!selected) return <EmptyState message="No models available." />;

  return (
    <div className="px-6 py-4 space-y-4">
      <div className="space-y-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Select model
        </span>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <VramCalculator
        model={selected}
        gpuVramGb={offer.vram_gb}
        gpuCount={offer.gpu_count}
      />

      <button
        onClick={() => onSelectModel(selected)}
        className="w-full rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        View engine guide for {selected.name} →
      </button>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
