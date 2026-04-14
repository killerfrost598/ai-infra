"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { CloreOffer, CloreRental } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

type Tab = "marketplace" | "rentals";

export default function ClorePage() {
  const [tab, setTab] = useState<Tab>("marketplace");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Clore.ai</h1>
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-sm">
          {(["marketplace", "rentals"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 capitalize transition-colors ${
                tab === t
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "marketplace" && <MarketplaceTab />}
      {tab === "rentals" && <RentalsTab />}
    </div>
  );
}

// ── Filter state ───────────────────────────────────────────────────────────────

interface Filters {
  gpu: string;
  minVram: number;       // GB
  minDisk: number;       // GB
  minPcieVersion: number; // e.g. 3 for "3.0"
  minPcieWidth: number;  // e.g. 8
  minUpload: number;     // Mbps
  minDownload: number;   // Mbps
}

const DEFAULT_FILTERS: Filters = {
  gpu: "",
  minVram: 0,
  minDisk: 0,
  minPcieVersion: 0,
  minPcieWidth: 0,
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

function MarketplaceTab() {
  const [offers, setOffers] = useState<CloreOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [renting, setRenting] = useState<string | null>(null);
  const [rentError, setRentError] = useState<string | null>(null);

  // Rent dialog state
  const [dialogOffer, setDialogOffer] = useState<CloreOffer | null>(null);
  const [rentImage, setRentImage] = useState("cloreai/ubuntu22.04-cuda12");
  const [rentPassword, setRentPassword] = useState("");

  function load(gpu?: string) {
    setLoading(true);
    setError(null);
    api.clore
      .offers(gpu || undefined)
      .then((res) => setOffers(res.offers))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => applyFilters(offers, filters), [offers, filters]);

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handleRent() {
    if (!dialogOffer) return;
    setRenting(dialogOffer.id);
    setRentError(null);
    try {
      await api.clore.rent(dialogOffer.id, rentImage, rentPassword || undefined);
      setDialogOffer(null);
      setRentPassword("");
    } catch (e: unknown) {
      setRentError(e instanceof Error ? e.message : "Rent failed");
    } finally {
      setRenting(null);
    }
  }

  const hasActiveFilters =
    filters.gpu || filters.minVram > 0 || filters.minDisk > 0 ||
    filters.minPcieVersion > 0 || filters.minPcieWidth > 0 ||
    filters.minUpload > 0 || filters.minDownload > 0;

  return (
    <>
      {/* ── Filter panel ── */}
      <div className="card px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Filters</span>
          {hasActiveFilters && (
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <FilterField label="GPU name">
            <input
              className="input w-full text-sm"
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
            <select
              className="input w-full text-sm"
              value={filters.minPcieVersion}
              onChange={(e) => setFilter("minPcieVersion", Number(e.target.value))}
            >
              <option value={0}>Any</option>
              <option value={3}>3.0+</option>
              <option value={4}>4.0+</option>
              <option value={5}>5.0+</option>
            </select>
          </FilterField>
          <FilterField label="Min PCIe width">
            <select
              className="input w-full text-sm"
              value={filters.minPcieWidth}
              onChange={(e) => setFilter("minPcieWidth", Number(e.target.value))}
            >
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
            <button onClick={() => load(filters.gpu)} className="btn-secondary text-sm py-1.5 px-3 w-full">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading offers…
        </div>
      )}
      {!loading && !error && offers.length === 0 && (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm text-zinc-500">No offers found.</p>
          <p className="mt-1 text-xs text-zinc-600">Check that the Clore API key is configured in Settings.</p>
        </div>
      )}
      {!loading && !error && offers.length > 0 && filtered.length === 0 && (
        <div className="card px-6 py-6 text-center">
          <p className="text-sm text-zinc-500">No offers match the current filters.</p>
          <button onClick={() => setFilters(DEFAULT_FILTERS)} className="mt-2 text-xs text-indigo-400 hover:text-indigo-300">
            Clear filters
          </button>
        </div>
      )}

      {/* ── Results summary ── */}
      {!loading && filtered.length > 0 && (
        <p className="text-xs text-zinc-600">
          {filtered.length} offer{filtered.length !== 1 ? "s" : ""}
          {hasActiveFilters ? ` (${offers.length} total)` : ""}
        </p>
      )}

      {/* ── Offer cards ── */}
      <div className="space-y-2">
        {filtered.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            onRent={() => { setDialogOffer(offer); setRentError(null); }}
          />
        ))}
      </div>

      {/* ── Rent dialog ── */}
      {dialogOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="card w-full max-w-md space-y-4 px-6 py-5">
            <h2 className="text-base font-semibold text-zinc-100">Rent {dialogOffer.gpu_name}</h2>
            <p className="text-xs text-zinc-500">
              ${dialogOffer.price_per_day.toFixed(2)}/day · {dialogOffer.vram_gb} GB VRAM
              {dialogOffer.gpu_count > 1 && ` · ${dialogOffer.gpu_count}× GPU`}
            </p>

            {rentError && (
              <p className="text-xs text-rose-400">{rentError}</p>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Docker image</label>
                <input
                  className="input w-full text-sm"
                  value={rentImage}
                  onChange={(e) => setRentImage(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">SSH password</label>
                <input
                  type="password"
                  className="input w-full text-sm"
                  placeholder="Leave blank to auto-generate"
                  value={rentPassword}
                  onChange={(e) => setRentPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDialogOffer(null)} className="btn-ghost text-sm">Cancel</button>
              <button
                onClick={handleRent}
                disabled={renting === dialogOffer.id}
                className="btn-primary text-sm"
              >
                {renting === dialogOffer.id ? "Renting…" : "Confirm rent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Offer card ─────────────────────────────────────────────────────────────────

function OfferCard({ offer, onRent }: { offer: CloreOffer; onRent: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const pcieBadgeColor =
    !offer.pcie_version ? "text-zinc-600" :
    parseFloat(offer.pcie_version) >= 4 ? "text-emerald-500" :
    parseFloat(offer.pcie_version) >= 3 ? "text-yellow-500" :
    "text-rose-400";

  const pcieWidthColor =
    !offer.pcie_width ? "text-zinc-600" :
    offer.pcie_width >= 16 ? "text-emerald-500" :
    offer.pcie_width >= 8 ? "text-yellow-500" :
    "text-rose-400";

  return (
    <div className="card px-5 py-4 space-y-3">
      {/* Main row */}
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-zinc-100">{offer.gpu_name}</p>
            {offer.gpu_count > 1 && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">×{offer.gpu_count}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <Chip label={`${offer.vram_gb} GB VRAM`} color="text-indigo-400" />
            {offer.cuda_version && <Chip label={`CUDA ${offer.cuda_version}`} />}
            <span className={`font-mono ${pcieBadgeColor}`}>
              PCIe {offer.pcie_version ?? "?"} {offer.pcie_width ? `x${offer.pcie_width}` : ""}
            </span>
            {offer.disk_gb != null && (
              <Chip label={`${offer.disk_gb} GB disk`} color={offer.disk_gb >= 100 ? "text-zinc-400" : "text-rose-400"} />
            )}
          </div>
        </div>

        <div className="shrink-0 text-right space-y-1">
          <p className="text-sm font-semibold text-zinc-100">
            ${offer.price_per_day.toFixed(2)}<span className="text-xs text-zinc-500">/day</span>
          </p>
          {offer.upload_mbps != null && (
            <p className="text-xs text-zinc-500">
              ↑ {fmtSpeed(offer.upload_mbps)} · ↓ {fmtSpeed(offer.download_mbps)}
            </p>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setExpanded((x) => !x)}
            className="btn-ghost text-xs py-1.5 px-2"
            title="Show full specs"
          >
            {expanded ? "Less" : "More"}
          </button>
          <button onClick={onRent} className="btn-primary text-xs py-1.5 px-3">
            Rent
          </button>
        </div>
      </div>

      {/* Expanded hardware details */}
      {expanded && (
        <div className="border-t border-zinc-800 pt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
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
      )}
    </div>
  );
}

function Chip({ label, color = "text-zinc-500" }: { label: string; color?: string }) {
  return <span className={color}>{label}</span>;
}

function SpecRow({ label, value, colorClass = "text-zinc-300" }: { label: string; value: string | null | undefined; colorClass?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-zinc-600 shrink-0">{label}</span>
      <span className={value ? colorClass : "text-zinc-700 italic"}>
        {value ?? "unknown"}
      </span>
    </div>
  );
}

function fmtSpeed(mbps: number | null | undefined): string {
  if (mbps == null) return "—";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${Math.round(mbps)} Mbps`;
}

// ── Small reusable filter inputs ───────────────────────────────────────────────

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min = 0,
  step = 1,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      className="input w-full text-sm"
      value={value || ""}
      min={min}
      step={step}
      placeholder={placeholder ?? "0 = any"}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}

// ── Rentals tab ────────────────────────────────────────────────────────────────

function RentalsTab() {
  const [rentals, setRentals] = useState<CloreRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminating, setTerminating] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.clore
      .rentals()
      .then((res) => setRentals(res.rentals))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleTerminate(id: string) {
    if (!confirm("Terminate this rental? The server will be stopped and all data lost.")) return;
    setTerminating(id);
    try {
      await api.clore.terminate(id);
      load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Terminate failed");
    } finally {
      setTerminating(null);
    }
  }

  return (
    <>
      {error && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading rentals…
        </div>
      )}
      {!loading && !error && rentals.length === 0 && (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm text-zinc-500">No active rentals.</p>
          <p className="mt-1 text-xs text-zinc-600">Rent a server from the Marketplace tab.</p>
        </div>
      )}

      <div className="space-y-2">
        {rentals.map((r) => (
          <div key={r.id} className="card flex items-center gap-4 px-5 py-4">
            <StatusBadge status={r.status.toUpperCase()} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-100">{r.gpu_name}</p>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 text-xs text-zinc-500">
                <span>{r.hostname}:{r.ssh_port}</span>
                <span>{r.ssh_username}</span>
                {r.vram_gb > 0 && <span>{r.vram_gb} GB VRAM</span>}
                {r.cuda_version && <span>CUDA {r.cuda_version}</span>}
              </div>
            </div>
            <button
              onClick={() => handleTerminate(r.id)}
              disabled={terminating === r.id}
              className="btn-danger text-xs py-1.5 px-3 shrink-0"
            >
              {terminating === r.id ? "Terminating…" : "Terminate"}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
