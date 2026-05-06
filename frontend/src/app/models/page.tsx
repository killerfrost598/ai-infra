"use client";

import { Suspense, useState, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import type { ModelEntry, ModelQuant } from "@/lib/types";
import { findGpuProfile, quantFitsGpu } from "@/lib/gpu-profiles";
import type { GpuProfile } from "@/lib/gpu-profiles";
import { useSettings } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layouts/page-header";
import { LoadingState, EmptyState } from "@/components/layouts/page-states";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ModelEditDialog } from "@/components/models/ModelEditDialog";
import { QuantEditDialog } from "@/components/models/QuantEditDialog";
import { SeedModelDialog } from "@/components/models/SeedModelDialog";
import { FilterRail } from "@/components/models/FilterRail";
import { ModelCard } from "@/components/models/ModelCard";

// ── Dialog state union ────────────────────────────────────────────────────────

type DialogState =
  | { kind: "none" }
  | { kind: "seed" }
  | { kind: "add-model" }
  | { kind: "edit-model"; model: ModelEntry }
  | { kind: "add-quant"; model: ModelEntry }
  | { kind: "edit-quant"; model: ModelEntry; quant: ModelQuant };

type PendingDelete =
  | { kind: "none" }
  | { kind: "model"; id: string; name: string }
  | { kind: "quant"; modelId: string; quantId: string; quantName: string };

// ── Main content (needs Suspense wrapper for useSearchParams) ─────────────────

