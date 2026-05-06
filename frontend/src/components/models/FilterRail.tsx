"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { GPU_PROFILES } from "@/lib/gpu-profiles";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/queries";

const PARAM_BUCKETS = [
  { label: "≤ 4B",    param_min: undefined, param_max: 4   },
  { label: "7 – 13B", param_min: 7,          param_max: 13  },
  { label: "30 – 70B",param_min: 30,         param_max: 70  },
  { label: "> 70B",   param_min: 70,         param_max: undefined },
] as const;

const QUANT_FORMATS = ["gguf", "awq", "gptq", "fp8", "bnb", "fp16", "int8", "int4", "mlx"] as const;

const USE_CASES = ["chat", "code", "reasoning", "multimodal", "embedding"] as const;

const SORT_OPTIONS = [
  { value: "downloads", label: "Downloads" },
  { value: "likes",     label: "Likes"      },
  { value: "trending",  label: "Trending"   },
  { value: "params",    label: "Parameters" },
  { value: "created",   label: "Newest"     },
] as const;

const CAP_FLAGS = [
  { key: "is_reasoning",  label: "Reasoning" },
  { key: "is_code_model", label: "Code"      },
  { key: "is_moe",        label: "MoE"       },
] as const;

interface FilterRailProps {
  className?: string;
}

export function FilterRail({ className = "" }: FilterRailProps) {
  const router    = useRouter();
  const pathname  = usePathname();
  const searchParams = useSearchParams();

  const { data: tagVocab = [] } = useQuery({
    queryKey: ["models", "tag-vocabulary"],
    queryFn:  () => api.models.tagVocabulary(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: settingsData } = useSettings();
  const rawExcluded = settingsData?.settings.find((s) => s.key === "excluded_quant_formats")?.value ?? "";
  const globallyExcluded = new Set(
    rawExcluded.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname],
  );

  const toggleParam = useCallback(
    (key: string, value: string) => {
      const current = searchParams.get(key);
      setParam(key, current === value ? null : value);
    },
    [searchParams, setParam],
  );

  function resetAll() {
    // preserve only the search text if set
    const q = searchParams.get("search");
    router.replace(q ? `${pathname}?search=${encodeURIComponent(q)}` : pathname);
  }

  // Derive active bucket index
  const paramMin = searchParams.get("param_min") ?? "";
  const paramMax = searchParams.get("param_max") ?? "";
  const activeBucket = PARAM_BUCKETS.findIndex((b) => {
    const bMin = b.param_min != null ? String(b.param_min) : "";
    const bMax = b.param_max != null ? String(b.param_max) : "";
    return bMin === paramMin && bMax === paramMax;
  });

  function selectBucket(idx: number) {
    const bucket = PARAM_BUCKETS[idx];
    const params = new URLSearchParams(searchParams.toString());
    if (activeBucket === idx) {
      params.delete("param_min");
      params.delete("param_max");
    } else {
      if (bucket.param_min != null) params.set("param_min", String(bucket.param_min));
      else params.delete("param_min");
      if (bucket.param_max != null) params.set("param_max", String(bucket.param_max));
      else params.delete("param_max");
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  const currentSort   = searchParams.get("sort")         ?? "";
  const currentUseCase = searchParams.get("use_case")    ?? "";
  const currentFormat = searchParams.get("quant_format") ?? "";
  const currentGpu    = searchParams.get("target_gpu")   ?? "";
  const currentTag    = searchParams.get("tag")          ?? "";

  const hasFilters = [
    currentSort, currentUseCase, currentFormat, currentGpu, currentTag,
    paramMin, paramMax,
    searchParams.get("family"),
    searchParams.get("is_reasoning"),
    searchParams.get("is_code_model"),
    searchParams.get("is_moe"),
  ].some(Boolean);

  return (
    <aside className={`space-y-5 text-sm ${className}`}>
      {/* Sort */}
      <Section title="Sort">
        <div className="space-y-0.5">
          {SORT_OPTIONS.map((opt) => (
            <RowChip
              key={opt.value}
              label={opt.label}
              active={currentSort === opt.value}
              onClick={() => toggleParam("sort", opt.value)}
            />
          ))}
        </div>
      </Section>

      {/* Param size buckets */}
      <Section title="Parameters">
        <div className="flex flex-wrap gap-1">
          {PARAM_BUCKETS.map((b, i) => (
            <PillChip
              key={b.label}
              label={b.label}
              active={activeBucket === i}
              onClick={() => selectBucket(i)}
            />
          ))}
        </div>
      </Section>

      {/* Quant format */}
      <Section title="Quant format">
        <div className="flex flex-wrap gap-1">
          {QUANT_FORMATS.map((fmt) => (
            <PillChip
              key={fmt}
              label={fmt.toUpperCase()}
              active={currentFormat === fmt}
              excluded={globallyExcluded.has(fmt)}
              onClick={() => toggleParam("quant_format", fmt)}
            />
          ))}
        </div>
      </Section>

      {/* Tags from vocabulary */}
      {tagVocab.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1">
            {tagVocab.slice(0, 20).map((tag) => (
              <PillChip
                key={tag}
                label={tag}
                active={currentTag === tag}
                onClick={() => toggleParam("tag", tag)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Use case */}
      <Section title="Use case">
        <div className="space-y-0.5">
          {USE_CASES.map((uc) => (
            <RowChip
              key={uc}
              label={uc}
              active={currentUseCase === uc}
              onClick={() => toggleParam("use_case", uc)}
            />
          ))}
        </div>
      </Section>

      {/* Capability flags */}
      <Section title="Capabilities">
        <div className="space-y-0.5">
          {CAP_FLAGS.map(({ key, label }) => (
            <RowChip
              key={key}
              label={label}
              active={searchParams.get(key) === "true"}
              onClick={() => toggleParam(key, "true")}
            />
          ))}
        </div>
      </Section>

      {/* Target GPU */}
      <Section title="Target GPU">
        <select
          value={currentGpu}
          onChange={(e) => setParam("target_gpu", e.target.value || null)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Any GPU</option>
          {GPU_PROFILES.map((g) => (
            <option key={g.key} value={g.key}>
              {g.name}
            </option>
          ))}
        </select>
      </Section>

      {/* Reset */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={resetAll}
          className="w-full gap-1.5 text-xs"
        >
          <RotateCcw className="size-3" /> Reset filters
        </Button>
      )}
    </aside>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {title}
      </p>
      {children}
    </div>
  );
}

function RowChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex w-full items-center rounded px-2 py-1 text-xs transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function PillChip({
  label,
  active,
  excluded,
  onClick,
}: {
  label: string;
  active: boolean;
  excluded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={excluded ? `${label} is globally excluded in Settings` : undefined}
      className={[
        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        excluded ? "line-through opacity-40" : "",
      ].filter(Boolean).join(" ")}
    >
      {label}
    </button>
  );
}
