"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  useCloreBalance, useCloreOffers, useRefreshCloreOffers, useRentals, useServers,
  useTerminateRental, useCreateSession,
} from "@/lib/queries";
import type { CloreOffer, CloreOfferGroup, CloreRental, Server } from "@/lib/types";
import { cloreBillingLabels, fmtCloreAmount } from "@/lib/clore-billing";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CacheStatusBar } from "@/components/clore/CacheStatusBar";
import { OfferCard, fmtSpeed } from "@/components/clore/OfferCard";
import { RentDialog } from "@/components/clore/RentDialog";
import { RegisterRentalForm } from "@/components/clore/RegisterRentalForm";
import { CloreAccountSummary } from "@/components/clore/CloreAccountSummary";
import { PageHeader } from "@/components/layouts/page-header";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

const ModelAdvisorSheet = dynamic(
  () => import("@/components/advisor/ModelAdvisorSheet").then((m) => m.ModelAdvisorSheet),
  { ssr: false },
);

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "marketplace" | "gpu-groups" | "rentals";

const TAB_LABELS: Record<Tab, string> = {
  marketplace: "Marketplace",
  "gpu-groups": "By GPU",
  rentals: "Rentals",
};

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  marketplace: "Filter and rent individual offers with benchmark context.",
  "gpu-groups": "Compare grouped GPUs by price bands and hardware traits.",
  rentals: "Manage active rentals, registration state, and SSH entry points.",
};

