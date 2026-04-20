"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCloreOffers, useRentals, useServers, useBenchmarks, useRentClore, useTerminateRental, useCreateServer, useCreateSession } from "@/lib/queries";
import type { CloreOffer, CloreRental, InferenceBenchmark, RentRequest, Server } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "marketplace" | "gpu-groups" | "rentals";

const TAB_LABELS: Record<Tab, string> = {
  "marketplace": "Marketplace",
  "gpu-groups": "By GPU",
  "rentals": "Rentals",
};

export default function ClorePage() {
  const [tab, setTab] = useState<Tab>("marketplace");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clore.ai</h1>
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
          {(["marketplace", "gpu-groups", "rentals"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === "marketplace" && <MarketplaceTab />}
      {tab === "gpu-groups" && <GpuGroupsTab />}
      {tab === "rentals" && <RentalsTab />}
    </div>
  );
}

// ── Filter state ───────────────────────────────────────────────────────────────

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
  gpu: "",
  minVram: 0,
  minDisk: 0,
  minPcieVersion: 3,
  minPcieWidth: 8,
  minUpload: 0,
  minDownload: 0,
};

function applyFilters(offers: CloreOffer[], f: Filters): CloreOffer[] {
  return offers.filter((o) => {
    if (f.gpu && !o.gpu_name.toLowerCase().includes(f.gpu.toLowerCase())) return false;
    if (f.minVram > 0 && o.vram_gb < f.minVram) return false;
    if (f.minDisk > 0 && (o.disk_gb ?? 0) < f.minDisk) return false;
    if (f.minUpload > 0 && (o.upload_mbps ?? 0) < f.minUpload) return false;
    if (f.minDownload > 0 && (o.download_mbps ?? 0) < f.minDownload) return false;
    if (f.minPcieVersion > 0 && o.pcie_version) {
      const ver = parseFloat(o.pcie_version);
      if (ver < f.minPcieVersion) return false;
    }
    if (f.minPcieWidth > 0 && (o.pcie_width ?? 0) < f.minPcieWidth) return false;
    return true;
  });
}

// ── Marketplace tab ────────────────────────────────────────────────────────────

type BenchmarkMap = Record<string, InferenceBenchmark[]>;

function MarketplaceTab() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [gpuSearch, setGpuSearch] = useState("");
  const [dialogOffer, setDialogOffer] = useState<CloreOffer | null>(null);

  const { data: offersData, isLoading, error, refetch } = useCloreOffers(gpuSearch || undefined);
  const { data: benchData } = useBenchmarks(undefined, undefined, 200);

  const offers: CloreOffer[] = offersData?.offers ?? [];

  const benchmarkMap = useMemo<BenchmarkMap>(() => {
    const map: BenchmarkMap = {};
    for (const b of benchData?.items ?? []) {
      (map[b.gpu_model] ??= []).push(b);
    }
    return map;
  }, [benchData]);

  const filtered = useMemo(() => applyFilters(offers, filters), [offers, filters]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
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
            <Input
              className="text-sm"
              placeholder="e.g. RTX 4090"
              value={filters.gpu}
              onChange={(e) => setFilter("gpu", e.target.value)}
            />
          </FilterField>
          <FilterField label="Min VRAM (GB)">
            <NumInput value={filters.minVram} onChange={(v) => setFilter("minVram", v)} min={0} step={8} />
          </FilterField>
          <FilterField label="Min disk (GB)">
            <NumInput value={filters.minDisk} onChange={(v) => setFilter("minDisk", v)} min={0} step={100} placeholder="100" />
          </FilterField>
          <FilterField label="Min PCIe version">
            <select className="input w-full text-sm" value={filters.minPcieVersion} onChange={(e) => setFilter("minPcieVersion", Number(e.target.value))}>
              <option value={0}>Any</option>
              <option value={3}>3.0+</option>
              <option value={4}>4.0+</option>
              <option value={5}>5.0+</option>
            </select>
          </FilterField>
          <FilterField label="Min PCIe width">
            <select className="input w-full text-sm" value={filters.minPcieWidth} onChange={(e) => setFilter("minPcieWidth", Number(e.target.value))}>
              <option value={0}>Any</option>
              <option value={8}>x8+</option>
              <option value={16}>x16</option>
            </select>
          </FilterField>
          <FilterField label="Min upload (Mbps)">
            <NumInput value={filters.minUpload} onChange={(v) => setFilter("minUpload", v)} min={0} step={100} />
          </FilterField>
          <FilterField label="Min download (Mbps)">
            <NumInput value={filters.minDownload} onChange={(v) => setFilter("minDownload", v)} min={0} step={100} />
          </FilterField>
          <div className="flex items-end">
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setGpuSearch(filters.gpu); refetch(); }}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          Loading offers…
        </div>
      )}
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
          {filtered.length} offer{filtered.length !== 1 ? "s" : ""}
          {hasActiveFilters ? ` (${offers.length} total)` : ""}
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            benchmarks={benchmarkMap[offer.gpu_name] ?? []}
            onRent={() => setDialogOffer(offer)}
          />
        ))}
      </div>

      {dialogOffer && <RentDialog offer={dialogOffer} onClose={() => setDialogOffer(null)} />}
    </>
  );
}

