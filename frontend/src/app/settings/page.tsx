"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CloreBalance, SettingEntry } from "@/lib/types";

interface SettingMeta {
  label: string;
  description: string;
  placeholder: string;
  inputType?: "password" | "text" | "textarea";
  sensitive?: boolean;
}

const SETTING_META: Record<string, SettingMeta> = {
  clore_api_key: {
    label: "Clore.ai API Key",
    description: "Required to browse the GPU marketplace, rent servers, and manage rentals.",
    placeholder: "Paste your Clore.ai API key…",
    inputType: "password",
    sensitive: true,
  },
  anthropic_api_key: {
    label: "Anthropic API Key",
    description: "Used by the Lab page to convert command history into Ansible playbooks via Claude Haiku.",
    placeholder: "sk-ant-…",
    inputType: "password",
    sensitive: true,
  },
  ssh_private_key: {
    label: "Platform SSH Private Key",
    description:
      "PEM private key used to connect to servers rented via SSH key auth. When you rent a server and provide your SSH public key to Clore, this private key is automatically stored on the new server record so terminal sessions can connect.",
    placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----",
    inputType: "textarea",
    sensitive: true,
  },
};

// Keys shown in the API Keys section
const API_KEY_KEYS = ["clore_api_key", "anthropic_api_key"];
// Keys shown in the SSH section
const SSH_KEY_KEYS = ["ssh_private_key"];

function ConfiguredBadge({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-900 bg-emerald-950/40 px-2.5 py-0.5 text-xs text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-0.5 text-xs text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
      Not configured
    </span>
  );
}

function SettingCard({
  setting,
  meta,
  onSaved,
  onDeleted,
}: {
  setting: SettingEntry;
  meta: SettingMeta;
  onSaved: (updated: SettingEntry) => void;
  onDeleted: (key: string) => void;
}) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const value = input.trim();
    if (!value) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.settings.set(setting.key, value);
      onSaved(updated);
      setInput("");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Clear "${meta.label}"? The value will be removed from the database. Environment variable fallback (if any) will still apply.`)) return;
    setDeleting(true);
    setError("");
    try {
      await api.settings.delete(setting.key);
      onDeleted(setting.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const isTextarea = meta.inputType === "textarea";

  return (
    <div className="card px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-zinc-100">{meta.label}</p>
            <ConfiguredBadge configured={setting.is_configured} />
          </div>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">{meta.description}</p>
          {setting.updated_at && (
            <p className="mt-0.5 text-xs text-zinc-600">
              Last updated {new Date(setting.updated_at).toLocaleString()}
            </p>
          )}
        </div>
        {setting.is_configured && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn-danger shrink-0 py-1 px-3 text-xs disabled:opacity-40"
          >
            {deleting ? "Clearing…" : "Clear"}
          </button>
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
          <input
            type={meta.inputType ?? "text"}
            className="input flex-1"
            placeholder={meta.placeholder}
            value={input}
            autoComplete="off"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isTextarea && handleSave()}
          />
        )}
        <button
          className="btn-primary shrink-0"
          onClick={handleSave}
          disabled={!input.trim() || saving}
        >
          {saving ? "Saving…" : justSaved ? "Saved ✓" : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function BalanceCard({ cloreConfigured }: { cloreConfigured: boolean }) {
  const [balance, setBalance] = useState<CloreBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api.clore
      .balance()
      .then(setBalance)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (cloreConfigured) load();
  }, [cloreConfigured]);

  if (!cloreConfigured) return null;

  return (
    <div className="card px-6 py-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-zinc-100">Clore.ai Balance</p>
        <button onClick={load} disabled={loading} className="btn-ghost text-xs py-1 px-2">
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      {!loading && !error && balance && (
        <div className="mt-3 flex flex-wrap gap-3">
          {balance.balances.length === 0 && (
            <p className="text-sm text-zinc-500">No wallet data available.</p>
          )}
          {balance.balances.map((w) => (
            <div key={w.currency} className="rounded-lg bg-zinc-900/60 px-4 py-3 min-w-[120px]">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{w.currency}</p>
              <p className="mt-1 text-xl font-bold text-zinc-100">
                {w.currency.toLowerCase().includes("usd") ? "$" : ""}{w.amount.toFixed(4)}
              </p>
            </div>
          ))}
        </div>
      )}
      {loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading balance…
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.settings
      .list()
      .then((data) => setSettings(data.settings))
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function handleSaved(updated: SettingEntry) {
    setSettings((prev) => prev.map((s) => (s.key === updated.key ? updated : s)));
  }

  function handleDeleted(key: string) {
    setSettings((prev) =>
      prev.map((s) => (s.key === key ? { ...s, is_configured: false, updated_at: null } : s))
    );
  }

  const cloreConfigured = settings.find((s) => s.key === "clore_api_key")?.is_configured ?? false;

  function renderSection(keys: string[]) {
    return keys.map((key) => {
      const setting = settings.find((s) => s.key === key);
      const meta = SETTING_META[key];
      if (!setting || !meta) return null;
      return (
        <SettingCard
          key={key}
          setting={setting}
          meta={meta}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      );
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          API keys and platform configuration — stored in DB, takes precedence over env vars.
          Values are write-only; use Clear to remove.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}
      {loadError && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">
          {loadError}
        </p>
      )}

      {!loading && !loadError && (
        <>
          <BalanceCard cloreConfigured={cloreConfigured} />

          <p className="section-label">API Keys</p>
          <div className="space-y-4">{renderSection(API_KEY_KEYS)}</div>

          <p className="section-label">SSH</p>
          <div className="card px-6 py-4 mb-2 text-sm text-zinc-400 bg-zinc-900/40">
            <p className="font-medium text-zinc-300 mb-1">How SSH key auth works with Clore rentals</p>
            <ul className="list-disc list-inside space-y-1 text-xs text-zinc-500">
              <li>You generate a key pair: <code className="text-zinc-400">ssh-keygen -t ed25519</code></li>
              <li>The <strong>public key</strong> (e.g. <code className="text-zinc-400">~/.ssh/id_ed25519.pub</code>) is sent to Clore and injected into the container&apos;s <code className="text-zinc-400">authorized_keys</code></li>
              <li>The <strong>private key</strong> stored here is automatically saved on new Server records so the platform can open terminal sessions without a password</li>
              <li>If you use password auth instead, the password is stored on the Server record directly</li>
            </ul>
          </div>
          <div className="space-y-4">{renderSection(SSH_KEY_KEYS)}</div>
        </>
      )}
    </div>
  );
}
