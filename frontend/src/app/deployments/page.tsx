"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ModelDeployment, Server } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<ModelDeployment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [servers, setServers] = useState<Server[]>([]);
  const [form, setForm] = useState({
    server_id: "",
    model_name: "",
    model_alias: "",
    quantization: "",
    remote_port: "8000",
    litellm_route_name: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    api.deployments.list()
      .then((res) => { setDeployments(res.items); setTotal(res.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (showForm && servers.length === 0) {
      api.servers.list(0, 100).then((res) => setServers(res.items));
    }
  }, [showForm, servers.length]);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.server_id || !form.model_name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.deployments.create({
        server_id: form.server_id,
        model_name: form.model_name.trim(),
        model_alias: form.model_alias.trim() || undefined,
        quantization: form.quantization.trim() || undefined,
        remote_port: parseInt(form.remote_port) || 8000,
        litellm_route_name: form.litellm_route_name.trim() || undefined,
      });
      setForm({ server_id: "", model_name: "", model_alias: "", quantization: "", remote_port: "8000", litellm_route_name: "" });
      setShowForm(false);
      load();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Deployments</h1>
          {!loading && <p className="mt-0.5 text-sm text-zinc-500">{total} total</p>}
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-sm">
          {showForm ? "Cancel" : "New deployment"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card px-5 py-4 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-300">New model deployment</h2>
          {createError && <p className="text-xs text-rose-400">{createError}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Server</label>
              <select
                className="input w-full text-sm"
                value={form.server_id}
                onChange={(e) => setField("server_id", e.target.value)}
                required
              >
                <option value="">Select a server…</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.hostname} ({s.gpu_model ?? "no GPU"}) — {s.status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Model name</label>
              <input
                className="input w-full text-sm"
                placeholder="meta-llama/Llama-3-8b-instruct"
                value={form.model_name}
                onChange={(e) => setField("model_name", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Alias <span className="text-zinc-600">(optional)</span></label>
              <input
                className="input w-full text-sm"
                placeholder="llama3-8b"
                value={form.model_alias}
                onChange={(e) => setField("model_alias", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Quantization <span className="text-zinc-600">(optional)</span></label>
              <input
                className="input w-full text-sm"
                placeholder="awq, gptq, fp8…"
                value={form.quantization}
                onChange={(e) => setField("quantization", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Remote port</label>
              <input
                className="input w-full text-sm"
                type="number"
                value={form.remote_port}
                onChange={(e) => setField("remote_port", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">LiteLLM route <span className="text-zinc-600">(optional)</span></label>
              <input
                className="input w-full text-sm"
                placeholder="llama3"
                value={form.litellm_route_name}
                onChange={(e) => setField("litellm_route_name", e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={creating || !form.server_id || !form.model_name.trim()} className="btn-primary text-sm">
              {creating ? "Creating…" : "Create deployment"}
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}
      {error && <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>}
      {!loading && !error && deployments.length === 0 && !showForm && (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-zinc-500">No deployments yet.</p>
          <p className="text-xs text-zinc-600">Create a deployment from a provisioned server.</p>
        </div>
      )}

      <div className="space-y-2">
        {deployments.map((d) => (
          <div key={d.id} className="card flex items-start gap-4 px-5 py-4">
            <StatusBadge status={d.status} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-zinc-100">{d.model_name}</p>
              {d.model_alias && (
                <p className="text-xs text-zinc-500">alias: {d.model_alias}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                <span>port {d.remote_port}</span>
                {d.quantization && <span>{d.quantization}</span>}
                {d.litellm_route_name && <span>route: {d.litellm_route_name}</span>}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs text-zinc-500">
              {d.started_at
                ? <p>Started {new Date(d.started_at).toLocaleDateString()}</p>
                : <p>Not started</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
