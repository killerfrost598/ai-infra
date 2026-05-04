"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ModelEntry, ModelQuant } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().min(1),
  hf_repo: z.string().optional().nullable(),
  hf_url: z.string().optional().nullable(),
  bits_per_weight: z.number().positive(),
  disk_size_gb: z.number().positive(),
  vram_weights_gb: z.number().positive(),
  quality_score: z.number().min(0).max(1),
  cc_min: z.string().optional().nullable(),
  arch_vllm: z.boolean(),
  arch_sglang: z.boolean(),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  model: ModelEntry;
  quant: ModelQuant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function QuantEditDialog({ model, quant, open, onOpenChange, onSaved }: Props) {
  const isEdit = quant !== null;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", bits_per_weight: 16, disk_size_gb: 0, vram_weights_gb: 0,
      quality_score: 1.0, cc_min: "", arch_vllm: true, arch_sglang: true, notes: "",
    },
  });

  useEffect(() => {
    if (quant) {
      form.reset({
        name: quant.name,
        hf_repo: quant.hf_repo ?? "",
        hf_url: quant.hf_url ?? "",
        bits_per_weight: quant.bits_per_weight,
        disk_size_gb: quant.disk_size_gb,
        vram_weights_gb: quant.vram_weights_gb,
        quality_score: quant.quality_score,
        cc_min: quant.cc_min ?? "",
        arch_vllm: quant.arch_vllm,
        arch_sglang: quant.arch_sglang,
        notes: quant.notes ?? "",
      });
    } else {
      form.reset();
    }
  }, [quant, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const data = {
        ...values,
        hf_repo: values.hf_repo || null,
        hf_url: values.hf_url || null,
        cc_min: values.cc_min || null,
        notes: values.notes || null,
      };
      return isEdit
        ? api.models.updateQuant(model.id, quant.id, data)
        : api.models.addQuant(model.id, data);
    },
    onSuccess: () => { toast.success(isEdit ? "Quant updated" : "Quant added"); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit quant — ${quant.name}` : `Add quant — ${model.name}`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4 py-2">
          <Field label="Name" error={form.formState.errors.name?.message}>
            <Input {...form.register("name")} placeholder="FP16 / AWQ-4bit / Q8" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Bits/weight" error={form.formState.errors.bits_per_weight?.message}>
              <Input {...form.register("bits_per_weight", { valueAsNumber: true })} type="number" step="0.5" placeholder="16" />
            </Field>
            <Field label="Disk (GB)" error={form.formState.errors.disk_size_gb?.message}>
              <Input {...form.register("disk_size_gb", { valueAsNumber: true })} type="number" step="0.1" placeholder="8.4" />
            </Field>
            <Field label="VRAM (GB)" error={form.formState.errors.vram_weights_gb?.message}>
              <Input {...form.register("vram_weights_gb", { valueAsNumber: true })} type="number" step="0.1" placeholder="8.0" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quality score (0–1)" error={form.formState.errors.quality_score?.message}>
              <Input {...form.register("quality_score", { valueAsNumber: true })} type="number" step="0.01" min="0" max="1" placeholder="1.0" />
            </Field>
            <Field label="Min compute cap.">
              <Input {...form.register("cc_min")} placeholder="8.0" />
            </Field>
          </div>
          <Field label="HF repo (if different from model)">
            <Input {...form.register("hf_repo")} placeholder="Qwen/Qwen3-4B-AWQ" />
          </Field>
          <Field label="HF URL">
            <Input {...form.register("hf_url")} placeholder="https://huggingface.co/…" />
          </Field>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(["arch_vllm", "arch_sglang"] as const).map((field) => (
              <label key={field} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...form.register(field)} className="rounded" />
                <span className="text-muted-foreground">{field === "arch_vllm" ? "vLLM" : "SGLang"} supported</span>
              </label>
            ))}
          </div>
          <Field label="Notes">
            <Input {...form.register("notes")} placeholder="Notable quality degradation, etc." />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
