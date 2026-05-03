import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { FeasibilityReport } from "./types";

export function useFeasibility(
  offerId: number | null,
  modelKey: string,
  quant: string,
  engine: "VLLM" | "SGLANG" | "OLLAMA",
  tpSize = 1,
) {
  return useQuery<FeasibilityReport>({
    queryKey: ["feasibility", offerId, modelKey, quant, engine, tpSize],
    queryFn: () =>
      api.feasibility.check({
        offer_id: offerId!,
        model_key: modelKey,
        quant,
        engine,
        tp_size: tpSize,
      }),
    enabled: offerId !== null && modelKey !== "" && quant !== "",
    staleTime: 60_000,
  });
}