// ── Offer card ─────────────────────────────────────────────────────────────────

function OfferCard({ offer, benchmarks, onRent }: { offer: CloreOffer; benchmarks: InferenceBenchmark[]; onRent: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const pcieBadgeColor =
    !offer.pcie_version ? "text-muted-foreground/40" :
    parseFloat(offer.pcie_version) >= 4 ? "text-emerald-600 dark:text-emerald-500" :
    parseFloat(offer.pcie_version) >= 3 ? "text-yellow-600 dark:text-yellow-500" :
    "text-rose-600 dark:text-rose-400";

  const pcieWidthColor =
    !offer.pcie_width ? "text-muted-foreground/40" :
    offer.pcie_width >= 16 ? "text-emerald-600 dark:text-emerald-500" :
    offer.pcie_width >= 8 ? "text-yellow-600 dark:text-yellow-500" :
    "text-rose-600 dark:text-rose-400";

  return (
    <Card className="px-6 py-5 space-y-3">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{offer.gpu_name}</p>
            {offer.gpu_count > 1 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">×{offer.gpu_count}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <Chip label={`${offer.vram_gb} GB VRAM`} color="text-indigo-400" />
            {offer.cuda_version && <Chip label={`CUDA ${offer.cuda_version}`} />}
            <span className={`font-mono ${pcieBadgeColor}`}>
              PCIe {offer.pcie_version ?? "?"} {offer.pcie_width ? `x${offer.pcie_width}` : ""}
            </span>
            {offer.disk_gb != null && (
              <Chip label={`${offer.disk_gb} GB disk`} color={offer.disk_gb >= 100 ? "text-muted-foreground" : "text-rose-400"} />
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

        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((x) => !x)} title="Show full specs">
            {expanded ? "Less" : "More"}
          </Button>
          <Button size="sm" onClick={onRent}>Rent</Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            <SpecRow label="CPU" value={offer.cpu_model} />
            <SpecRow label="System RAM" value={offer.ram_gb != null ? `${offer.ram_gb} GB` : null} />
            <SpecRow label="Disk" value={offer.disk_gb != null ? `${offer.disk_gb} GB` : null} />
            <SpecRow label="PCIe version" value={offer.pcie_version} colorClass={pcieBadgeColor} />
            <SpecRow label="PCIe width" value={offer.pcie_width != null ? `x${offer.pcie_width}` : null} colorClass={pcieWidthColor} />
            <SpecRow label="Upload" value={offer.upload_mbps != null ? fmtSpeed(offer.upload_mbps) : null} />
            <SpecRow label="Download" value={offer.download_mbps != null ? fmtSpeed(offer.download_mbps) : null} />
            <SpecRow label="CUDA" value={offer.cuda_version} />
            <SpecRow label="GPU count" value={String(offer.gpu_count)} />
          </div>

          {benchmarks.length > 0 && (
            <div className="border-t border-border/60 pt-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Performance data</p>
              <div className="space-y-1.5">
                {benchmarks.slice(0, 4).map((b) => (
                  <div key={b.id} className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground truncate flex-1">{b.model_name}{b.quantization ? ` (${b.quantization})` : ""}</span>
                    {b.tokens_per_second_avg != null && (
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 shrink-0">{b.tokens_per_second_avg.toFixed(1)} t/s</span>
                    )}
                    {b.max_parallel_connections != null && (
                      <span className="text-muted-foreground/60 shrink-0">{b.max_parallel_connections} concurrent</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {benchmarks.length === 0 && (
            <div className="border-t border-border/60 pt-2 text-xs text-muted-foreground/40">No benchmarks recorded for this GPU.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function Chip({ label, color = "text-muted-foreground" }: { label: string; color?: string }) {
  return <span className={color}>{label}</span>;
}

function SpecRow({ label, value, colorClass = "text-foreground/80" }: { label: string; value: string | null | undefined; colorClass?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground/60 shrink-0">{label}</span>
      <span className={value ? colorClass : "text-muted-foreground/30 italic"}>{value ?? "unknown"}</span>
    </div>
  );
}

function fmtSpeed(mbps: number | null | undefined): string {
  if (mbps == null) return "—";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${Math.round(mbps)} Mbps`;
}

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
      placeholder={placeholder ?? "0 = any"} onChange={(e) => onChange(Number(e.target.value) || 0)} />
  );
}

// ── GPU Groups tab ─────────────────────────────────────────────────────────────

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
  const offers: CloreOffer[] = data?.offers ?? [];
  const groups = useMemo(() => buildGroups(offers), [offers]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [rentDialogOffer, setRentDialogOffer] = useState<CloreOffer | null>(null);

  return (
    <>
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          Loading offers…
        </div>
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
          />
        ))}
      </div>

      {rentDialogOffer && <RentDialog offer={rentDialogOffer} onClose={() => setRentDialogOffer(null)} />}
    </>
  );
}

function GpuGroupCard({ group, expanded, onToggle, onRent }: {
  group: GpuGroup; expanded: boolean; onToggle: () => void; onRent: (o: CloreOffer) => void;
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
      if (filterMinPcie > 0) { const ver = o.pcie_version ? parseFloat(o.pcie_version) : 0; if (ver < filterMinPcie) return false; }
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
      <button onClick={onToggle} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/20 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{group.gpu_name}</p>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-indigo-400">{group.vram_gb} GB VRAM</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {group.count} offer{group.count !== 1 ? "s" : ""} · ${group.min_price.toFixed(2)}
            {group.max_price !== group.min_price && `–$${group.max_price.toFixed(2)}`}/day
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

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
              <div key={o.id} className="flex items-center gap-3 rounded-lg bg-muted/30 px-4 py-2.5">
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
                <Button size="sm" className="shrink-0" onClick={() => onRent(o)}>Rent</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Rentals tab ────────────────────────────────────────────────────────────────

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

  const serverByExtId = useMemo(
    () => new Map(servers.map((s) => [s.external_server_id, s])),
    [servers]
  );

  function handleTerminate(id: string) {
    if (!confirm("Terminate this rental? The server will be stopped and all data lost.")) return;
    terminateRental.mutate(id, {
      onError: (e) => alert(e.message),
    });
  }

  async function handleStartSSH(serverId: string) {
    setStartingSSH(serverId);
    try {
      const session = await createSession.mutateAsync({ server_id: serverId });
      sessionStorage.setItem("lab_session_id", session.id);
      router.push("/lab");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to start SSH session");
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
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          Loading rentals…
        </div>
      )}
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
                    <Button
                      variant="outline"
                      size="sm"
                      loading={startingSSH === server.id}
                      onClick={() => handleStartSSH(server.id)}
                    >
                      Start SSH
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRegisteringId(isRegistering ? null : r.id)}
                    >
                      {isRegistering ? "Cancel" : "Register"}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    loading={terminateRental.isPending}
                    onClick={() => handleTerminate(r.id)}
                  >
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
    </>
  );
}

function RegisterRentalForm({ rental, onSuccess, onCancel }: {
  rental: CloreRental; onSuccess: () => void; onCancel: () => void;
}) {
  const createServer = useCreateServer();
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (authMode === "password" && !password) { setError("Password required"); return; }
    if (authMode === "key" && !privateKey.trim()) { setError("Private key required"); return; }
    setError(null);
    createServer.mutate(
      {
        external_server_id: rental.id,
        hostname: rental.hostname,
        ssh_port: rental.ssh_port,
        ssh_username: rental.ssh_username,
        gpu_model: rental.gpu_name || undefined,
        vram_gb: rental.vram_gb || undefined,
        ...(authMode === "password" ? { ssh_password: password } : { ssh_private_key: privateKey.trim() }),
      },
      { onSuccess, onError: (err) => setError(err.message) }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-muted/10 px-4 py-3 space-y-3">
      <p className="text-xs text-muted-foreground">Register this rental so you can start SSH sessions from this platform.</p>
      <div className="flex gap-1 rounded border border-border bg-muted/20 p-0.5 w-fit">
        {(["password", "key"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setAuthMode(m)}
            className={`rounded px-3 py-1 text-xs transition-colors ${authMode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {m === "password" ? "Password" : "Private Key"}
          </button>
        ))}
      </div>
      {authMode === "password" ? (
        <Input type="password" placeholder="SSH password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">Private key (PEM) — stored securely in the platform</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={generatingKey}
              onClick={async () => {
                setGeneratingKey(true);
                try {
                  await import("@/lib/api").then(({ api }) => api.settings.generateKeypair());
                  setError("Key pair generated — private key saved to platform settings. Note: the public key was NOT sent to this existing rental.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Generation failed");
                } finally { setGeneratingKey(false); }
              }}
            >
              {generatingKey ? "Generating…" : "Generate"}
            </Button>
          </div>
          <textarea className="input w-full text-sm font-mono resize-none" rows={4}
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
            value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={createServer.isPending}>Register Server</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// ── Rent dialog ────────────────────────────────────────────────────────────────

const PRESET_IMAGES = [
  { label: "Ubuntu 22.04 + CUDA 12 (Clore)", value: "cloreai/ubuntu22.04-cuda12" },
  { label: "Ubuntu Jupyter (Clore)", value: "cloreai/jupyter:ubuntu24.04-v2" },
  { label: "CUDA 12.8 Base — Ubuntu 22.04", value: "nvidia/cuda:12.8.0-base-ubuntu22.04" },
  { label: "CUDA 12.8 Runtime — Ubuntu 22.04", value: "nvidia/cuda:12.8.0-runtime-ubuntu22.04" },
  { label: "CUDA 12.8 Devel — Ubuntu 22.04", value: "nvidia/cuda:12.8.0-devel-ubuntu22.04" },
  { label: "CUDA 11.8 Base — Ubuntu 22.04", value: "nvidia/cuda:11.8.0-base-ubuntu22.04" },
  { label: "CUDA 11.8 + cuDNN 8 Devel", value: "nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04" },
  { label: "Custom…", value: "__custom__" },
];

const ALL_CURRENCIES = ["CLORE-Blockchain", "USD-Blockchain", "bitcoin"];

function RentDialog({ offer, onClose }: { offer: CloreOffer; onClose: () => void }) {
  const rentClore = useRentClore();
  const [imagePreset, setImagePreset] = useState("cloreai/ubuntu22.04-cuda12");
  const [customImage, setCustomImage] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [orderType, setOrderType] = useState<"on-demand" | "spot">("on-demand");
  const availableCurrencies = offer.allowed_coins?.length
    ? ALL_CURRENCIES.filter((c) => offer.allowed_coins.includes(c))
    : ALL_CURRENCIES;
  const [currency, setCurrency] = useState(
    availableCurrencies.includes("CLORE-Blockchain") ? "CLORE-Blockchain" : availableCurrencies[0] ?? "CLORE-Blockchain"
  );
  const [spotPrice, setSpotPrice] = useState("");
  const [portsRaw, setPortsRaw] = useState('{"22": "tcp"}');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [envRaw, setEnvRaw] = useState("");
  const [command, setCommand] = useState("");
  const [jupyterToken, setJupyterToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [keyGenMsg, setKeyGenMsg] = useState<string | null>(null);

  const image = imagePreset === "__custom__" ? customImage.trim() : imagePreset;

  function validatePorts(): Record<string, string> | null {
    if (!portsRaw.trim()) return {};
    try {
      const parsed = JSON.parse(portsRaw);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, string>;
    } catch { return null; }
  }

  function validateEnv(): Record<string, string> | null {
    if (!envRaw.trim()) return {};
    try {
      const parsed = JSON.parse(envRaw);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, string>;
    } catch { return null; }
  }

  function handleSubmit() {
    setError(null);
    if (!image) { setError("Docker image is required."); return; }
    if (authMode === "password" && !sshPassword) { setError("SSH password is required."); return; }
    if (authMode === "key" && !sshKey.trim()) { setError("SSH public key is required."); return; }

    const ports = validatePorts();
    if (ports === null) { setError('Ports must be valid JSON, e.g. {"22": "tcp"}'); return; }
    const env = validateEnv();
    if (env === null) { setError('Env must be valid JSON, e.g. {"MY_VAR": "value"}'); return; }

    const req: RentRequest = {
      offer_id: offer.id, image, order_type: orderType, currency,
      ...(authMode === "password" ? { ssh_password: sshPassword } : { ssh_key: sshKey.trim() }),
      ...(Object.keys(ports).length ? { ports } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(command.trim() ? { command: command.trim() } : {}),
      ...(jupyterToken.trim() ? { jupyter_token: jupyterToken.trim() } : {}),
      ...(orderType === "spot" && spotPrice ? { spot_price: parseFloat(spotPrice) } : {}),
    };

    rentClore.mutate(req, {
      onSuccess: onClose,
      onError: (e) => setError(e.message),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <Card className="w-full max-w-lg overflow-y-auto max-h-[90vh] px-6 py-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Rent {offer.gpu_name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ${offer.price_per_day.toFixed(2)}/day · {offer.vram_gb} GB VRAM
              {offer.gpu_count > 1 && ` · ${offer.gpu_count}× GPU`}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Docker image</label>
          <select className="input w-full text-sm" value={imagePreset} onChange={(e) => setImagePreset(e.target.value)}>
            {PRESET_IMAGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {imagePreset === "__custom__" && (
            <Input className="mt-2 text-sm" placeholder="docker.io/user/image:tag"
              value={customImage} onChange={(e) => setCustomImage(e.target.value)} />
          )}
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">SSH authentication</label>
          <div className="flex gap-2 mb-2">
            {(["password", "key"] as const).map((m) => (
              <button key={m} onClick={() => setAuthMode(m)}
                className={`rounded px-3 py-1 text-xs transition-colors ${authMode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {m === "password" ? "Password" : "SSH Key Pair"}
              </button>
            ))}
          </div>
          {authMode === "password" ? (
            <Input type="password" placeholder="Alphanumeric, max 32 chars"
              maxLength={32} value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">Public key <span className="text-muted-foreground/60">(sent to Clore → injected into authorized_keys)</span></p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={generatingKey}
                  onClick={async () => {
                    setGeneratingKey(true); setKeyGenMsg(null);
                    try {
                      const { api } = await import("@/lib/api");
                      const { public_key } = await api.settings.generateKeypair();
                      setSshKey(public_key);
                      setKeyGenMsg("Key pair generated — private key saved to platform settings.");
                    } catch (e) {
                      setKeyGenMsg(e instanceof Error ? e.message : "Generation failed");
                    } finally { setGeneratingKey(false); }
                  }}
                >
                  {generatingKey ? "Generating…" : "Generate"}
                </Button>
              </div>
              <textarea className="input w-full text-sm font-mono resize-none" rows={2}
                placeholder="ssh-ed25519 AAAA… or ssh-rsa AAAA… (or click Generate)"
                value={sshKey} onChange={(e) => setSshKey(e.target.value)} />
              {keyGenMsg && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{keyGenMsg}</p>}
              <div className="rounded bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="text-foreground/70 font-medium">Private key:</span> the platform will use the SSH private key
                stored in <span className="text-indigo-400">Settings → SSH Key</span> to connect terminal sessions.
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Order type</label>
            <select className="input w-full text-sm" value={orderType} onChange={(e) => setOrderType(e.target.value as "on-demand" | "spot")}>
              <option value="on-demand">On-demand</option>
              <option value="spot">Spot</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Currency</label>
            <select className="input w-full text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {orderType === "spot" && (
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Max spot price ($/day)</label>
            <Input type="number" step="0.01" className="text-sm"
              placeholder={offer.price_per_day.toFixed(2)} value={spotPrice} onChange={(e) => setSpotPrice(e.target.value)} />
          </div>
        )}

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Port mappings (JSON)</label>
          <Input className="text-sm font-mono" value={portsRaw} onChange={(e) => setPortsRaw(e.target.value)}
            placeholder='{"22": "tcp", "8888": "http"}' />
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">Port 22/tcp is required for SSH access.</p>
        </div>

        <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
          {showAdvanced ? "▲ Hide advanced" : "▼ Advanced (env, command, Jupyter token)"}
        </button>
        {showAdvanced && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Environment variables (JSON)</label>
              <Input className="text-sm font-mono" value={envRaw} onChange={(e) => setEnvRaw(e.target.value)} placeholder='{"HF_TOKEN": "hf_..."}' />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Startup command</label>
              <Input className="text-sm" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="bash -c 'pip install vllm && ...'" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Jupyter token</label>
              <Input className="text-sm" value={jupyterToken} onChange={(e) => setJupyterToken(e.target.value)} placeholder="max 32 chars" maxLength={32} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={rentClore.isPending} onClick={handleSubmit}>Confirm rent</Button>
        </div>
      </Card>
    </div>
  );
}