function ModelsPageContent() {
  const qc         = useQueryClient();
  const router     = useRouter();
  const pathname   = usePathname();
  const searchParams = useSearchParams();

  const [dialog, setDialog]               = useState<DialogState>({ kind: "none" });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>({ kind: "none" });

  const { data: settingsData } = useSettings();
  const rawExcluded = settingsData?.settings.find((s) => s.key === "excluded_quant_formats")?.value ?? "";
  const excludedFormats = new Set(
    rawExcluded.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  );

  // ── Read filters from URL ──────────────────────────────────────────────────
  const family      = searchParams.get("family")       ?? undefined;
  const search      = searchParams.get("search")       ?? undefined;
  const useCase     = searchParams.get("use_case")     ?? undefined;
  const tag         = searchParams.get("tag")          ?? undefined;
  const paramMin    = searchParams.get("param_min")    ? Number(searchParams.get("param_min"))   : undefined;
  const paramMax    = searchParams.get("param_max")    ? Number(searchParams.get("param_max"))   : undefined;
  const gated       = searchParams.get("gated")        ?? undefined;
  const quantFormat = searchParams.get("quant_format") ?? undefined;
  const sort        = searchParams.get("sort")         ?? undefined;
  const isReasoning = searchParams.get("is_reasoning") === "true" ? true : undefined;
  const isCodeModel = searchParams.get("is_code_model") === "true" ? true : undefined;
  const isMoe       = searchParams.get("is_moe")       === "true" ? true : undefined;
  const targetGpuKey = searchParams.get("target_gpu") ?? "";

  const targetGpu: GpuProfile | undefined = targetGpuKey
    ? findGpuProfile(targetGpuKey)
    : undefined;

  // ── Fetch models ───────────────────────────────────────────────────────────
  const { data: models = [], isLoading } = useQuery({
    queryKey: [
      "models",
      family, search, useCase, tag,
      paramMin, paramMax, gated, quantFormat, sort,
      isReasoning, isCodeModel, isMoe,
    ],
    queryFn: () =>
      api.models.list({
        family, search, use_case: useCase, tag,
        param_min: paramMin, param_max: paramMax,
        gated, quant_format: quantFormat, sort,
        is_reasoning: isReasoning,
        is_code_model: isCodeModel,
        is_moe: isMoe,
      }),
    staleTime: 30_000,
  });

  // Client-side GPU compat filter (target_gpu not yet in backend)
  const filteredModels = useMemo<ModelEntry[]>(() => {
    if (!targetGpu) return models;
    return models.filter((m) => m.quants.some((q) => quantFitsGpu(q, targetGpu, m.param_count_b)));
  }, [models, targetGpu]);

  const totalQuants = filteredModels.reduce((s, m) => s + m.quants.length, 0);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const deleteModel = useMutation({
    mutationFn: (id: string) => api.models.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success("Model deleted"); },
    onError: () => toast.error("Failed to delete model"),
  });

  const deleteQuant = useMutation({
    mutationFn: ({ modelId, quantId }: { modelId: string; quantId: string }) =>
      api.models.deleteQuant(modelId, quantId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); toast.success("Quant deleted"); },
    onError: () => toast.error("Failed to delete quant"),
  });

  function closeDialog() { setDialog({ kind: "none" }); }

  function confirmDelete() {
    if (pendingDelete.kind === "model") {
      deleteModel.mutate(pendingDelete.id, {
        onSettled: () => setPendingDelete({ kind: "none" }),
      });
    } else if (pendingDelete.kind === "quant") {
      deleteQuant.mutate(
        { modelId: pendingDelete.modelId, quantId: pendingDelete.quantId },
        { onSettled: () => setPendingDelete({ kind: "none" }) },
      );
    }
  }

  function setSearch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("search", value);
    else params.delete("search");
    router.replace(`${pathname}?${params.toString()}`);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Knowledge Base"
        description="GPU-compatible models with quantization metadata seeded from HuggingFace."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setDialog({ kind: "seed" })}>
              <Plus className="mr-1.5 size-3.5" /> Add from HuggingFace
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "add-model" })}>
              <Pencil className="mr-1.5 size-3.5" /> Manual
            </Button>
          </div>
        }
      />

      <div className="flex gap-6 items-start">
        {/* ── Filter rail ─────────────────────────────────────────────────── */}
        <FilterRail className="w-48 shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pb-6" />

        {/* ── Result list ─────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Search + count bar */}
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search models…"
              value={search ?? ""}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            {!isLoading && (
              <p className="shrink-0 text-xs text-muted-foreground">
                {filteredModels.length} models · {totalQuants} quants
              </p>
            )}
          </div>

          {isLoading && <LoadingState />}

          {!isLoading && filteredModels.length === 0 && (
            <EmptyState
              title="No models found"
              description={
                models.length > 0
                  ? "Try adjusting filters or the target GPU."
                  : "Add a model from HuggingFace to get started."
              }
            />
          )}

          {filteredModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              targetGpu={targetGpu}
              onEdit={() => setDialog({ kind: "edit-model", model })}
              onDelete={() => setPendingDelete({ kind: "model", id: model.id, name: model.name })}
              onAddQuant={() => setDialog({ kind: "add-quant", model })}
              onEditQuant={(q) => setDialog({ kind: "edit-quant", model, quant: q })}
              onDeleteQuant={(q) =>
                setPendingDelete({
                  kind: "quant",
                  modelId: model.id,
                  quantId: q.id,
                  quantName: q.name,
                })
              }
              excludedFormats={excludedFormats}
              activeFormatFilter={quantFormat ?? ""}
            />
          ))}
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      {dialog.kind === "seed" && (
        <SeedModelDialog open onOpenChange={(o) => { if (!o) closeDialog(); }} />
      )}
      {(dialog.kind === "add-model" || dialog.kind === "edit-model") && (
        <ModelEditDialog
          model={dialog.kind === "edit-model" ? dialog.model : null}
          open
          onOpenChange={(o) => { if (!o) closeDialog(); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["models"] });
            closeDialog();
          }}
        />
      )}
      {(dialog.kind === "add-quant" || dialog.kind === "edit-quant") && (
        <QuantEditDialog
          model={dialog.model}
          quant={dialog.kind === "edit-quant" ? dialog.quant : null}
          open
          onOpenChange={(o) => { if (!o) closeDialog(); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["models"] });
            closeDialog();
          }}
        />
      )}

      <ConfirmActionDialog
        open={pendingDelete.kind !== "none"}
        onOpenChange={(o) => { if (!o) setPendingDelete({ kind: "none" }); }}
        title={
          pendingDelete.kind === "model"
            ? `Delete ${pendingDelete.name}?`
            : pendingDelete.kind === "quant"
              ? `Delete quant "${pendingDelete.quantName}"?`
              : "Delete item?"
        }
        description={
          pendingDelete.kind === "model"
            ? "This removes the model and all its quantizations from the knowledge base."
            : "This removes the selected quantization."
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ── Page export (Suspense required by Next.js for useSearchParams) ─────────────

export default function ModelsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ModelsPageContent />
    </Suspense>
  );
}
