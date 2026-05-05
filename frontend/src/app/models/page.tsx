"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Plus, Upload, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ModelEntry, ModelQuant } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ModelEditDialog } from "@/components/models/ModelEditDialog";
import { QuantEditDialog } from "@/components/models/QuantEditDialog";
import { HfImportDialog } from "@/components/models/HfImportDialog";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { PageHeader } from "@/components/layouts/page-header";
import { EmptyState } from "@/components/layouts/page-states";

// ── Types ─────────────────────────────────────────────────────────────────────

type DialogState =
  | { kind: "none" }
  | { kind: "hf-import" }
  | { kind: "add-model" }
  | { kind: "edit-model"; model: ModelEntry }
  | { kind: "add-quant"; model: ModelEntry }
  | { kind: "edit-quant"; model: ModelEntry; quant: ModelQuant };

type PendingDeleteState =
  | { kind: "none" }
  | { kind: "model"; id: string; name: string }
  | { kind: "quant"; modelId: string; quantId: string; quantName: string };

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState>({ kind: "none" });

  const { data: models = [], isLoading } = useQuery({
    queryKey: ["models"],
    queryFn: () => api.models.list(),
  });

  const deleteModel = useMutation({
    mutationFn: (id: string) => api.models.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); qc.invalidateQueries({ queryKey: ["model-catalogue"] }); toast.success("Model deleted"); },
    onError: () => toast.error("Failed to delete model"),
  });

  const deleteQuant = useMutation({
    mutationFn: ({ modelId, quantId }: { modelId: string; quantId: string }) =>
      api.models.deleteQuant(modelId, quantId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["models"] }); qc.invalidateQueries({ queryKey: ["model-catalogue"] }); toast.success("Quant deleted"); },
    onError: () => toast.error("Failed to delete quant"),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.model_key.includes(q),
    );
  }, [models, search]);

  const byFamily = useMemo(() => {
    const map = new Map<string, ModelEntry[]>();
    for (const m of filtered) {
      const arr = map.get(m.family) ?? [];
      arr.push(m);
      map.set(m.family, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function closeDialog() {
    setDialog({ kind: "none" });
  }

  function confirmDelete() {
    if (pendingDelete.kind === "model") {
      deleteModel.mutate(pendingDelete.id, {
        onSettled: () => setPendingDelete({ kind: "none" }),
      });
      return;
    }
    if (pendingDelete.kind === "quant") {
      deleteQuant.mutate(
        { modelId: pendingDelete.modelId, quantId: pendingDelete.quantId },
        { onSettled: () => setPendingDelete({ kind: "none" }) }
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Knowledge Base"
        description="Manage model families, quantizations, and HuggingFace metadata used by finder workflows."
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "hf-import" })}>
              <Upload className="mr-1.5 size-3.5" /> Import from HuggingFace
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: "add-model" })}>
              <Plus className="mr-1.5 size-3.5" /> Add model
            </Button>
          </div>
        )}
      />

      <Input
        placeholder="Search models…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && byFamily.length === 0 && (
        <EmptyState
          title="No models yet"
          description="Import from HuggingFace or add manually."
        />
      )}

      <div className="space-y-4">
        {byFamily.map(([family, familyModels]) => (
          <FamilyGroup
            key={family}
            family={family}
            models={familyModels}
            onAddModel={() => setDialog({ kind: "add-model" })}
            onEditModel={(m) => setDialog({ kind: "edit-model", model: m })}
            onDeleteModel={(m) => setPendingDelete({ kind: "model", id: m.id, name: m.name })}
            onAddQuant={(m) => setDialog({ kind: "add-quant", model: m })}
            onEditQuant={(m, q) => setDialog({ kind: "edit-quant", model: m, quant: q })}
            onDeleteQuant={(m, q) => setPendingDelete({ kind: "quant", modelId: m.id, quantId: q.id, quantName: q.name })}
          />
        ))}
      </div>

      {/* Dialogs */}
      {(dialog.kind === "add-model" || dialog.kind === "edit-model") && (
        <ModelEditDialog
          model={dialog.kind === "edit-model" ? dialog.model : null}
          open
          onOpenChange={(o) => { if (!o) closeDialog(); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["models"] }); qc.invalidateQueries({ queryKey: ["model-catalogue"] }); closeDialog(); }}
        />
      )}
      {(dialog.kind === "add-quant" || dialog.kind === "edit-quant") && (
        <QuantEditDialog
          model={dialog.kind === "add-quant" ? dialog.model : dialog.model}
          quant={dialog.kind === "edit-quant" ? dialog.quant : null}
          open
          onOpenChange={(o) => { if (!o) closeDialog(); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["models"] }); qc.invalidateQueries({ queryKey: ["model-catalogue"] }); closeDialog(); }}
        />
      )}
      {dialog.kind === "hf-import" && (
        <HfImportDialog
          open
          onOpenChange={(o) => { if (!o) closeDialog(); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["models"] }); qc.invalidateQueries({ queryKey: ["model-catalogue"] }); closeDialog(); }}
        />
      )}

      <ConfirmActionDialog
        open={pendingDelete.kind !== "none"}
        onOpenChange={(open) => {
          if (!open) setPendingDelete({ kind: "none" });
        }}
        title={
          pendingDelete.kind === "model"
            ? `Delete ${pendingDelete.name}?`
            : pendingDelete.kind === "quant"
              ? `Delete quant "${pendingDelete.quantName}"?`
              : "Delete item?"
        }
        description={
          pendingDelete.kind === "model"
            ? "This will remove the model and all its quantizations from the knowledge base."
            : "This will remove the selected quantization."
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ── FamilyGroup ───────────────────────────────────────────────────────────────

interface FamilyGroupProps {
  family: string;
  models: ModelEntry[];
  onAddModel: () => void;
  onEditModel: (m: ModelEntry) => void;
  onDeleteModel: (m: ModelEntry) => void;
  onAddQuant: (m: ModelEntry) => void;
  onEditQuant: (m: ModelEntry, q: ModelQuant) => void;
  onDeleteQuant: (m: ModelEntry, q: ModelQuant) => void;
}

function FamilyGroup({ family, models, onEditModel, onDeleteModel, onAddQuant, onEditQuant, onDeleteQuant }: FamilyGroupProps) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <span className="text-sm font-semibold">{family}</span>
        <span className="ml-1 text-xs text-muted-foreground">({models.length})</span>
      </button>

      {open && (
        <div className="divide-y divide-border/40 border-t border-border/40">
          {models.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              onEdit={() => onEditModel(m)}
              onDelete={() => onDeleteModel(m)}
              onAddQuant={() => onAddQuant(m)}
              onEditQuant={(q) => onEditQuant(m, q)}
              onDeleteQuant={(q) => onDeleteQuant(m, q)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// ── ModelRow ─────────────────────────────────────────────────────────────────

interface ModelRowProps {
  model: ModelEntry;
  onEdit: () => void;
  onDelete: () => void;
  onAddQuant: () => void;
  onEditQuant: (q: ModelQuant) => void;
  onDeleteQuant: (q: ModelQuant) => void;
}

function ModelRow({ model, onEdit, onDelete, onAddQuant, onEditQuant, onDeleteQuant }: ModelRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {expanded ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="text-sm font-medium">{model.name}</span>
          <span className="text-xs text-muted-foreground ml-1">
            {model.param_count_b}B · {model.max_context_k}k ctx · {model.quants.length} quants
          </span>
          {model.is_reasoning && <Tag label="reasoning" />}
          {model.is_code_model && <Tag label="code" />}
          {model.is_moe && <Tag label="MoE" />}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {model.hf_url && (
            <a href={model.hf_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-foreground" title="Open on HuggingFace">
              <ExternalLink className="size-3.5" />
            </a>
          )}
          <IconButton icon={<Pencil className="size-3" />} title="Edit model" onClick={onEdit} />
          <IconButton icon={<Trash2 className="size-3" />} title="Delete model" onClick={onDelete} danger />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/20 bg-muted/20 px-6 pb-3 pt-2 space-y-1.5">
          {model.quants.map((q) => (
            <QuantRow key={q.id} quant={q} onEdit={() => onEditQuant(q)} onDelete={() => onDeleteQuant(q)} />
          ))}
          <button
            onClick={onAddQuant}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          >
            <Plus className="size-3" /> Add quant
          </button>
        </div>
      )}
    </div>
  );
}

// ── QuantRow ─────────────────────────────────────────────────────────────────

function QuantRow({ quant, onEdit, onDelete }: { quant: ModelQuant; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className="w-24 text-xs font-mono text-foreground/80 shrink-0">{quant.name}</span>
      <span className="text-[10px] text-muted-foreground w-16 shrink-0">{quant.bits_per_weight}bpw</span>
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">{quant.disk_size_gb}GB disk</span>
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">{quant.vram_weights_gb}GB VRAM</span>
      <span className="text-[10px] text-muted-foreground w-14 shrink-0">q={quant.quality_score.toFixed(2)}</span>
      <div className="ml-auto flex items-center gap-1">
        {quant.hf_url && (
          <a href={quant.hf_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-foreground">
            <ExternalLink className="size-3" />
          </a>
        )}
        <IconButton icon={<Pencil className="size-3" />} title="Edit quant" onClick={onEdit} />
        <IconButton icon={<Trash2 className="size-3" />} title="Delete quant" onClick={onDelete} danger />
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Tag({ label }: { label: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>
  );
}

function IconButton({ icon, title, onClick, danger }: { icon: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${danger ? "hover:bg-red-500/10 hover:text-red-500" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
    >
      {icon}
    </button>
  );
}
