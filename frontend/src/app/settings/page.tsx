"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SettingEntry } from "@/lib/types";

interface SettingMeta {
  label: string;
  description: string;
  placeholder: string;
}

const SETTING_META: Record<string, SettingMeta> = {
  clore_api_key: {
    label: "Clore.ai API Key",
    description:
      "Required to browse the GPU marketplace, rent servers, and manage rentals. Optional — the app functions without it for direct SSH workflows.",
    placeholder: "Paste your Clore.ai API key…",
  },
  litellm_master_key: {
    label: "LiteLLM Master Key",
    description:
      "Authenticates requests to the LiteLLM proxy router for unified OpenAI-compatible model access.",
    placeholder: "Paste your LiteLLM master key…",
  },
};

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

interface SettingCardProps {
  setting: SettingEntry;
  meta: SettingMeta;
  onSaved: (updated: SettingEntry) => void;
}

function SettingCard({ setting, meta, onSaved }: SettingCardProps) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
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
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="password"
          className="input flex-1"
          placeholder={meta.placeholder}
          value={input}
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
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
    setSettings((prev) =>
      prev.map((s) => (s.key === updated.key ? updated : s))
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Platform-wide configuration stored in the database — takes precedence over environment variables
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
          <p className="section-label">Integrations</p>
          <div className="space-y-4">
            {settings.map((s) => {
              const meta = SETTING_META[s.key];
              if (!meta) return null;
              return <SettingCard key={s.key} setting={s} meta={meta} onSaved={handleSaved} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}
