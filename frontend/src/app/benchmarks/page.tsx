"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { InferenceBenchmark, InferenceBenchmarkCreate } from "@/lib/types";

const EMPTY_FORM: InferenceBenchmarkCreate = {
  gpu_model: "",
  gpu_vram_gb: null,
  model_name: "",
  model_family: null,
  quantization: null,
  tokens_per_second_avg: null,
  tokens_per_second_p95: null,
  max_parallel_connections: null,
  vram_used_gb: null,
  measured_at: null,
  notes: null,
};

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<InferenceBenchmark[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [gpuFilter, setGpuFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InferenceBenchmarkCreate>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.benchmarks
      .list(gpuFilter || undefined, modelFilter || undefined)
      .then((res) => { setBenchmarks(res.items); setTotal(res.total); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.benchmarks.create(form);
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this benchmark record?")) return;
    await api.benchmarks.delete(id);
    load();
  }

  function setField<K extends keyof InferenceBenchmarkCreate>(key: K, value: InferenceBenchmarkCreate[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function numField(key: keyof InferenceBenchmarkCreate, value: string) {
    setField(key, value === "" ? null : (Number(value) as never));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Inference Benchmarks</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Token throughput and concurrency data across GPU × model combinations.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-sm">
          {showForm ? "Cancel" : "Record benchmark"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card px-6 py-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-300">New benchmark record</h2>

          {saveError && (
            <p className="text-xs text-rose-400">{saveError}</p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="GPU model *">
              <input required className="input w-full text-sm" value={form.gpu_model}
                onChange={(e) => setField("gpu_model", e.target.value)} placeholder="RTX 4090" />
            </FormField>
            <FormField label="GPU VRAM (GB)">
              <input type="number" className="input w-full text-sm" value={form.gpu_vram_gb ?? ""}
                onChange={(e) => numField("gpu_vram_gb", e.target.value)} placeholder="24" />
            </FormField>
            <FormField label="Model name *">
              <input required className="input w-full text-sm" value={form.model_name}
                onChange={(e) => setField("model_name", e.target.value)} placeholder="meta-llama/Llama-3.1-8B-Instruct" />
            </FormField>
            <FormField label="Model family">
              <input className="input w-full text-sm" value={form.model_family ?? ""}
                onChange={(e) => setField("model_family", e.target.value || null)} placeholder="llama3" />
            </FormField>
            <FormField label="Quantization">
              <input className="input w-full text-sm" value={form.quantization ?? ""}
                onChange={(e) => setField("quantization", e.target.value || null)} placeholder="fp16 / Q4_K_M / awq" />
            </FormField>
            <FormField label="Tokens/sec avg">
              <input type="number" step="0.1" className="input w-full text-sm" value={form.tokens_per_second_avg ?? ""}
                onChange={(e) => numField("tokens_per_second_avg", e.target.value)} placeholder="120.5" />
            </FormField>
            <FormField label="Tokens/sec p95">
              <input type="number" step="0.1" className="input w-full text-sm" value={form.tokens_per_second_p95 ?? ""}
                onChange={(e) => numField("tokens_per_second_p95", e.target.value)} placeholder="98.3" />
            </FormField>
            <FormField label="Max parallel connections">
              <input type="number" className="input w-full text-sm" value={form.max_parallel_connections ?? ""}
                onChange={(e) => numField("max_parallel_connections", e.target.value)} placeholder="8" />
            </FormField>
            <FormField label="VRAM used (GB)">
              <input type="number" step="0.1" className="input w-full text-sm" value={form.vram_used_gb ?? ""}
                onChange={(e) => numField("vram_used_gb", e.target.value)} placeholder="18.4" />
            </FormField>
            <FormField label="Measured at">
              <input type="datetime-local" className="input w-full text-sm" value={form.measured_at ?? ""}
                onChange={(e) => setField("measured_at", e.target.value || null)} />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-2">
              <FormField label="Notes">
                <input className="input w-full text-sm" value={form.notes ?? ""}
                  onChange={(e) => setField("notes", e.target.value || null)} placeholder="vLLM v0.4.0, batch size 1" />
              </FormField>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setShowForm(false)} className="btn-ghost text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? "Saving…" : "Save benchmark"}
            </button>
          </div>
        </form>
      )}

      {/* Search / filter bar */}
      <div className="flex flex-wrap gap-3">
        <input
          className="input text-sm w-56"
          placeholder="GPU model filter…"
          value={gpuFilter}
          onChange={(e) => setGpuFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <input
          className="input text-sm w-72"
          placeholder="Model name filter…"
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className="btn-secondary text-sm py-1.5 px-4">Search</button>
        {(gpuFilter || modelFilter) && (
          <button onClick={() => { setGpuFilter(""); setModelFilter(""); }}
            className="text-xs text-zinc-500 hover:text-zinc-300">
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}

      {!loading && benchmarks.length === 0 && (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm text-zinc-500">No benchmark records yet.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Record your first benchmark after deploying a model.
          </p>
          <button onClick={() => setShowForm(true)} className="mt-4 btn-primary text-sm">
            Record benchmark
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && benchmarks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-600">{total} record{total !== 1 ? "s" : ""}</p>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60">
                <tr>
                  {["GPU", "Model", "Quant", "Tok/s avg", "Tok/s p95", "Parallel", "VRAM used", "Measured"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {benchmarks.map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-900/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-200 whitespace-nowrap">
                      <div>{b.gpu_model}</div>
                      {b.gpu_vram_gb != null && (
                        <div className="text-xs text-zinc-600">{b.gpu_vram_gb} GB VRAM</div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <div className="truncate text-zinc-300">{b.model_name}</div>
                      {b.model_family && (
                        <div className="text-xs text-zinc-600">{b.model_family}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {b.quantization ?? <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-100 whitespace-nowrap font-mono">
                      {b.tokens_per_second_avg != null
                        ? <><span className="text-emerald-400">{b.tokens_per_second_avg.toFixed(1)}</span><span className="text-zinc-600 text-xs"> t/s</span></>
                        : <span className="text-zinc-700">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap font-mono">
                      {b.tokens_per_second_p95 != null
                        ? `${b.tokens_per_second_p95.toFixed(1)} t/s`
                        : <span className="text-zinc-700">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {b.max_parallel_connections != null
                        ? `${b.max_parallel_connections} req`
                        : <span className="text-zinc-700">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {b.vram_used_gb != null
                        ? `${b.vram_used_gb.toFixed(1)} GB`
                        : <span className="text-zinc-700">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                      {b.measured_at
                        ? new Date(b.measured_at).toLocaleDateString()
                        : new Date(b.created_at).toLocaleDateString()
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="text-xs text-zinc-600 hover:text-rose-400 transition-colors"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      {children}
    </div>
  );
}
