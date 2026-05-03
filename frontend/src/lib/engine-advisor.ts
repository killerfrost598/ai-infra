import type { EngineName, Model } from "./models/schema";

export type UseCase = "chat" | "agents" | "rag" | "code" | "long-context";

export const USE_CASE_LABELS: Record<UseCase, string> = {
  chat: "General chat",
  agents: "AI agents / pipelines",
  rag: "RAG / document Q&A",
  code: "Code generation",
  "long-context": "Long documents (100K+)",
};

export interface EngineRecommendation {
  engine: EngineName;
  score: number;
  flags: string[];
  reason: string;
  meetsVramMin: boolean;
}

export function recommendEngines(
  model: Model,
  gpuVramGb: number,
  gpuCount: number,
  useCase: UseCase = "chat",
  concurrency = 1
): EngineRecommendation[] {
  const availableGb = gpuVramGb * gpuCount;
  const results: EngineRecommendation[] = [];

  for (const spec of model.recommended_engines) {
    const meetsVramMin = availableGb >= spec.min_vram_gb;
    let score = spec.score;

    if ((useCase === "agents" || useCase === "rag") && spec.engine === "sglang") score += 0.10;
    if (useCase === "long-context" && (spec.engine === "vllm" || spec.engine === "sglang")) score += 0.05;
    if (concurrency >= 4 && (spec.engine === "vllm" || spec.engine === "sglang")) score += 0.10;
    if (concurrency <= 1 && spec.engine === "ollama") score += 0.05;
    if (concurrency >= 4 && spec.engine === "ollama") score -= 0.20;
    if (model.is_reasoning && (spec.engine === "vllm" || spec.engine === "sglang")) score += 0.05;
    if (availableGb < 12 && spec.engine === "ollama") score += 0.10;
    if (!meetsVramMin) score = 0;

    const flags = (model.recommended_flags[spec.engine] ?? []) as string[];

    results.push({
      engine: spec.engine,
      score: Math.min(1, Math.max(0, score)),
      flags,
      reason: buildReason(spec.engine, model, useCase, concurrency, availableGb, meetsVramMin),
      meetsVramMin,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

export function topEngine(
  model: Model,
  gpuVramGb: number,
  gpuCount: number,
  useCase: UseCase = "chat",
  concurrency = 1
): EngineRecommendation | null {
  const recs = recommendEngines(model, gpuVramGb, gpuCount, useCase, concurrency);
  return recs.find((r) => r.meetsVramMin) ?? null;
}

function buildReason(
  engine: EngineName,
  model: Model,
  useCase: UseCase,
  concurrency: number,
  availableGb: number,
  meetsVramMin: boolean
): string {
  if (!meetsVramMin) return "Insufficient VRAM for this engine";
  if (engine === "sglang" && (useCase === "agents" || useCase === "rag")) {
    return "RadixAttention caches shared prefixes — ideal for agents and RAG workloads";
  }
  if (engine === "vllm" && concurrency >= 4) {
    return "Continuous batching handles many concurrent users efficiently";
  }
  if (engine === "sglang" && concurrency >= 4) {
    return "Continuous batching + RadixAttention — best throughput for concurrent users";
  }
  if (engine === "ollama" && concurrency >= 4) {
    return "Sequential processing — users queue; consider vLLM or SGLang for multi-user";
  }
  if (engine === "ollama" && concurrency <= 1) {
    return "Zero-config, single command — great for solo experimentation";
  }
  if (model.is_reasoning && (engine === "vllm" || engine === "sglang")) {
    return "Native reasoning parser strips <think> blocks from API responses";
  }
  if (availableGb < 12 && engine === "ollama") {
    return "Lightweight overhead suits constrained GPUs";
  }
  if (engine === "sglang") return "Best overall throughput with built-in RadixAttention";
  if (engine === "vllm") return "Production-grade serving with PagedAttention";
  return "Straightforward single-user deployment";
}

export const ENGINE_DESCRIPTIONS: Record<EngineName, string> = {
  vllm: "Production inference server. Continuous batching + PagedAttention. Best for 4+ concurrent users. Requires NVIDIA GPU.",
  sglang: "Highest throughput. RadixAttention caches shared prefixes (system prompts, RAG chunks). Best for agents, RAG, and high-concurrency APIs.",
  ollama: "Zero-config single-command deployment. Sequential serving (one user at a time). Ideal for solo dev and experimentation.",
};
