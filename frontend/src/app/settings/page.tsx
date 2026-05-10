"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  FlaskConical,
  Key,
  Server,
  Settings,
} from "lucide-react";
import {
  useCloreBalance,
  useModelSyncStatus,
  useRefreshAllModels,
  useSaveSetting,
  useDeleteSetting,
  useSeedDefaultModels,
  useSettings,
} from "@/lib/queries";
import type { SettingEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { cn } from "@/lib/utils";

// ─── Filter & quant definitions ──────────────────────────────────────────────

type FilterDef = {
  key: string;
  dbKey: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  rec: number;
  seed: number;
  help: string;
};

const FILTER_DEFS: FilterDef[] = [
  { key: "pcie_gen",   dbKey: "clore_min_pcie_gen",   label: "PCIe Gen",   unit: "",      min: 1,  max: 5,     step: 0.5, rec: 3,    seed: 8,  help: "PCIe < 3 creates GPU↔host bandwidth bottlenecks. Recommended: 3." },
  { key: "pcie_width", dbKey: "clore_min_pcie_width", label: "PCIe Width", unit: "x",    min: 1,  max: 16,    step: 1,   rec: 8,    seed: 12, help: "x8 is the minimum for reliable inference throughput." },
  { key: "disk_gb",    dbKey: "clore_min_disk_gb",    label: "Disk",       unit: " GB",  min: 20, max: 2000,  step: 10,  rec: 100,  seed: 4,  help: "100 GB is the practical minimum for a single large model." },
  { key: "dl_mbps",    dbKey: "clore_min_dl_mbps",    label: "Download",   unit: " Mbps",min: 50, max: 10000, step: 50,  rec: 500,  seed: 7,  help: "Low bandwidth makes model pulls painfully slow." },
  { key: "ul_mbps",    dbKey: "clore_min_ul_mbps",    label: "Upload",     unit: " Mbps",min: 50, max: 5000,  step: 50,  rec: 200,  seed: 9,  help: "Upload speed matters for distributed inference." },
  { key: "cuda",       dbKey: "clore_min_cuda",       label: "CUDA",       unit: "",     min: 11, max: 13,    step: 0.1, rec: 12.0, seed: 5,  help: "vLLM and SGLang require at least 11.8. Recommended: 12.0." },
  { key: "vram_gb",    dbKey: "clore_min_vram_gb",    label: "Total VRAM", unit: " GB",  min: 8,  max: 320,   step: 8,   rec: 24,   seed: 14, help: "Total VRAM = gpu_count × per_gpu_vram." },
];

const QUANT_FORMATS = [
  { key: "gguf",    label: "GGUF",    note: "CPU / Mac llama.cpp only" },
  { key: "mlx",     label: "MLX",     note: "Apple Silicon only" },
  { key: "awq",     label: "AWQ",     note: "4-bit · CC ≥ 7.5" },
  { key: "gptq",    label: "GPTQ",    note: "4-bit · widely supported" },
  { key: "bnb",     label: "BNB",     note: "NF4 · CC ≥ 7.5" },
  { key: "fp8",     label: "FP8",     note: "H100 / L40S only" },
  { key: "fp16",    label: "FP16",    note: "Full half precision" },
  { key: "int8",    label: "INT8",    note: "W8A8 · CC ≥ 6.1" },
  { key: "int4",    label: "INT4",    note: "Generic 4-bit · CC ≥ 7.5" },
  { key: "fp4",     label: "FP4",     note: "Blackwell only" },
  { key: "unknown", label: "unknown", note: "Detection failed" },
];

interface SettingMeta {
  label: string;
  description: string;
  placeholder: string;
  inputType?: "password" | "text" | "textarea";
}

const SETTING_META: Record<string, SettingMeta> = {
  clore_api_key: {
    label: "Clore.ai API Key",
    description: "Required to browse the GPU marketplace, rent servers, and manage rentals.",
    placeholder: "Paste your Clore.ai API key…",
    inputType: "password",
  },
  hf_token: {
    label: "HuggingFace Token",
    description: "Used when seeding model metadata. Doubles rate limit; required for gated models (Llama, Gemma).",
    placeholder: "hf_…",
    inputType: "password",
  },
  anthropic_api_key: {
    label: "Anthropic API Key",
    description: "Used by Lab for playbook conversion and AI-assisted deployment guidance.",
    placeholder: "sk-ant-…",
    inputType: "password",
  },
  openai_api_key: {
    label: "OpenAI API Key",
    description: "Used by Lab for optional ChatGPT/OpenAI-assisted deployment guidance.",
    placeholder: "sk-…",
    inputType: "password",
  },
  openai_model: {
    label: "OpenAI Model",
    description: "Optional model override for OpenAI deployment guidance. Default: gpt-4.1-mini.",
    placeholder: "gpt-4.1-mini",
  },
  ssh_private_key: {
    label: "Platform SSH Private Key",
    description: "PEM private key used to connect to rented servers via SSH key auth.",
    placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----",
    inputType: "textarea",
  },
  github_token: {
    label: "GitHub Token",
    description: "Personal access token (classic) with repo:write scope. Used by Lab's Publish Run Report feature.",
    placeholder: "ghp_…",
    inputType: "password",
  },
  github_repo: {
    label: "GitHub Repo",
    description: "Target repository for published run reports, in owner/repo format.",
    placeholder: "yourname/inferix-runs",
  },
  github_publish_mode: {
    label: "Publish Mode",
    description: "commit = direct commit to main; pr = opens a pull request for review.",
    placeholder: "commit",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ratio(f: FilterDef, v: number): number {
  return Math.max(0, Math.min(1, (v - f.min) / (f.max - f.min)));
}

function fmtVal(f: FilterDef, v: number): string {
  if (f.unit === " GB" || f.unit === " Mbps") return Math.round(v) + f.unit;
  if (f.key === "cuda") return v.toFixed(1);
  if (f.key === "pcie_width") return v + "x";
  if (f.key === "pcie_gen") return v.toFixed(1);
  return v + f.unit;
}

function genHisto(seed: number): number[] {
  return Array.from({ length: 32 }, (_, i) => {
    const x = i / 31;
    const bell = Math.exp(-Math.pow((x - 0.55) * 3, 2));
    const noise = ((Math.sin(seed * 9 + i * 1.7) + 1) / 2) * 0.4 + 0.4;
    return Math.max(0.05, Math.min(1, bell * 0.7 + noise * 0.3 - 0.1));
  });
}

// ─── HistogramFilterRow ───────────────────────────────────────────────────────

function HistogramFilterRow({
  f,
  value,
  onChange,
}: {
  f: FilterDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const bins = useMemo(() => genHisto(f.seed), [f.seed]);
  const cutoffPct = ratio(f, value);

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const raw = f.min + pct * (f.max - f.min);
    const snapped = Math.round(raw / f.step) * f.step;
    onChange(parseFloat(Math.max(f.min, Math.min(f.max, snapped)).toFixed(1)));
  }

  return (
    <div className="border-b border-border/30 py-4 last:border-0">
      <div className="mb-2 flex items-center gap-3">
        <div className="min-w-[160px]">
          <p className="text-sm font-medium">{f.label}</p>
          <p className="text-[10.5px] leading-snug text-muted-foreground">{f.help}</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-baseline gap-1 font-mono text-sm">
          <span className="text-xs text-muted-foreground">≥</span>
          <span className="font-semibold text-primary">{fmtVal(f, value)}</span>
        </div>
      </div>

      {/* Interactive histogram bar */}
      <div
        className="relative h-14 cursor-crosshair select-none"
        onClick={handleBarClick}
      >
        {/* Distribution bins */}
        <div className="absolute inset-x-0 bottom-5 flex h-8 items-end gap-[1.5px]">
          {bins.map((h, i) => (
            <div
              key={i}
              className={cn(
                "flex-1 rounded-t-[1.5px] transition-colors duration-150",
                i / bins.length < cutoffPct
                  ? "bg-destructive/30"
                  : "bg-primary/50"
              )}
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </div>

        {/* Recommended marker */}
        <div
          className="absolute bottom-5 top-1 w-px bg-amber-500"
          style={{ left: `${ratio(f, f.rec) * 100}%` }}
        >
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold text-amber-500">
            rec
          </span>
        </div>

        {/* Threshold thumb */}
        <div
          className="pointer-events-none absolute bottom-5 top-0 w-0.5 bg-primary"
          style={{ left: `${cutoffPct * 100}%` }}
        >
          <div className="absolute -left-[5px] -top-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
        </div>
      </div>

      {/* Axis labels */}
      <div className="mt-0.5 flex justify-between font-mono text-[9.5px] text-muted-foreground">
        <span>{fmtVal(f, f.min)}</span>
        <span className="text-amber-500">rec {fmtVal(f, f.rec)}</span>
        <span>{fmtVal(f, f.max)}</span>
      </div>
    </div>
  );
}

// ─── ConfiguredBadge ──────────────────────────────────────────────────────────

function ConfiguredBadge({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
        Configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Not configured
    </span>
  );
}

// ─── SettingCard ──────────────────────────────────────────────────────────────

function SettingCard({ setting, meta }: { setting: SettingEntry; meta: SettingMeta }) {
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();
  const [input, setInput] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleSave() {
    const value = input.trim();
    if (!value) return;
    setError("");
    saveSetting.mutate(
      { key: setting.key, value },
      {
        onSuccess: () => {
          setInput("");
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 3000);
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  function confirmDelete() {
    setError("");
    deleteSetting.mutate(setting.key, {
      onError: (err) => setError(err.message),
      onSettled: () => setConfirmOpen(false),
    });
  }

  const isTextarea = meta.inputType === "textarea";

  return (
    <div className="border-b border-border/30 py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{meta.label}</p>
            <ConfiguredBadge configured={setting.is_configured} />
          </div>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{meta.description}</p>
          {setting.updated_at && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/50">
              Last updated {new Date(setting.updated_at).toLocaleString()}
            </p>
          )}
        </div>
        {setting.is_configured && (
          <Button
            variant="destructive"
            size="sm"
            loading={deleteSetting.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Clear
          </Button>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        {isTextarea ? (
          <textarea
            className="input flex-1 resize-none font-mono text-xs"
            rows={4}
            placeholder={meta.placeholder}
            value={input}
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
          />
        ) : (
          <Input
            type={meta.inputType ?? "text"}
            className="flex-1"
            placeholder={meta.placeholder}
            value={input}
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        )}
        <Button onClick={handleSave} loading={saveSetting.isPending} disabled={!input.trim()}>
          {justSaved ? "Saved ✓" : "Save"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Clear "${meta.label}"?`}
        description="This stored value will be removed from the database."
        confirmLabel="Clear Value"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ─── Section: General ─────────────────────────────────────────────────────────

function BalanceCard({ cloreConfigured }: { cloreConfigured: boolean }) {
  const { data: balance, isLoading, error, refetch } = useCloreBalance(cloreConfigured);
  if (!cloreConfigured) return null;

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Clore.ai Balance</p>
        <Button variant="ghost" size="sm" loading={isLoading} onClick={() => refetch()}>
          Refresh
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}
      {!isLoading && !error && balance && (
        <div className="mt-3 flex flex-wrap gap-3">
          {balance.balances.length === 0 && (
            <p className="text-sm text-muted-foreground">No wallet data available.</p>
          )}
          {balance.balances.map((w) => (
            <div key={w.currency} className="min-w-[110px] rounded-lg bg-muted/40 px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {w.currency}
              </p>
              <p className="mt-1 font-mono text-xl font-bold">
                {w.currency.toLowerCase().includes("usd") ? "$" : ""}
                {w.amount.toFixed(4)}
              </p>
            </div>
          ))}
        </div>
      )}
      {isLoading && <LoadingState text="Loading balance…" className="mt-3" />}
    </Card>
  );
}

function GeneralSection({ settings }: { settings: SettingEntry[] }) {
  const cloreConfigured = settings.find((s) => s.key === "clore_api_key")?.is_configured ?? false;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">General</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Platform status and wallet overview.</p>
      </div>
      <BalanceCard cloreConfigured={cloreConfigured} />
      {!cloreConfigured && (
        <Card className="px-5 py-5">
          <p className="text-sm text-muted-foreground">
            Configure your Clore.ai API key under{" "}
            <strong className="text-foreground">API + Tokens</strong> to unlock balance and marketplace features.
          </p>
        </Card>
      )}
    </div>
  );
}

// ─── Section: Marketplace ─────────────────────────────────────────────────────

function RefreshModelsRow() {
  const [isRunning, setIsRunning] = useState(false);
  const { data: syncStatus, refetch } = useModelSyncStatus(isRunning);
  const refreshAll = useRefreshAllModels();
  const status = syncStatus?.status ?? null;
  const isActive = status === "RUNNING" || refreshAll.isPending;

  useEffect(() => {
    if (isRunning && status && status !== "RUNNING") setIsRunning(false);
  }, [isRunning, status]);

  function handleRefresh() {
    setIsRunning(true);
    refreshAll.mutate(undefined, {
      onSuccess: () => refetch(),
      onError: () => setIsRunning(false),
    });
  }

  const meta = syncStatus?.metadata as Record<string, number> | null;
  const lastRanAt = syncStatus?.finished_at
    ? new Date(syncStatus.finished_at).toLocaleString()
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Refresh All Models</p>
        <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
          Re-fetches metadata and community quants from HuggingFace for every model with{" "}
          <code className="text-foreground/70">source=hf</code>. Uses a 24-hour Redis cache per repo.
        </p>
        {lastRanAt && !isActive && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            Last run {lastRanAt}
            {meta && typeof meta.succeeded === "number" && (
              <> · {meta.succeeded}/{meta.total} succeeded</>
            )}
          </p>
        )}
        {isActive && (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="border-t-primary" />
            Syncing models…
          </div>
        )}
        {status === "FAILED" && !isActive && (
          <p className="mt-0.5 text-xs text-destructive">
            {syncStatus?.error_summary ?? "Sync failed"}
          </p>
        )}
      </div>
      <Button onClick={handleRefresh} loading={isActive} disabled={isActive} variant="outline" size="sm">
        Refresh all models
      </Button>
    </div>
  );
}

function MarketplaceSection({ settings }: { settings: SettingEntry[] }) {
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();
  const seedDefaults = useSeedDefaultModels();

  // Parse filter values from DB
  const dbValues = useMemo(() => {
    const v: Record<string, number> = {};
    FILTER_DEFS.forEach((f) => {
      const s = settings.find((s) => s.key === f.dbKey);
      if (s?.value) {
        const n = parseFloat(s.value);
        if (!isNaN(n)) v[f.key] = n;
      }
    });
    return v;
  }, [settings]);

  // Local draft for pending filter changes
  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    setDraft({});
  }, [dbValues]);

  function getValue(key: string): number {
    if (key in draft) return draft[key];
    const f = FILTER_DEFS.find((f) => f.key === key)!;
    return dbValues[key] ?? f.rec;
  }

  const isDirty = FILTER_DEFS.some(
    (f) => f.key in draft && draft[f.key] !== (dbValues[f.key] ?? f.rec)
  );

  function saveFilters() {
    FILTER_DEFS.forEach((f) => {
      if (f.key in draft && draft[f.key] !== (dbValues[f.key] ?? f.rec)) {
        saveSetting.mutate({ key: f.dbKey, value: String(draft[f.key]) });
      }
    });
    setDraft({});
  }

  // Quant format exclusions
  const rawExcluded = settings.find((s) => s.key === "excluded_quant_formats")?.value ?? "";
  const excluded = useMemo(
    () =>
      new Set(
        rawExcluded
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      ),
    [rawExcluded]
  );

  function toggleFormat(fmt: string) {
    const next = new Set(excluded);
    if (next.has(fmt)) next.delete(fmt);
    else next.add(fmt);
    const value = [...next].join(",");
    if (value) saveSetting.mutate({ key: "excluded_quant_formats", value });
    else deleteSetting.mutate("excluded_quant_formats");
  }

  // Default seed models
  const seedEntry = settings.find((s) => s.key === "default_seed_models");
  const currentModels = seedEntry?.value ?? "";
  const [modelsInput, setModelsInput] = useState(currentModels);

  useEffect(() => {
    setModelsInput(currentModels);
  }, [currentModels]);

  return (
    <div className="space-y-5">
      {/* Section header + save button */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-base font-semibold">Marketplace filters</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Applied globally to GPU Finder · Marketplace · Models
          </p>
        </div>
        <div className="flex-1" />
        <Button
          onClick={saveFilters}
          loading={saveSetting.isPending}
          size="sm"
          disabled={!isDirty}
          variant={isDirty ? "default" : "outline"}
        >
          {isDirty ? "Save changes" : "No changes"}
        </Button>
      </div>

      {/* Histogram filter rows */}
      <Card className="px-5 py-0">
        <div className="border-b border-border/30 py-4">
          <p className="text-sm font-semibold">GPU Quality Bar</p>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            Each bar shows the marketplace distribution today. Red = below your floor (excluded). Click to adjust.
          </p>
        </div>
        {FILTER_DEFS.map((f) => (
          <HistogramFilterRow
            key={f.key}
            f={f}
            value={getValue(f.key)}
            onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
      </Card>

      {/* Quant formats + Default models side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="px-5 py-4">
          <p className="text-sm font-semibold">Quant Formats</p>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
            Click to exclude. Models with no remaining quant disappear from results.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUANT_FORMATS.map((q) => {
              const isExcluded = excluded.has(q.key);
              return (
                <button
                  key={q.key}
                  onClick={() => toggleFormat(q.key)}
                  title={q.note}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors",
                    isExcluded
                      ? "border-destructive/25 bg-destructive/10 text-destructive line-through"
                      : "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  <span className="text-[10px]">{isExcluded ? "✕" : "✓"}</span>
                  {q.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{QUANT_FORMATS.length - excluded.size}</span>
            {" "}of {QUANT_FORMATS.length} formats included
          </p>
        </Card>

        <Card className="px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Default Seed Models</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                HuggingFace repos auto-pulled on first session. One per line.
              </p>
            </div>
            {seedEntry?.is_configured && (
              <Button
                size="sm"
                variant="outline"
                loading={seedDefaults.isPending}
                onClick={() => seedDefaults.mutate()}
              >
                Seed now
              </Button>
            )}
          </div>
          <textarea
            className="input mt-3 w-full resize-none font-mono text-xs"
            rows={6}
            placeholder={
              "meta-llama/Llama-3.1-8B-Instruct\nmistralai/Mistral-7B-Instruct-v0.3\nQwen/Qwen2.5-7B-Instruct"
            }
            value={modelsInput}
            onChange={(e) => setModelsInput(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                saveSetting.mutate({ key: "default_seed_models", value: modelsInput.trim() })
              }
              loading={saveSetting.isPending}
              disabled={!modelsInput.trim() || modelsInput.trim() === currentModels}
            >
              Save
            </Button>
            {seedEntry?.is_configured && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={deleteSetting.isPending}
                onClick={() =>
                  deleteSetting.mutate("default_seed_models", {
                    onSuccess: () => setModelsInput(""),
                  })
                }
              >
                Clear
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Refresh models */}
      <Card className="px-5 py-0">
        <RefreshModelsRow />
      </Card>
    </div>
  );
}

// ─── Section: API + Tokens ────────────────────────────────────────────────────

const API_KEYS = [
  "clore_api_key",
  "hf_token",
  "anthropic_api_key",
  "openai_api_key",
  "openai_model",
  "ssh_private_key",
];

function ApiSection({ settings }: { settings: SettingEntry[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">API Keys &amp; Tokens</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Values are write-only and stored encrypted in the database. Use Clear to remove.
        </p>
      </div>
      <Card className="px-5 py-0">
        {API_KEYS.map((key) => {
          const setting = settings.find((s) => s.key === key);
          const meta = SETTING_META[key];
          if (!setting || !meta) return null;
          return <SettingCard key={key} setting={setting} meta={meta} />;
        })}
      </Card>
    </div>
  );
}

// ─── Section: Lab Automation ──────────────────────────────────────────────────

function LabSection({ settings }: { settings: SettingEntry[] }) {
  const saveSetting = useSaveSetting();

  function getVal(key: string, fallback: string) {
    return settings.find((s) => s.key === key)?.value ?? fallback;
  }

  const autoSetupMode = getVal("lab_auto_setup_mode", "recommend_only");
  const runtimeMode = getVal("lab_default_runtime_mode", "auto");

  function setValue(key: string, value: string) {
    saveSetting.mutate({ key, value });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Lab Automation</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Controls how Lab recommends and runs setup commands before deployment.
        </p>
      </div>

      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Automation settings</p>
            <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
              Controls whether Lab only recommends setup commands or automatically runs low-risk,
              idempotent setup steps before a deployment.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/preflight">Configure commands</Link>
          </Button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Setup automation</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={autoSetupMode === "recommend_only" ? "secondary" : "outline"}
                onClick={() => setValue("lab_auto_setup_mode", "recommend_only")}
                loading={saveSetting.isPending}
                className="justify-start"
              >
                Recommend only
              </Button>
              <Button
                type="button"
                variant={autoSetupMode === "auto_low_risk_setup" ? "secondary" : "outline"}
                onClick={() => setValue("lab_auto_setup_mode", "auto_low_risk_setup")}
                loading={saveSetting.isPending}
                className="justify-start"
              >
                Auto low-risk setup
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Auto mode is limited to apt metadata, curl/uv checks, managed venv setup, and HuggingFace CLI.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Default runtime</p>
            <div className="grid grid-cols-3 gap-2">
              {(["auto", "docker", "uv_venv"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={runtimeMode === mode ? "secondary" : "outline"}
                  onClick={() => setValue("lab_default_runtime_mode", mode)}
                  loading={saveSetting.isPending}
                >
                  {mode === "uv_venv" ? "uv venv" : mode}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Auto uses Docker only when Docker and NVIDIA Container Toolkit already work.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Section: Diagnostics ─────────────────────────────────────────────────────

const GITHUB_KEYS = ["github_token", "github_repo", "github_publish_mode"];

function DiagnosticsSection({ settings }: { settings: SettingEntry[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Diagnostic Publication</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Configure GitHub token and repository for publishing sanitized run reports.
        </p>
      </div>
      <Card className="px-5 py-0">
        {GITHUB_KEYS.map((key) => {
          const setting = settings.find((s) => s.key === key);
          const meta = SETTING_META[key];
          if (!setting || !meta) return null;
          return <SettingCard key={key} setting={setting} meta={meta} />;
        })}
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type SectionId = "general" | "marketplace" | "api" | "lab" | "diagnostics";

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  pip?: string;
}

export default function SettingsPage() {
  const { data, isLoading, error } = useSettings();
  const settings: SettingEntry[] = data?.settings ?? [];
  const [active, setActive] = useState<SectionId>("marketplace");

  const navItems: NavItem[] = [
    { id: "general",     label: "General",        icon: <Settings className="size-4" /> },
    { id: "marketplace", label: "Marketplace",    icon: <Server className="size-4" />,       pip: "filters" },
    { id: "api",         label: "API + Tokens",   icon: <Key className="size-4" /> },
    { id: "lab",         label: "Lab Automation", icon: <FlaskConical className="size-4" /> },
    { id: "diagnostics", label: "Diagnostics",    icon: <Activity className="size-4" /> },
  ];

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-3.5rem)] sm:-mx-6 md:-my-8 lg:-mx-8">
      {/* Left rail */}
      <aside className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border bg-card px-3 py-5">
        <p className="px-2 pb-3 text-[10.5px] font-semibold uppercase tracking-widest text-muted-foreground">
          Settings
        </p>
        {navItems.map((n) => (
          <button
            key={n.id}
            onClick={() => setActive(n.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] transition-colors",
              n.id === active
                ? "bg-primary/10 font-medium text-primary"
                : "text-foreground hover:bg-muted"
            )}
          >
            {n.icon}
            <span>{n.label}</span>
            {n.pip && (
              <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {n.pip}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <p className="px-2 text-[10.5px] leading-relaxed text-muted-foreground">
          Values stored encrypted in DB.
          <br />
          Never exposed via GET.
        </p>
      </aside>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading && <LoadingState />}
        {error && <ErrorState message={error.message} />}

        {!isLoading && !error && (
          <>
            {active === "general"     && <GeneralSection     settings={settings} />}
            {active === "marketplace" && <MarketplaceSection settings={settings} />}
            {active === "api"         && <ApiSection         settings={settings} />}
            {active === "lab"         && <LabSection         settings={settings} />}
            {active === "diagnostics" && <DiagnosticsSection settings={settings} />}
          </>
        )}
      </main>
    </div>
  );
}
