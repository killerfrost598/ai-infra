import { z } from "zod";

export const ENGINE_NAMES = ["vllm", "sglang", "ollama"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export const MODEL_TAGS = [
  "chat",
  "code",
  "agents",
  "reasoning",
  "long-context",
  "tool-calling",
  "multimodal",
  "moe",
] as const;
export type ModelTag = (typeof MODEL_TAGS)[number];

const quantSchema = z.object({
  name: z.string(),
  bits_per_weight: z.number().positive(),
  disk_size_gb: z.number().positive(),
  vram_weights_gb: z.number().positive(),
  quality_score: z.number().min(0).max(1),
  notes: z.string().nullable(),
});
export type Quant = z.infer<typeof quantSchema>;

const engineSpecSchema = z.object({
  engine: z.enum(ENGINE_NAMES),
  score: z.number().min(0).max(1),
  min_vram_gb: z.number().positive(),
});
export type EngineSpec = z.infer<typeof engineSpecSchema>;

const kvCacheSchema = z.object({
  num_layers: z.number().int().positive(),
  num_kv_heads: z.number().int().positive(),
  head_dim: z.number().int().positive(),
  kv_dtype_default: z.enum(["fp16", "bf16", "fp8"]),
});
export type KvCache = z.infer<typeof kvCacheSchema>;

export const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string(),
  param_count_b: z.number().positive(),
  huggingface_url: z.string(),
  max_context_k: z.number().positive(),
  tags: z.array(z.enum(MODEL_TAGS)),
  is_reasoning: z.boolean(),
  supports_tools: z.boolean(),
  is_code_model: z.boolean(),
  is_moe: z.boolean().optional().default(false),
  moe_active_params_b: z.number().positive().optional(),
  use_case: z.string(),
  quants: z.array(quantSchema).min(1),
  kv_cache: kvCacheSchema,
  recommended_engines: z.array(engineSpecSchema).min(1),
  recommended_flags: z.record(z.string(), z.array(z.string())),
});
export type Model = z.infer<typeof modelSchema>;

export const catalogueSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  models: z.array(modelSchema).min(1),
});
export type ModelCatalogue = z.infer<typeof catalogueSchema>;
