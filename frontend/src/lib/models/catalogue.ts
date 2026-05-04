"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ModelEntry } from "@/lib/types";
import type { Model, ModelCatalogue } from "./schema";

function entryToModel(e: ModelEntry): Model {
  return {
    id: e.model_key,
    name: e.name,
    family: e.family,
    param_count_b: e.param_count_b,
    huggingface_url: e.hf_url ?? "",
    max_context_k: e.max_context_k,
    tags: e.tags as Model["tags"],
    is_reasoning: e.is_reasoning,
    supports_tools: e.supports_tools,
    is_code_model: e.is_code_model,
    is_moe: e.is_moe ?? false,
    moe_active_params_b: e.moe_active_params_b ?? undefined,
    use_case: e.use_case,
    num_attention_heads: e.num_attention_heads ?? undefined,
    tp_allowed_sizes: e.tp_allowed_sizes ?? undefined,
    kv_cache: e.kv_cache as Model["kv_cache"],
    recommended_engines: e.recommended_engines as Model["recommended_engines"],
    recommended_flags: e.recommended_flags as Model["recommended_flags"],
    quants: e.quants.map((q) => ({
      name: q.name,
      bits_per_weight: q.bits_per_weight,
      disk_size_gb: q.disk_size_gb,
      vram_weights_gb: q.vram_weights_gb,
      quality_score: q.quality_score,
      notes: q.notes,
      cc_min: q.cc_min ?? undefined,
      arch_vllm: q.arch_vllm,
      arch_sglang: q.arch_sglang,
    })),
  };
}

async function loadCatalogueFromApi(): Promise<ModelCatalogue> {
  const entries = await api.models.list({ archived: false });
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    models: entries.map(entryToModel),
  };
}

export function useCatalogue() {
  return useQuery({
    queryKey: ["model-catalogue"],
    queryFn: loadCatalogueFromApi,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function filterByFamily(models: Model[], family: string): Model[] {
  return models.filter((m) => m.family.toLowerCase() === family.toLowerCase());
}

export function filterByTag(models: Model[], tag: string): Model[] {
  return models.filter((m) => (m.tags as readonly string[]).includes(tag));
}

export function searchModels(models: Model[], query: string): Model[] {
  const q = query.toLowerCase();
  return models.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.family.toLowerCase().includes(q) ||
      m.id.includes(q) ||
      (m.tags as readonly string[]).some((t) => t.includes(q)),
  );
}

export function uniqueFamilies(models: Model[]): string[] {
  return [...new Set(models.map((m) => m.family))].sort();
}
