"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  useCloreOffers, useRefreshCloreOffers, useRentals, useServers, useBenchmarks,
  useTerminateRental, useCreateSession,
} from "@/lib/queries";
import type { CloreOffer, CloreRental, InferenceBenchmark, Server } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CacheStatusBar } from "@/components/clore/CacheStatusBar";
import { OfferCard, fmtSpeed } from "@/components/clore/OfferCard";
import { RentDialog } from "@/components/clore/RentDialog";
import { RegisterRentalForm } from "@/components/clore/RegisterRentalForm";
import { PageHeader } from "@/components/layouts/page-header";
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
  const [tab, setTab] = useState<Tab>("marketplace");

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
                onClick={() => setTab(t)}
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
      {tab === "rentals"     && <RentalsTab />}
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────
// These are session-level refinements applied client-side on top of the
// globally-filtered data returned by the backend cache.

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
    if (f.minVram > 0 && o.vram_gb < f.minVram) return false;
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

type BenchmarkMap = Record<string, InferenceBenchmark[]>;
type MarketplaceSortKey = "price" | "vram" | "upload" | "disk";

const SORT_LABELS: Record<MarketplaceSortKey, string> = {
  price: "Price", vram: "VRAM", upload: "Upload", disk: "Disk",
};
const SORT_DEFAULT_ASC: Record<MarketplaceSortKey, boolean> = {
  price: true, vram: false, upload: false, disk: false,
};

function sortOffers(offers: CloreOffer[], key: MarketplaceSortKey, asc: boolean): CloreOffer[] {
  return [...offers].sort((a, b) => {
    let diff = 0;
    if (key === "price") diff = a.price_per_day - b.price_per_day;
    else if (key === "vram") diff = b.vram_gb - a.vram_gb;
    else if (key === "upload") diff = (b.upload_mbps ?? 0) - (a.upload_mbps ?? 0);
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

  const { data: offersData, isLoading, error } = useCloreOffers();
  const refreshMutation = useRefreshCloreOffers();
  const { data: benchData } = useBenchmarks(undefined, undefined, 200);

  const offers: CloreOffer[] = offersData?.offers ?? [];

  const benchmarkMap = useMemo<BenchmarkMap>(() => {
    const map: BenchmarkMap = {};
    for (const b of benchData?.items ?? []) {
      (map[b.gpu_model] ??= []).push(b);
    }
    return map;
  }, [benchData]);

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
          <FilterField label="Min VRAM (GB)">
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
            <NumInput value={filters.minUpload} onChange={(v) => setFilter("minUpload", v)} min={0} step={100} />
          </FilterField>
          <FilterField label="Min download (Mbps)">
            <NumInput value={filters.minDownload} onChange={(v) => setFilter("minDownload", v)} min={0} step={100} />
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

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}
      {isLoading && <Spinner text="Loading offers…" />}
      {!isLoading && !error && offers.length === 0 && (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No offers found.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Check that the Clore API key is configured in Settings.</p>
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

      <div className="space-y-2">
        {filtered.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            benchmarks={benchmarkMap[offer.gpu_name] ?? []}
            onRent={() => setDialogOffer(offer)}
            onAdvise={() => setAdvisorOffer(offer)}
          />
        ))}
      </div>

      {dialogOffer && <RentDialog offer={dialogOffer} onClose={() => setDialogOffer(null)} />}

      <ModelAdvisorSheet
        offer={advisorOffer}
        open={!!advisorOffer}
        onOpenChange={(o) => { if (!o) setAdvisorOffer(null); }}
        onDeployRequested={() => { setDialogOffer(advisorOffer); setAdvisorOffer(null); }}
      />
    </>
  );
}

// ── GPU Groups tab ────────────────────────────────────────────────────────────

interface GpuGroup {
  key: string; gpu_name: string; vram_gb: number;
  count: number; min_price: number; max_price: number; offers: CloreOffer[];
}

type GroupSortKey = "price" | "count" | "vram" | "upload";