export default function ClorePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("marketplace");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "marketplace" || requested === "gpu-groups" || requested === "rentals") {
      setTab(requested);
    }
  }, []);

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    router.replace(`/clore?tab=${nextTab}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clore.ai"
        description={TAB_DESCRIPTIONS[tab]}
        actions={(
          <div className="flex flex-wrap rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
            {(["marketplace", "gpu-groups", "rentals"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => selectTab(t)}
                className={`rounded-md px-3 py-1.5 transition-colors sm:px-4 ${
                  tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      />

      {tab === "marketplace" && <MarketplaceTab />}
      {tab === "gpu-groups"  && <GpuGroupsTab />}
      {tab === "rentals"     && <RentalsTab onRentClick={() => selectTab("marketplace")} />}
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

interface Filters {
  gpu: string;
  minVram: number;
  minDisk: number;
  minPcieVersion: number;
  minPcieWidth: number;
  minUpload: number;
  minDownload: number;
}

const DEFAULT_FILTERS: Filters = {
  gpu: "", minVram: 0, minDisk: 0, minPcieVersion: 0, minPcieWidth: 0, minUpload: 0, minDownload: 0,
};

function applyFilters(offers: CloreOffer[], f: Filters): CloreOffer[] {
  return offers.filter((o) => {
    if (f.gpu && !o.gpu_name.toLowerCase().includes(f.gpu.toLowerCase())) return false;
    if (f.minVram > 0 && (o.gpu_count * o.vram_gb) < f.minVram) return false;
    if (f.minDisk > 0 && (o.disk_gb ?? 0) < f.minDisk) return false;
    if (f.minUpload > 0 && (o.upload_mbps ?? 0) < f.minUpload) return false;
    if (f.minDownload > 0 && (o.download_mbps ?? 0) < f.minDownload) return false;
    if (f.minPcieVersion > 0 && o.pcie_version) {
      if (parseFloat(o.pcie_version) < f.minPcieVersion) return false;
    }
    if (f.minPcieWidth > 0 && (o.pcie_width ?? 0) < f.minPcieWidth) return false;
    return true;
  });
}

// ── Marketplace tab ───────────────────────────────────────────────────────────

type MarketplaceSortKey = "price" | "vram" | "upload" | "download" | "disk";

const SORT_LABELS: Record<MarketplaceSortKey, string> = {
  price: "Price", vram: "VRAM", upload: "Upload", download: "Download", disk: "Disk",
};
const SORT_DEFAULT_ASC: Record<MarketplaceSortKey, boolean> = {
  price: true, vram: false, upload: false, download: false, disk: false,
};

function sortOffers(offers: CloreOffer[], key: MarketplaceSortKey, asc: boolean): CloreOffer[] {
  return [...offers].sort((a, b) => {
    let diff = 0;
    if (key === "price") diff = a.price_per_day - b.price_per_day;
    else if (key === "vram") diff = (b.gpu_count * b.vram_gb) - (a.gpu_count * a.vram_gb);
    else if (key === "upload") diff = (b.upload_mbps ?? 0) - (a.upload_mbps ?? 0);
    else if (key === "download") diff = (b.download_mbps ?? 0) - (a.download_mbps ?? 0);
    else if (key === "disk") diff = (b.disk_gb ?? 0) - (a.disk_gb ?? 0);
    return asc ? diff : -diff;
  });
}

function MarketplaceTab() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<MarketplaceSortKey>("price");
  const [sortAsc, setSortAsc] = useState(true);
  const [dialogOffer, setDialogOffer] = useState<CloreOffer | null>(null);
  const [advisorOffer, setAdvisorOffer] = useState<CloreOffer | null>(null);
  const [authPrompt, setAuthPrompt] = useState<string | null>(null);

  const { data: offersData, isLoading, error } = useCloreOffers();
  const refreshMutation = useRefreshCloreOffers();

  const offers: CloreOffer[] = useMemo(() => offersData?.offers ?? [], [offersData?.offers]);

  const filtered = useMemo(
    () => sortOffers(applyFilters(offers, filters), sortKey, sortAsc),
    [offers, filters, sortKey, sortAsc],
  );

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSort(key: MarketplaceSortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(SORT_DEFAULT_ASC[key]); }
  }

  function handleRent(offer: CloreOffer | null) {
    if (!offer) return;
    if (!offersData?.meta?.authenticated) {
      setAuthPrompt("Set your Clore API key in Settings to enable this action.");
      return;
    }
    setAuthPrompt(null);
    setDialogOffer(offer);
  }

  const hasActiveFilters =
    filters.gpu || filters.minVram > 0 || filters.minDisk > 0 ||
    filters.minPcieVersion > 0 || filters.minPcieWidth > 0 ||
    filters.minUpload > 0 || filters.minDownload > 0;

  return (
    <>
      <Card className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filters</span>
          {hasActiveFilters && (
            <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">Reset</button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <FilterField label="GPU name">
            <Input className="text-sm" placeholder="e.g. RTX 4090" value={filters.gpu}
              onChange={(e) => setFilter("gpu", e.target.value)} />
          </FilterField>
          <FilterField label="Min total VRAM (GB)">
            <NumInput value={filters.minVram} onChange={(v) => setFilter("minVram", v)} min={0} step={8} />
          </FilterField>
          <FilterField label="Min disk (GB)">
            <NumInput value={filters.minDisk} onChange={(v) => setFilter("minDisk", v)} min={0} step={100} placeholder="100" />
          </FilterField>
          <FilterField label="Min PCIe version">
            <select className="input w-full text-sm" value={filters.minPcieVersion}
              onChange={(e) => setFilter("minPcieVersion", Number(e.target.value))}>
              <option value={0}>Any</option><option value={3}>3.0+</option>
              <option value={4}>4.0+</option><option value={5}>5.0+</option>
            </select>
          </FilterField>
          <FilterField label="Min PCIe width">
            <select className="input w-full text-sm" value={filters.minPcieWidth}
              onChange={(e) => setFilter("minPcieWidth", Number(e.target.value))}>
              <option value={0}>Any</option><option value={8}>x8+</option><option value={16}>x16</option>
            </select>
          </FilterField>
          <FilterField label="Min upload (Mbps)">
            <NumInput value={filters.minUpload} onChange={(v) => setFilter("minUpload", v)} min={0} max={3000} step={100} />
          </FilterField>
          <FilterField label="Min download (Mbps)">
            <NumInput value={filters.minDownload} onChange={(v) => setFilter("minDownload", v)} min={0} max={3000} step={100} />
          </FilterField>
        </div>
        <div className="flex items-center gap-1 pt-1 border-t border-border/40">
          <span className="text-[10px] text-muted-foreground/50 mr-1 uppercase tracking-wide">Sort</span>
          {(Object.keys(SORT_LABELS) as MarketplaceSortKey[]).map((k) => (
            <button key={k} onClick={() => toggleSort(k)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${sortKey === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {SORT_LABELS[k]}{sortKey === k ? (sortAsc ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>
      </Card>

      {offersData?.meta && (
        <CacheStatusBar
          fetchedAt={offersData.meta.fetched_at}
          totalRaw={offersData.meta.total_raw}
          totalFiltered={offersData.meta.total_filtered}
          appliedFilters={offersData.meta.applied_filters}
          isRefreshing={refreshMutation.isPending}
          onRefresh={() => refreshMutation.mutate()}
        />
      )}

      {error && <ErrorState message={error.message} />}
      {isLoading && <LoadingState text="Loading offers…" />}
      {authPrompt && (
        <Card className="border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm text-amber-700 dark:text-amber-300">{authPrompt}</p>
        </Card>
      )}
      {!isLoading && !error && offers.length === 0 && (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No offers found.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Public Clore marketplace returned no available listings.</p>
        </Card>
      )}
      {!isLoading && !error && offers.length > 0 && filtered.length === 0 && (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No offers match the current filters.</p>
          <button onClick={() => setFilters(DEFAULT_FILTERS)} className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">Clear filters</button>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground/60">
          {filtered.length} offer{filtered.length !== 1 ? "s" : ""}{hasActiveFilters ? ` (${offers.length} total)` : ""}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            onRent={() => handleRent(offer)}
            onAdvise={() => setAdvisorOffer(offer)}
          />
        ))}
      </div>

      {dialogOffer && <RentDialog offer={dialogOffer} onClose={() => setDialogOffer(null)} />}

      <ModelAdvisorSheet
        offer={advisorOffer}
        open={!!advisorOffer}
        onOpenChange={(o) => { if (!o) setAdvisorOffer(null); }}
        onDeployRequested={() => { handleRent(advisorOffer); setAdvisorOffer(null); }}
      />
    </>
  );
}

// ── GPU Groups tab ────────────────────────────────────────────────────────────

type GroupSortKey = "price" | "count" | "upload" | "download";

function GpuGroupsTab() {
  const { data, isLoading, error } = useCloreOffers();
  const refreshMutation = useRefreshCloreOffers();
  const offers: CloreOffer[] = useMemo(() => data?.offers ?? [], [data?.offers]);
  const groups: CloreOfferGroup[] = useMemo(() => data?.groups ?? [], [data?.groups]);

  const offerMap = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [archFilter, setArchFilter] = useState<string | null>(null);
  const [rentDialogOffer, setRentDialogOffer] = useState<CloreOffer | null>(null);
  const [advisorOffer, setAdvisorOffer] = useState<CloreOffer | null>(null);
  const [authPrompt, setAuthPrompt] = useState<string | null>(null);

  const archOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const g of groups) {
      if (g.arch) seen.add(g.arch);
    }
    return [...seen].sort();
  }, [groups]);

  const filteredGroups = archFilter ? groups.filter((g) => g.arch === archFilter) : groups;

  function handleRent(offer: CloreOffer | null) {
    if (!offer) return;
    if (!data?.meta?.authenticated) {
      setAuthPrompt("Set your Clore API key in Settings to enable this action.");
      return;
    }
    setAuthPrompt(null);
    setRentDialogOffer(offer);
  }

  return (
    <>
      {error && <ErrorState message={error.message} />}
      {isLoading && <LoadingState text="Loading offers…" />}
      {data?.meta && (
        <CacheStatusBar
          fetchedAt={data.meta.fetched_at}
          totalRaw={data.meta.total_raw}
          totalFiltered={data.meta.total_filtered}
          appliedFilters={data.meta.applied_filters}
          isRefreshing={refreshMutation.isPending}
          onRefresh={() => refreshMutation.mutate()}
        />
      )}
      {authPrompt && (
        <Card className="border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm text-amber-700 dark:text-amber-300">{authPrompt}</p>
        </Card>
      )}

      {/* Arch filter chip rail */}
      {archOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mr-0.5">Architecture</span>
          <button
            onClick={() => setArchFilter(null)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              archFilter === null
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {archOptions.map((arch) => (
            <button
              key={arch}
              onClick={() => setArchFilter(archFilter === arch ? null : arch)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                archFilter === arch
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {arch}
            </button>
          ))}
          {!isLoading && !error && (
            <span className="ml-auto text-[10px] text-muted-foreground/50">
              {filteredGroups.length} GPU type{filteredGroups.length !== 1 ? "s" : ""} · {offers.length} offers
            </span>
          )}
        </div>
      )}

      {/* Grid with full-width drawer expand */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredGroups.map((g) => (
          <Fragment key={g.key}>
            <GpuGroupCard
              group={g}
              expanded={expandedKey === g.key}
              onToggle={() => setExpandedKey(expandedKey === g.key ? null : g.key)}
            />
            {expandedKey === g.key && (
              <GroupDrawer
                group={g}
                offerMap={offerMap}
                onRent={handleRent}
                onAdvise={(o) => setAdvisorOffer(o)}
              />
            )}
          </Fragment>
        ))}
      </div>

      {rentDialogOffer && <RentDialog offer={rentDialogOffer} onClose={() => setRentDialogOffer(null)} />}

      <ModelAdvisorSheet
        offer={advisorOffer}
        open={!!advisorOffer}
        onOpenChange={(o) => { if (!o) setAdvisorOffer(null); }}
        onDeployRequested={() => { handleRent(advisorOffer); setAdvisorOffer(null); }}
      />
    </>
  );
}

function GpuGroupCard({ group, expanded, onToggle }: {
  group: CloreOfferGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const vramLabel =
    group.vram_min_gb === group.vram_max_gb
      ? `${group.vram_min_gb} GB`
      : `${group.vram_min_gb}–${group.vram_max_gb} GB`;
  const priceMin = group.price_min_per_day.toFixed(2);
  const priceMax = group.price_max_per_day.toFixed(2);
  const priceLabel = priceMin === priceMax ? `$${priceMin}/day` : `$${priceMin}–$${priceMax}/day`;

  return (
    <Card className={`overflow-hidden transition-colors ${expanded ? "border-indigo-500/40 bg-indigo-50/5" : ""}`}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 text-left hover:bg-muted/10 transition-colors flex items-center gap-2"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold">{group.display_name}</span>
            {group.arch && (
              <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-500 dark:text-indigo-400">
                {group.arch}
              </span>
            )}
            {group.vendor && group.vendor !== "Unknown" && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{group.vendor}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {group.offer_count} offer{group.offer_count !== 1 ? "s" : ""} · {vramLabel} VRAM · {priceLabel}
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </Card>
  );
}

function GroupDrawer({ group, offerMap, onRent, onAdvise }: {
  group: CloreOfferGroup;
  offerMap: Map<string, CloreOffer>;
  onRent: (o: CloreOffer) => void;
  onAdvise: (o: CloreOffer) => void;
}) {
  const [sortKey, setSortKey] = useState<GroupSortKey>("price");
  const [sortAsc, setSortAsc] = useState(true);

  const offers = useMemo(
    () => group.offer_ids.map((id) => offerMap.get(id)).filter(Boolean) as CloreOffer[],
    [group.offer_ids, offerMap],
  );

  const sorted = useMemo(() => {
    return [...offers].sort((a, b) => {
      let diff = 0;
      if (sortKey === "price") diff = a.price_per_day - b.price_per_day;
      else if (sortKey === "count") diff = b.gpu_count - a.gpu_count;
      else if (sortKey === "upload") diff = (b.upload_mbps ?? 0) - (a.upload_mbps ?? 0);
      else if (sortKey === "download") diff = (b.download_mbps ?? 0) - (a.download_mbps ?? 0);
      return sortAsc ? diff : -diff;
    });
  }, [offers, sortKey, sortAsc]);

  function toggleSort(key: GroupSortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sortArrow = (key: GroupSortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div style={{ gridColumn: "1 / -1" }}
      className="rounded-xl border border-indigo-500/20 bg-card px-4 pb-4 pt-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground/70">{group.display_name} — {sorted.length} offers</span>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mr-1">Sort:</span>
          {(["price", "count", "upload", "download"] as GroupSortKey[]).map((k) => (
            <button key={k} onClick={() => toggleSort(k)}
              className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${
                sortKey === k ? "bg-muted text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}>
              {k === "price" ? "Price" : k === "count" ? "GPUs" : k === "upload" ? "Upload" : "Download"}{sortArrow(k)}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 && <p className="text-xs text-muted-foreground/60">No offers available.</p>}
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((o) => (
          <div key={o.id}
            className="flex items-center gap-3 rounded-lg bg-muted/30 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => onAdvise(o)}
          >
            <div className="flex-1 min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {o.gpu_count > 1 && <span className="text-muted-foreground">×{o.gpu_count}</span>}
              {o.cuda_version && <span className="text-muted-foreground/60">CUDA {o.cuda_version}</span>}
              {o.pcie_version && (
                <span className={parseFloat(o.pcie_version) >= 4 ? "text-emerald-600 dark:text-emerald-500" : "text-yellow-600 dark:text-yellow-500"}>
                  PCIe {o.pcie_version}{o.pcie_width ? ` x${o.pcie_width}` : ""}
                </span>
              )}
              {(o.upload_mbps != null || o.download_mbps != null) && (
                <span className="text-muted-foreground/60">↑{fmtSpeed(o.upload_mbps)} ↓{fmtSpeed(o.download_mbps)}</span>
              )}
              {o.disk_gb != null && <span className="text-muted-foreground/60">{o.disk_gb} GB</span>}
            </div>
            <p className="text-sm font-semibold shrink-0">
              ${o.price_per_day.toFixed(2)}<span className="text-xs text-muted-foreground">/day</span>
            </p>
            <Button size="sm" className="shrink-0" onClick={(e) => { e.stopPropagation(); onRent(o); }}>Rent</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Rentals tab ───────────────────────────────────────────────────────────────

function fmtDuration(rentedAt: string | null): string {
  if (!rentedAt) return "";
  const ms = Date.now() - new Date(rentedAt).getTime();
  if (ms < 0) return "";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function RentalsTab({ onRentClick }: { onRentClick: () => void }) {
  const router = useRouter();
  const { data: rentalsData, isLoading, error } = useRentals();
  const { data: serversData } = useServers(0, 100);
  const { data: balanceData } = useCloreBalance();
  const rentals: CloreRental[] = useMemo(() => rentalsData?.rentals ?? [], [rentalsData?.rentals]);
  const servers: Server[] = useMemo(() => serversData?.items ?? [], [serversData?.items]);

  const terminateRental = useTerminateRental();
  const createSession = useCreateSession();

  const [startingSSH, setStartingSSH] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<CloreRental | null>(null);

  const serverByExtId = useMemo(
    () => new Map(servers.map((s) => [s.external_server_id, s])),
    [servers],
  );

  const registeredRentalCount = useMemo(
    () => rentals.filter((r) => serverByExtId.has(r.id)).length,
    [rentals, serverByExtId],
  );

  function handleTerminate(id: string) {
    const target = rentals.find((r) => r.id === id) ?? null;
    setTerminateTarget(target);
  }

  async function handleStartSSH(serverId: string) {
    setStartingSSH(serverId);
    try {
      const session = await createSession.mutateAsync({ server_id: serverId });
      sessionStorage.setItem("lab_session_id", session.id);
      router.push("/lab");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to start SSH session");
      setStartingSSH(null);
    }
  }

  return (
    <>
      {error && <ErrorState message={error.message} />}
      {isLoading && <LoadingState text="Loading rentals…" />}

      {!isLoading && !error && (
        <CloreAccountSummary
          balance={balanceData}
          rentals={rentals}
          registeredCount={registeredRentalCount}
          onRentClick={onRentClick}
        />
      )}

      {!isLoading && !error && rentals.length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div>
            <p className="text-sm font-medium">No active Clore rentals</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Choose a GPU offer, rent it, then register SSH access here.</p>
          </div>
          <Button onClick={onRentClick}>Rent GPU</Button>
        </Card>
      )}

      <div className="space-y-2">
        {rentals.map((r) => {
          const server = serverByExtId.get(r.id);
          const isRegistering = registeringId === r.id;
          const billing = cloreBillingLabels(r);
          const durationLabel = fmtDuration(r.rented_at);
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex items-center gap-4 px-4 py-3">
                <StatusBadge status={r.status.toUpperCase()} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{r.gpu_name}</p>
                    {!server && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/60">not registered</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 text-xs text-muted-foreground">
                    <span>{r.hostname}:{r.ssh_port}</span>
                    <span>{r.ssh_username}</span>
                    {r.vram_gb > 0 && <span>{r.vram_gb} GB VRAM</span>}
                    {r.cuda_version && <span>CUDA {r.cuda_version}</span>}
                    {billing.rate && <span className="text-foreground/70 font-medium">{billing.rate}</span>}
                    {r.creation_fee != null && (
                      <span className="text-muted-foreground/70">fee {fmtCloreAmount(r.creation_fee, r.currency)}</span>
                    )}
                    {durationLabel && <span className="text-muted-foreground/70">up {durationLabel}</span>}
                    {billing.cost && <span className="text-amber-600 dark:text-amber-400">{billing.cost}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {server ? (
                    <Button variant="outline" size="sm" loading={startingSSH === server.id}
                      onClick={() => handleStartSSH(server.id)}>
                      Start SSH
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm"
                      onClick={() => setRegisteringId(isRegistering ? null : r.id)}>
                      {isRegistering ? "Cancel" : "Register"}
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" loading={terminateRental.isPending}
                    onClick={() => handleTerminate(r.id)}>
                    End Rental
                  </Button>
                </div>
              </div>
              {isRegistering && (
                <RegisterRentalForm
                  rental={r}
                  onSuccess={() => setRegisteringId(null)}
                  onCancel={() => setRegisteringId(null)}
                />
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmActionDialog
        open={!!terminateTarget}
        onOpenChange={(open) => {
          if (!open) setTerminateTarget(null);
        }}
        title={terminateTarget ? `End rental on ${terminateTarget.gpu_name}?` : "End rental?"}
        description="This stops the Clore.ai rental and billing for this machine. The local server record will be marked inactive."
        confirmLabel="End Rental"
        onConfirm={() => {
          if (!terminateTarget) return;
          terminateRental.mutate(terminateTarget.id, {
            onError: (e) => toast.error(e.message),
            onSettled: () => setTerminateTarget(null),
          });
        }}
      />
    </>
  );
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min = 0, max, step = 1, placeholder }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; placeholder?: string;
}) {
  function parse(value: string): number {
    const numeric = Number(value) || 0;
    return Math.max(min, max == null ? numeric : Math.min(max, numeric));
  }

  return (
    <Input type="number" className="text-sm" value={value || ""} min={min} max={max} step={step}
      placeholder={placeholder ?? "0 = any"}
      onChange={(e) => onChange(parse(e.target.value))} />
  );
}
