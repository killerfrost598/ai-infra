"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiKey } from "@/lib/types";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyPrefix, setKeyPrefix] = useState("");
  const [providerName, setProviderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [revoking, setRevoking] = useState<string | null>(null);

  function load() {
    api.apiKeys
      .list()
      .then((res) => setKeys(res.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim() || !keyPrefix.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.apiKeys.create(keyName.trim(), keyPrefix.trim(), providerName.trim() || undefined);
      setKeyName(""); setKeyPrefix(""); setProviderName("");
      setShowForm(false);
      load();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke API key "${name}"? This cannot be undone.`)) return;
    setRevoking(id);
    try {
      await api.apiKeys.revoke(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">API Keys</h1>
          {!loading && (
            <p className="mt-0.5 text-sm text-zinc-500">{keys.length} key{keys.length !== 1 ? "s" : ""}</p>
          )}
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-sm">
          {showForm ? "Cancel" : "Add key"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">New API key</h2>
          {createError && <p className="text-xs text-rose-400">{createError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Name</label>
              <input
                className="input w-full text-sm"
                placeholder="My OpenAI key"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Key prefix</label>
              <input
                className="input w-full text-sm font-mono"
                placeholder="sk-..."
                value={keyPrefix}
                onChange={(e) => setKeyPrefix(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Provider <span className="text-zinc-600">(optional)</span></label>
              <input
                className="input w-full text-sm"
                placeholder="openai"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={creating || !keyName.trim() || !keyPrefix.trim()} className="btn-primary text-sm">
              {creating ? "Adding…" : "Add key"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}
      {!loading && !error && keys.length === 0 && !showForm && (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm text-zinc-500">No API keys registered yet.</p>
        </div>
      )}

      <div className="space-y-2">
        {keys.map((k) => (
          <div key={k.id} className="card flex items-center gap-4 px-5 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-zinc-200">{k.key_name}</p>
                {k.is_revoked && (
                  <span className="rounded-full bg-rose-950 px-2 py-0.5 text-[10px] font-medium text-rose-400">revoked</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
                <span className="font-mono">{k.key_prefix}…</span>
                {k.provider_name && <span>{k.provider_name}</span>}
              </div>
            </div>
            {!k.is_revoked && (
              <button
                onClick={() => handleRevoke(k.id, k.key_name)}
                disabled={revoking === k.id}
                className="btn-danger text-xs py-1.5 px-3 shrink-0"
              >
                {revoking === k.id ? "Revoking…" : "Revoke"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
