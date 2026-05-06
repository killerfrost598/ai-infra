import type { Model, Quant } from "./models/schema";

export interface VramEstimate {
  weightsGb: number;
  kvCacheGb: number;
  activationGb: number;
  overheadGb: number;
  totalGb: number;
}

export type FitStatus = "OOM" | "TIGHT" | "OK" | "COMFORTABLE";

export interface FitResult {
  status: FitStatus;
  estimate: VramEstimate;
  headroomGb: number;
  headroomPct: number;
  availableGb: number;
}

export interface QuantFitResult {
  quant: Quant;
  fit: FitResult;
}

// Discrete context steps shown in UI
export const CONTEXT_STEPS_K = [2, 4, 8, 16, 32, 64, 128] as const;
export type ContextStepK = (typeof CONTEXT_STEPS_K)[number];

export type KvDtype = "fp16" | "bf16" | "fp8";

export function estimateWeightsGb(paramCountB: number, bpw: number): number {
  return (paramCountB * bpw) / 8;
}

export function estimateVramNeed(
  model: Model,
  quant: Quant,
  contextLenK: number,
  batchSize: number,
  kvDtype: KvDtype = "fp16"
): VramEstimate {
  const weightsGb = quant.vram_weights_gb > 0
    ? quant.vram_weights_gb
    : estimateWeightsGb(model.param_count_b, quant.bits_per_weight);

  // KV-cache: 2 (K+V) × layers × kv_heads × head_dim × context_tokens × batch × bytes_per_elem
  const bytesPerElem = kvDtype === "fp8" ? 1 : 2;
  const { num_layers, num_kv_heads, head_dim } = model.kv_cache;
  const contextTokens = contextLenK * 1024;
  const kvBytes =
    2 * num_layers * num_kv_heads * head_dim * contextTokens * batchSize * bytesPerElem;
  const kvCacheGb = kvBytes / 1e9;

  // Activation + CUDA graph overhead: ~15% of weights floor at 1.5 GB
  const activationGb = Math.max(1.5, weightsGb * 0.15);

  // Fixed CUDA / framework reserve
  const overheadGb = 1.0;

  return {
    weightsGb,
    kvCacheGb,
    activationGb,
    overheadGb,
    totalGb: weightsGb + kvCacheGb + activationGb + overheadGb,
  };
}

export function fitForGpu(
  model: Model,
  quant: Quant,
  gpuVramGb: number,
  gpuCount: number,
  contextLenK: number,
  batchSize: number,
  kvDtype: KvDtype = "fp16"
): FitResult {
  const estimate = estimateVramNeed(model, quant, contextLenK, batchSize, kvDtype);
  const availableGb = gpuVramGb * gpuCount;
  const headroomGb = availableGb - estimate.totalGb;
  const headroomPct = headroomGb / availableGb;

  let status: FitStatus;
  if (headroomGb < 0) status = "OOM";
  else if (headroomPct < 0.1) status = "TIGHT";
  else if (headroomPct < 0.3) status = "OK";
  else status = "COMFORTABLE";

  return { status, estimate, headroomGb, headroomPct, availableGb };
}

// Returns the best-fitting quant for the given GPU at default context/batch.
// Walks from highest quality to lowest, returns first that is OK or COMFORTABLE.
// Falls back to the smallest quant (even if OOM) so callers always get a result.
export function bestQuantForGpu(
  model: Model,
  gpuVramGb: number,
  gpuCount = 1,
  contextLenK = 8,
  batchSize = 4,
  kvDtype: KvDtype = "fp16"
): QuantFitResult {
  const sorted = [...model.quants].sort((a, b) => b.quality_score - a.quality_score);

  for (const quant of sorted) {
    const fit = fitForGpu(model, quant, gpuVramGb, gpuCount, contextLenK, batchSize, kvDtype);
    if (fit.status === "OK" || fit.status === "COMFORTABLE") {
      return { quant, fit };
    }
  }

  const smallest = sorted[sorted.length - 1];
  return {
    quant: smallest,
    fit: fitForGpu(model, smallest, gpuVramGb, gpuCount, contextLenK, batchSize, kvDtype),
  };
}

export function fitStatusLabel(status: FitStatus): string {
  switch (status) {
    case "COMFORTABLE": return "Fits comfortably";
    case "OK":          return "Fits (tight)";
    case "TIGHT":       return "Very tight";
    case "OOM":         return "Out of memory";
  }
}

export function fitStatusColor(status: FitStatus): string {
  switch (status) {
    case "COMFORTABLE": return "text-green-600 dark:text-green-400";
    case "OK":          return "text-yellow-600 dark:text-yellow-400";
    case "TIGHT":       return "text-orange-600 dark:text-orange-400";
    case "OOM":         return "text-red-600 dark:text-red-400";
  }
}

export function fitStatusBg(status: FitStatus): string {
  switch (status) {
    case "COMFORTABLE": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "OK":          return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "TIGHT":       return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "OOM":         return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  }
}
