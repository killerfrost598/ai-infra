"use client";

import { useQuery } from "@tanstack/react-query";
import { catalogueSchema, type Model, type ModelCatalogue } from "./schema";

let _cached: ModelCatalogue | null = null;

export async function loadCatalogue(): Promise<ModelCatalogue> {
  if (_cached) return _cached;

  const res = await fetch("/data/models.json", { cache: "force-cache" });
  if (!res.ok) throw new Error(`Failed to load model catalogue: HTTP ${res.status}`);

  const raw: unknown = await res.json();
  const result = catalogueSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Model catalogue validation failed: ${result.error.message}`);
  }

  _cached = result.data;
  return _cached;
}

export function useCatalogue() {
  return useQuery({
    queryKey: ["model-catalogue"],
    queryFn: loadCatalogue,
    staleTime: Infinity,
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
      (m.tags as readonly string[]).some((t) => t.includes(q))
  );
}

export function uniqueFamilies(models: Model[]): string[] {
  return [...new Set(models.map((m) => m.family))].sort();
}
