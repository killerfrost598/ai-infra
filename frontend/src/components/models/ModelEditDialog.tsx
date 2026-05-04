"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ModelEntry } from "@/lib/types";
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
  model_key: z.string().min(1),
  name: z.string().min(1),
  family: z.string().min(1),
  param_count_b: z.coerce.number().positive(),
  hf_url: z.string().optional().nullable(),
  hf_repo: z.string().optional().nullable(),
  max_context_k: z.coerce.number().int().positive(),
  use_case: z.string().default("chat"),
  is_reasoning: z.boolean().default(false),
  supports_tools: z.boolean().default(false),
  is_code_model: z.boolean().default(false),
  is_moe: z.boolean().default(false),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  model: ModelEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ModelEditDialog({ model, open, onOpenChange, onSaved }: Props) {
  const isEdit = model !== null;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      model_key: "", name: "", family: "", param_count_b: 7,
      hf_url: "", hf_repo: "", max_context_k: 8, use_case: "chat",
      is_reasoning: false, supports_tools: false, is_code_model: false, is_moe: false,
    },
  });

  useEffect(() => {
    if (model) {
      form.reset({
        model_key: model.model_key,
        name: model.name,
        family: model.family,
        param_count_b: model.param_count_b,
        hf_url: model.hf_url ?? "",
        hf_repo: model.hf_repo ?? "",
        max_context_k: model.max_context_k,
        use_case: model.use_case,
        is_reasoning: model.is_reasoning,
        supports_tools: model.supports_tools,
        is_code_model: model.is_code_model,
        is_moe: model.is_moe,
      });
    } else {
      form.reset();
    }
  }, [model, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const data = {
        ...values,
        hf_url: values.hf_url || null,
        hf_repo: values.hf_repo || null,
      };
      return isEdit ? api.models.update(model.id, data) : api.models.create(data);
    },
    onSuccess: () => { toast.success(isEdit ? "Model updated" : "Model created"); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit model" : "Add model"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4 py-2">
          <Field label="Model key (unique slug)" error={form.formState.errors.model_key?.message}>
            <Input {...form.register("model_key")} placeholder="qwen3-4b" disabled={isEdit} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display name" error={form.formState.errors.name?.message}>
              <Input {...form.register("name")} placeholder="Qwen3 4B" />
            </Field>
            <Field label="Family" error={form.formState.errors.family?.message}>
              <Input {...form.register("family")} placeholder="Qwen" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Parameters (B)" error={form.formState.errors.param_count_b?.message}>
              <Input {...form.register("param_count_b")} type="number" step="0.1" placeholder="4.0" />
            </Field>
            <Field label="Max context (k tokens)" error={form.formState.errors.max_context_k?.message}>
              <Input {...form.register("max_context_k")} type="number" placeholder="128" />
            </Field>
          </div>
          <Field label="HuggingFace URL">
            <Input {...form.register("hf_url")} placeholder="https://huggingface.co/Qwen/Qwen3-4B" />
          </Field>
          <Field label="HF repo ID (for API)">
            <Input {...form.register("hf_repo")} placeholder="Qwen/Qwen3-4B" />
          </Field>
          <Field label="Use case">
            <Input {...form.register("use_case")} placeholder="chat" />
          </Field>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {(["is_reasoning", "supports_tools", "is_code_model", "is_moe"] as const).map((field) => (
              <label key={field} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...form.register(field)} className="rounded" />
                <span className="text-muted-foreground capitalize">{field.replace("is_", "").replace("_", " ")}</span>
              </label>
            ))}
          </div>

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