function buildGroups(offers: CloreOffer[]): GpuGroup[] {
  const map = new Map<string, GpuGroup>();
  for (const o of offers) {
    const key = `${o.gpu_name}__${o.vram_gb}`;
    const g = map.get(key);
    if (g) {
      g.count++; g.offers.push(o);
      if (o.price_per_day < g.min_price) g.min_price = o.price_per_day;
      if (o.price_per_day > g.max_price) g.max_price = o.price_per_day;
    } else {
      map.set(key, { key, gpu_name: o.gpu_name, vram_gb: o.vram_gb, count: 1, min_price: o.price_per_day, max_price: o.price_per_day, offers: [o] });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.vram_gb - a.vram_gb || a.min_price - b.min_price);
}

function GpuGroupsTab() {
  const { data, isLoading, error } = useCloreOffers();
  const refreshMutation = useRefreshCloreOffers();
  const offers: CloreOffer[] = data?.offers ?? [];
  const groups = useMemo(() => buildGroups(offers), [offers]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [rentDialogOffer, setRentDialogOffer] = useState<CloreOffer | null>(null);
  const [advisorOffer, setAdvisorOffer] = useState<CloreOffer | null>(null);

  return (
    <>
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}
      {isLoading && <Spinner text="Loading offers…" />}
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
      {!isLoading && !error && (
        <p className="text-xs text-muted-foreground/60">{groups.length} GPU models across {offers.length} offers</p>
      )}

      <div className="space-y-2">
        {groups.map((g) => (
          <GpuGroupCard
            key={g.key}
            group={g}
            expanded={expandedKey === g.key}
            onToggle={() => setExpandedKey(expandedKey === g.key ? null : g.key)}
            onRent={(o) => setRentDialogOffer(o)}
            onAdvise={(o) => setAdvisorOffer(o)}
          />
        ))}
      </div>

      {rentDialogOffer && <RentDialog offer={rentDialogOffer} onClose={() => setRentDialogOffer(null)} />}

      <ModelAdvisorSheet
        offer={advisorOffer}
        open={!!advisorOffer}
        onOpenChange={(o) => { if (!o) setAdvisorOffer(null); }}
        onDeployRequested={() => { setRentDialogOffer(advisorOffer); setAdvisorOffer(null); }}
      />
    </>
  );
}

function GpuGroupCard({ group, expanded, onToggle, onRent, onAdvise }: {
  group: GpuGroup; expanded: boolean; onToggle: () => void;
  onRent: (o: CloreOffer) => void; onAdvise: (o: CloreOffer) => void;
}) {
  const [sortKey, setSortKey] = useState<GroupSortKey>("price");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterCuda, setFilterCuda] = useState("");
  const [filterMinGpuCount, setFilterMinGpuCount] = useState(0);
  const [filterMinPcie, setFilterMinPcie] = useState(3);
  const [filterMinPcieWidth, setFilterMinPcieWidth] = useState(8);

  const cudaOptions = useMemo(() => {
    const set = new Set(group.offers.map((o) => o.cuda_version).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [group.offers]);

  const sorted = useMemo(() => {
    let list = group.offers.filter((o) => {
      if (filterCuda && o.cuda_version !== filterCuda) return false;
      if (filterMinGpuCount > 0 && o.gpu_count < filterMinGpuCount) return false;
      if (filterMinPcie > 0) {
        const ver = o.pcie_version ? parseFloat(o.pcie_version) : 0;
        if (ver < filterMinPcie) return false;
      }
      if (filterMinPcieWidth > 0 && (o.pcie_width ?? 0) < filterMinPcieWidth) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let diff = 0;
      if (sortKey === "price") diff = a.price_per_day - b.price_per_day;
      else if (sortKey === "count") diff = b.gpu_count - a.gpu_count;
      else if (sortKey === "vram") diff = b.vram_gb - a.vram_gb;
      else if (sortKey === "upload") diff = (b.upload_mbps ?? 0) - (a.upload_mbps ?? 0);
      return sortAsc ? diff : -diff;
    });
    return list;
  }, [group.offers, sortKey, sortAsc, filterCuda, filterMinGpuCount, filterMinPcie, filterMinPcieWidth]);

  function toggleSort(key: GroupSortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sortArrow = (key: GroupSortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 hover:bg-muted/10 transition-colors">
        <button
          onClick={() => onAdvise(group.offers[0])}
          className="flex flex-1 min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open model advisor for ${group.gpu_name}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">{group.gpu_name}</p>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-indigo-400">{group.vram_gb} GB VRAM</span>
              <span className="text-[10px] text-indigo-400/60">Model Advisor →</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {group.count} offer{group.count !== 1 ? "s" : ""} · ${group.min_price.toFixed(2)}
              {group.max_price !== group.min_price && `–$${group.max_price.toFixed(2)}`}/day
            </p>
          </div>
        </button>
        <button
          onClick={onToggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Show offers"
          aria-label={`${expanded ? "Hide" : "Show"} offers for ${group.gpu_name}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 pb-4 pt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {cudaOptions.length > 0 && (
              <div className="space-y-1">
                <label className="block text-[10px] text-muted-foreground/60 uppercase tracking-wide">CUDA</label>
                <select className="input text-xs py-1 px-2" value={filterCuda} onChange={(e) => setFilterCuda(e.target.value)}>
                  <option value="">Any</option>
                  {cudaOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="block text-[10px] text-muted-foreground/60 uppercase tracking-wide">Min GPUs</label>
              <select className="input text-xs py-1 px-2" value={filterMinGpuCount} onChange={(e) => setFilterMinGpuCount(Number(e.target.value))}>
                <option value={0}>Any</option><option value={2}>2+</option><option value={4}>4+</option><option value={8}>8+</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-muted-foreground/60 uppercase tracking-wide">Min PCIe ver</label>
              <select className="input text-xs py-1 px-2" value={filterMinPcie} onChange={(e) => setFilterMinPcie(Number(e.target.value))}>
                <option value={0}>Any</option><option value={3}>3.0+</option><option value={4}>4.0+</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-muted-foreground/60 uppercase tracking-wide">Min PCIe width</label>
              <select className="input text-xs py-1 px-2" value={filterMinPcieWidth} onChange={(e) => setFilterMinPcieWidth(Number(e.target.value))}>
                <option value={0}>Any</option><option value={8}>x8+</option><option value={16}>x16</option>
              </select>
            </div>
            <div className="flex gap-1 ml-auto">
              {(["price", "count", "upload"] as GroupSortKey[]).map((k) => (
                <button key={k} onClick={() => toggleSort(k)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${sortKey === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {k === "price" ? "Price" : k === "count" ? "GPUs" : "Upload"}{sortArrow(k)}
                </button>
              ))}
            </div>
          </div>

          {sorted.length === 0 && <p className="text-xs text-muted-foreground/60">No offers match the current filters.</p>}
          <div className="space-y-1.5">
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
      )}
    </Card>
  );
}

// ── Rentals tab ───────────────────────────────────────────────────────────────

function RentalsTab() {
  const router = useRouter();
  const { data: rentalsData, isLoading, error } = useRentals();
  const { data: serversData } = useServers(0, 100);
  const rentals: CloreRental[] = rentalsData?.rentals ?? [];
  const servers: Server[] = serversData?.items ?? [];

  const terminateRental = useTerminateRental();
  const createSession = useCreateSession();

  const [startingSSH, setStartingSSH] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<CloreRental | null>(null);

  const serverByExtId = useMemo(
    () => new Map(servers.map((s) => [s.external_server_id, s])),
    [servers],
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
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}
      {isLoading && <Spinner text="Loading rentals…" />}
      {!isLoading && !error && rentals.length === 0 && (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No active rentals.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Rent a server from the Marketplace tab.</p>
        </Card>
      )}

      <div className="space-y-2">
        {rentals.map((r) => {
          const server = serverByExtId.get(r.id);
          const isRegistering = registeringId === r.id;
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
                    Terminate
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
        title={terminateTarget ? `Terminate rental on ${terminateTarget.gpu_name}?` : "Terminate rental?"}
        description="The server will be stopped and rental data will be lost."
        confirmLabel="Terminate Rental"
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

function NumInput({ value, onChange, min = 0, step = 1, placeholder }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; placeholder?: string;
}) {
  return (
    <Input type="number" className="text-sm" value={value || ""} min={min} step={step}
      placeholder={placeholder ?? "0 = any"}
      onChange={(e) => onChange(Number(e.target.value) || 0)} />
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
      {text}
    </div>
  );
}
