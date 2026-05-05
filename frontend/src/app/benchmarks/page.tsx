"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useBenchmarks, useCreateBenchmark, useDeleteBenchmark } from "@/lib/queries";
import type { InferenceBenchmark, InferenceBenchmarkCreate } from "@/lib/types";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layouts/page-header";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

const EMPTY_FORM: InferenceBenchmarkCreate = {
  gpu_model: "", gpu_vram_gb: null, model_name: "", model_family: null,
  quantization: null, tokens_per_second_avg: null, tokens_per_second_p95: null,
  max_parallel_connections: null, vram_used_gb: null, measured_at: null, notes: null,
};

export default function BenchmarksPage() {
  const [gpuFilter, setGpuFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [searchGpu, setSearchGpu] = useState("");
  const [searchModel, setSearchModel] = useState("");

  const { data, isLoading, error } = useBenchmarks(searchGpu, searchModel);
  const benchmarks: InferenceBenchmark[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const createBenchmark = useCreateBenchmark();
  const deleteBenchmark = useDeleteBenchmark();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InferenceBenchmarkCreate>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InferenceBenchmark | null>(null);

  function setField<K extends keyof InferenceBenchmarkCreate>(key: K, value: InferenceBenchmarkCreate[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function numField(key: keyof InferenceBenchmarkCreate, value: string) {
    setField(key, value === "" ? null : (Number(value) as never));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    createBenchmark.mutate(form, {
      onSuccess: () => { setShowForm(false); setForm(EMPTY_FORM); },
      onError: (err) => setSaveError(err.message),
    });
  }

  function handleSearch() { setSearchGpu(gpuFilter); setSearchModel(modelFilter); }

  function handleClear() {
    setGpuFilter(""); setModelFilter(""); setSearchGpu(""); setSearchModel("");
  }

  const columns: ColumnDef<InferenceBenchmark>[] = [
    {
      accessorKey: "gpu_model",
      header: "GPU",
      cell: ({ row }) => (
        <div>
          <div className="font-medium whitespace-nowrap">{row.original.gpu_model}</div>
          {row.original.gpu_vram_gb != null && (
            <div className="text-xs text-muted-foreground/60">{row.original.gpu_vram_gb} GB VRAM</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "model_name",
      header: "Model",
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <div className="truncate">{row.original.model_name}</div>
          {row.original.model_family && (
            <div className="text-xs text-muted-foreground/60">{row.original.model_family}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "quantization",
      header: "Quant",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {(getValue() as string | null) ?? <span className="text-muted-foreground/30">—</span>}
        </span>
      ),
    },
    {
      accessorKey: "tokens_per_second_avg",
      header: "Tok/s avg",
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null ? (
          <span className="font-mono whitespace-nowrap">
            <span className="text-emerald-600 dark:text-emerald-400">{v.toFixed(1)}</span>
            <span className="text-muted-foreground/50 text-xs"> t/s</span>
          </span>
        ) : <span className="text-muted-foreground/30">—</span>;
      },
    },
    {
      accessorKey: "tokens_per_second_p95",
      header: "Tok/s p95",
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null
          ? <span className="font-mono text-muted-foreground whitespace-nowrap">{v.toFixed(1)} t/s</span>
          : <span className="text-muted-foreground/30">—</span>;
      },
    },
    {
      accessorKey: "max_parallel_connections",
      header: "Parallel",
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null
          ? <span className="text-muted-foreground whitespace-nowrap">{v} req</span>
          : <span className="text-muted-foreground/30">—</span>;
      },
    },
    {
      accessorKey: "vram_used_gb",
      header: "VRAM used",
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null
          ? <span className="text-muted-foreground whitespace-nowrap">{v.toFixed(1)} GB</span>
          : <span className="text-muted-foreground/30">—</span>;
      },
    },
    {
      id: "measured",
      header: "Measured",
      cell: ({ row }) => {
        const d = row.original.measured_at ?? row.original.created_at;
        return <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(d).toLocaleDateString()}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={() => setPendingDelete(row.original)}
          disabled={deleteBenchmark.isPending}
          className="text-xs text-muted-foreground/40 hover:text-destructive transition-colors"
          title="Delete"
        >
          ✕
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inference Benchmarks"
        description="Token throughput and concurrency data across GPU × model combinations."
        actions={(
          <Button onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "Record benchmark"}
          </Button>
        )}
      />

      {showForm && (
        <Card className="px-6 py-5 space-y-4">
          <h2 className="text-sm font-semibold">New benchmark record</h2>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="GPU model *">
                <Input required value={form.gpu_model}
                  onChange={(e) => setField("gpu_model", e.target.value)} placeholder="RTX 4090" />
              </FormField>
              <FormField label="GPU VRAM (GB)">
                <Input type="number" value={form.gpu_vram_gb ?? ""}
                  onChange={(e) => numField("gpu_vram_gb", e.target.value)} placeholder="24" />
              </FormField>
              <FormField label="Model name *">
                <Input required value={form.model_name}
                  onChange={(e) => setField("model_name", e.target.value)} placeholder="meta-llama/Llama-3.1-8B-Instruct" />
              </FormField>
              <FormField label="Model family">
                <Input value={form.model_family ?? ""}
                  onChange={(e) => setField("model_family", e.target.value || null)} placeholder="llama3" />
              </FormField>
              <FormField label="Quantization">
                <Input value={form.quantization ?? ""}
                  onChange={(e) => setField("quantization", e.target.value || null)} placeholder="fp16 / Q4_K_M / awq" />
              </FormField>
              <FormField label="Tokens/sec avg">
                <Input type="number" step="0.1" value={form.tokens_per_second_avg ?? ""}
                  onChange={(e) => numField("tokens_per_second_avg", e.target.value)} placeholder="120.5" />
              </FormField>
              <FormField label="Tokens/sec p95">
                <Input type="number" step="0.1" value={form.tokens_per_second_p95 ?? ""}
                  onChange={(e) => numField("tokens_per_second_p95", e.target.value)} placeholder="98.3" />
              </FormField>
              <FormField label="Max parallel connections">
                <Input type="number" value={form.max_parallel_connections ?? ""}
                  onChange={(e) => numField("max_parallel_connections", e.target.value)} placeholder="8" />
              </FormField>
              <FormField label="VRAM used (GB)">
                <Input type="number" step="0.1" value={form.vram_used_gb ?? ""}
                  onChange={(e) => numField("vram_used_gb", e.target.value)} placeholder="18.4" />
              </FormField>
              <FormField label="Measured at">
                <Input type="datetime-local" value={form.measured_at ?? ""}
                  onChange={(e) => setField("measured_at", e.target.value || null)} />
              </FormField>
              <div className="sm:col-span-2 lg:col-span-2">
                <FormField label="Notes">
                  <Input value={form.notes ?? ""}
                    onChange={(e) => setField("notes", e.target.value || null)} placeholder="vLLM v0.4.0, batch size 1" />
                </FormField>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" loading={createBenchmark.isPending}>Save benchmark</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Input
          className="w-56"
          placeholder="GPU model filter…"
          value={gpuFilter}
          onChange={(e) => setGpuFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Input
          className="w-72"
          placeholder="Model name filter…"
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button variant="outline" onClick={handleSearch}>Search</Button>
        {(gpuFilter || modelFilter) && (
          <Button variant="ghost" size="sm" onClick={handleClear}>Clear</Button>
        )}
      </div>

      {error && <ErrorState message={error.message} />}
      {isLoading && <LoadingState />}

      {!isLoading && (
        <>
          {benchmarks.length > 0 && (
            <p className="text-xs text-muted-foreground/60">{total} record{total !== 1 ? "s" : ""}</p>
          )}
          <DataTable
            columns={columns}
            data={benchmarks}
            emptyMessage="No benchmark records yet. Record your first benchmark after deploying a model."
          />
        </>
      )}

      <ConfirmActionDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete benchmark record?"
        description={pendingDelete ? `${pendingDelete.gpu_model} · ${pendingDelete.model_name}` : "This benchmark record will be removed."}
        confirmLabel="Delete Record"
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteBenchmark.mutate(pendingDelete.id, {
            onSettled: () => setPendingDelete(null),
          });
        }}
      />
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
