"use client";

import { useState } from "react";
import { useSettings, useSaveSetting, useDeleteSetting, useCloreBalance } from "@/lib/queries";
import type { SettingEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layouts/page-header";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

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
  anthropic_api_key: {
    label: "Anthropic API Key",
    description: "Used by the Lab page to convert command history into Ansible playbooks via Claude Haiku.",
    placeholder: "sk-ant-…",
    inputType: "password",
  },
  ssh_private_key: {
    label: "Platform SSH Private Key",
    description:
      "PEM private key used to connect to servers rented via SSH key auth. When you rent a server and provide your SSH public key to Clore, this private key is automatically stored on the new server record so terminal sessions can connect.",
    placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----",
    inputType: "textarea",
  },
  clore_min_pcie_gen: {
    label: "Min PCIe Generation",
    description:
      "Exclude servers below this PCIe generation. PCIe < 3 creates GPU↔host bandwidth bottlenecks for inference workloads. Recommended: 3.",
    placeholder: "e.g. 3",
  },
  clore_min_pcie_width: {
    label: "Min PCIe Width",
    description:
      "Exclude servers with a PCIe link narrower than this. x8 is the minimum for reliable inference throughput. Recommended: 8.",
    placeholder: "e.g. 8",
  },
  clore_min_disk_gb: {
    label: "Min Disk (GB)",
    description:
      "Exclude servers with less total storage than this. 100 GB is the practical minimum for a single large model. Recommended: 100.",
    placeholder: "e.g. 100",
  },
  clore_min_dl_mbps: {
    label: "Min Download Speed (Mbps)",
    description: "Exclude servers with download bandwidth below this threshold.",
    placeholder: "e.g. 500",
  },
  clore_min_ul_mbps: {
    label: "Min Upload Speed (Mbps)",
    description: "Exclude servers with upload bandwidth below this threshold.",
    placeholder: "e.g. 200",
  },
  clore_min_cuda: {
    label: "Min CUDA Version",
    description:
      "Exclude servers running a CUDA version older than this. Use major.minor format.",
    placeholder: "e.g. 12.0",
  },
  clore_min_vram_gb: {
    label: "Min Total VRAM (GB)",
    description:
      "Exclude servers whose total VRAM (gpu_count × per_gpu_vram) is below this. Useful for filtering out single-GPU rigs that can't load your target models.",
    placeholder: "e.g. 24",
  },
};

const API_KEY_KEYS = ["clore_api_key", "anthropic_api_key"];
const SSH_KEY_KEYS = ["ssh_private_key"];
const CLORE_FILTER_KEYS = [
  "clore_min_pcie_gen",
  "clore_min_pcie_width",
  "clore_min_disk_gb",
  "clore_min_dl_mbps",
  "clore_min_ul_mbps",
  "clore_min_cuda",
  "clore_min_vram_gb",
];

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

function SettingCard({ setting, meta }: { setting: SettingEntry; meta: SettingMeta }) {
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();
  const [input, setInput] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleSave() {
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

  function handleDelete() {
    setConfirmOpen(true);
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
    <Card className="px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{meta.label}</p>
            <ConfiguredBadge configured={setting.is_configured} />
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{meta.description}</p>
          {setting.updated_at && (
            <p className="mt-0.5 text-xs text-muted-foreground/50">
              Last updated {new Date(setting.updated_at).toLocaleString()}
            </p>
          )}
        </div>
        {setting.is_configured && (
          <Button
            variant="destructive"
            size="sm"
            loading={deleteSetting.isPending}
            onClick={handleDelete}
          >
            Clear
          </Button>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        {isTextarea ? (
          <textarea
            className="input flex-1 resize-none font-mono text-xs"
            rows={5}
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
        <Button
          onClick={handleSave}
          loading={saveSetting.isPending}
          disabled={!input.trim()}
        >
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
    </Card>
  );
}

function BalanceCard({ cloreConfigured }: { cloreConfigured: boolean }) {
  const { data: balance, isLoading, error, refetch } = useCloreBalance(cloreConfigured);
  if (!cloreConfigured) return null;

  return (
    <Card className="px-6 py-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Clore.ai Balance</p>
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
            <div key={w.currency} className="rounded-lg bg-muted/40 px-4 py-3 min-w-[120px]">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{w.currency}</p>
              <p className="mt-1 text-xl font-bold">
                {w.currency.toLowerCase().includes("usd") ? "$" : ""}{w.amount.toFixed(4)}
              </p>
            </div>
          ))}
        </div>
      )}
      {isLoading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          Loading balance…
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { data, isLoading, error } = useSettings();
  const settings: SettingEntry[] = data?.settings ?? [];
  const cloreConfigured = settings.find((s) => s.key === "clore_api_key")?.is_configured ?? false;

  function renderSection(keys: string[]) {
    return keys.map((key) => {
      const setting = settings.find((s) => s.key === key);
      const meta = SETTING_META[key];
      if (!setting || !meta) return null;
      return <SettingCard key={key} setting={setting} meta={meta} />;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="API keys and platform configuration stored in DB; values are write-only and can be cleared."
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error.message} />}

      {!isLoading && !error && (
        <>
          <BalanceCard cloreConfigured={cloreConfigured} />

          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">API Keys</p>
          <div className="space-y-4">{renderSection(API_KEY_KEYS)}</div>

          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Clore Global Filters</p>
          <Card className="px-6 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Quality bar for GPU marketplace</p>
            <p className="text-xs text-muted-foreground">
              These filters apply globally to both the Marketplace and GPU Finder pages.
              The offer list is cached for 10 minutes — saving or clearing a filter immediately
              invalidates the cache so the next page load reflects the updated criteria.
              All fields are optional; leave blank to apply no filter on that dimension.
            </p>
          </Card>
          <div className="space-y-4">{renderSection(CLORE_FILTER_KEYS)}</div>

          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">SSH</p>
          <Card className="px-6 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">How SSH key auth works with Clore rentals</p>
            <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
              <li>You generate a key pair: <code className="text-foreground/70">ssh-keygen -t ed25519</code></li>
              <li>The <strong>public key</strong> (e.g. <code className="text-foreground/70">~/.ssh/id_ed25519.pub</code>) is sent to Clore and injected into the container&apos;s <code className="text-foreground/70">authorized_keys</code></li>
              <li>The <strong>private key</strong> stored here is automatically saved on new Server records so the platform can open terminal sessions without a password</li>
              <li>If you use password auth instead, the password is stored on the Server record directly</li>
            </ul>
          </Card>
          <div className="space-y-4">{renderSection(SSH_KEY_KEYS)}</div>
        </>
      )}
    </div>
  );
}
