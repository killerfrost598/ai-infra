"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { HfImportResult, ModelCreate } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

type Step = "input" | "preview";

const CONF_COLOR: Record<string, string> = {
  high: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-orange-600 dark:text-orange-400",
  missing: "text-red-500",
};

export function HfImportDialog({ open, onOpenChange, onSaved }: Props) {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<HfImportResult | null>(null);
  const [preview, setPreview] = useState<ModelCreate | null>(null);

  const fetch = useMutation({
    mutationFn: (hf_url: string) => api.models.importFromHf(hf_url),
    onSuccess: (data) => {
      setResult(data);
      setPreview(data.suggested);
      setStep("preview");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "HF fetch failed"),
  });

  const save = useMutation({
    mutationFn: (data: ModelCreate) => api.models.create(data),
    onSuccess: () => { toast.success("Model imported"); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  function reset() {
    setStep("input");
    setUrl("");
    setResult(null);
    setPreview(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onOpenChange(false); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from HuggingFace</DialogTitle>
        </DialogHeader>

        {step === "input" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Paste a HuggingFace model URL. We'll fetch config.json and pre-fill the fields.
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://huggingface.co/Qwen/Qwen3-4B"
              onKeyDown={(e) => { if (e.key === "Enter" && url) fetch.mutate(url); }}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => fetch.mutate(url)} disabled={!url || fetch.isPending}>
                {fetch.isPending ? "Fetching…" : "Fetch"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && result && preview && (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Review the parsed fields. Colors indicate confidence:&nbsp;
              <span className={CONF_COLOR.high}>high</span> /&nbsp;
              <span className={CONF_COLOR.medium}>medium</span> /&nbsp;
              <span className={CONF_COLOR.low}>low</span> /&nbsp;
              <span className={CONF_COLOR.missing}>missing</span>
            </p>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <PreviewRow label="Model key" value={preview.model_key} conf={result.confidence.model_key} onEdit={(v) => setPreview({ ...preview, model_key: v })} />
              <PreviewRow label="Name" value={preview.name} conf={result.confidence.name} onEdit={(v) => setPreview({ ...preview, name: v })} />
              <PreviewRow label="Family" value={preview.family} conf={result.confidence.family} onEdit={(v) => setPreview({ ...preview, family: v })} />
              <PreviewRow label="Params (B)" value={String(preview.param_count_b)} conf={result.confidence.param_count_b} onEdit={(v) => setPreview({ ...preview, param_count_b: parseFloat(v) || preview.param_count_b })} />
              <PreviewRow label="Max context (k)" value={String(preview.max_context_k)} conf={result.confidence.max_context_k} onEdit={(v) => setPreview({ ...preview, max_context_k: parseInt(v) || preview.max_context_k })} />
              <PreviewRow label="Use case" value={preview.use_case ?? "chat"} conf={result.confidence.use_case} onEdit={(v) => setPreview({ ...preview, use_case: v })} />
              <PreviewRow label="HF URL" value={preview.hf_url ?? ""} conf="high" onEdit={(v) => setPreview({ ...preview, hf_url: v })} />
            </div>

            {preview.kv_cache && Object.keys(preview.kv_cache).length > 0 && (
              <div className="rounded-lg border border-border p-3 text-xs font-mono text-muted-foreground">
                <p className="mb-1 font-sans font-medium text-foreground/70 text-[10px] uppercase tracking-wider">KV cache ({result.confidence.kv_cache ?? "low"})</p>
                {JSON.stringify(preview.kv_cache, null, 2)}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>← Back</Button>
              <Button onClick={() => save.mutate(preview)} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save model"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ label, value, conf, onEdit }: { label: string; value: string; conf?: string; onEdit: (v: string) => void }) {
  const colorClass = CONF_COLOR[conf ?? "missing"] ?? CONF_COLOR.missing;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted-foreground/70">{label}</span>
      <input
        className={`flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs ${colorClass} focus:outline-none focus:ring-1 focus:ring-ring`}
        value={value}
        onChange={(e) => onEdit(e.target.value)}
      />
    </div>
  );
}
