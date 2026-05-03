import type { CloreOffer } from "./types";
import type { EngineName, Model, Quant } from "./models/schema";
import { fitForGpu, type FitResult, type FitStatus, type KvDtype, type ContextStepK } from "./vram";
import { recommendEngines, type EngineRecommendation, type UseCase } from "./engine-advisor";

// ── Public config type ────────────────────────────────────────────────────────

export interface FinderConfig {
  contextK: ContextStepK;
  batch: number;
  kvDtype: KvDtype;
  useCase: UseCase;
  concurrency: number;
  minDiskGb?: number;        // hard filter — rows with known disk < this are removed
  minDownloadMbps?: number;  // hard filter — rows with known speed < this are removed
}

// ── Result types ──────────────────────────────────────────────────────────────

export type RankedBucket = "comfortable" | "ok" | "tight" | "oom";

export interface RankedOffer {
  offer: CloreOffer;
  fit: FitResult;
  pickedEngine: EngineRecommendation | null;   // user's engine evaluated for this offer
  topEngine: EngineRecommendation | null;       // best engine regardless of user pick
  diskOk: boolean;            // null disk_gb counts as pass (unknown)
  diskHeadroomGb: number | null;
  downloadOk: boolean;
  downloadEtaMin: number | null;
  scores: {
    fitScore: number;     // 0..1
    engineScore: number;  // 0..1
    priceScore: number;   // 0..1 inverse-normalised
    composite: number;
  };
  bucket: RankedBucket;
  reasons: string[];
}

export interface RankResult {
  ranked: RankedOffer[];     // COMFORTABLE → OK → TIGHT, composite tiebreaker, then price
  unfit: RankedOffer[];      // OOM bucket, sorted by smallest VRAM deficit first
  totalEvaluated: number;    // rows that passed hard filters
}

// ── Bucket helpers ────────────────────────────────────────────────────────────

const BUCKET_RANK: Record<RankedBucket, number> = {
  comfortable: 0,
  ok: 1,
  tight: 2,
  oom: 3,
};

function toBucket(status: FitStatus): RankedBucket {
  switch (status) {
    case "COMFORTABLE": return "comfortable";
    case "OK":          return "ok";
    case "TIGHT":       return "tight";
    case "OOM":         return "oom";
  }
}

// Fit score maps headroom → [0,1] with different curves per bucket
function computeFitScore(fit: FitResult): number {
  switch (fit.status) {
    case "COMFORTABLE": return Math.min(1.0, 0.7 + 0.3 * fit.headroomPct);
    case "OK":          return Math.min(0.7, 0.4 + 0.3 * fit.headroomPct);
    case "TIGHT":       return Math.min(0.4, Math.max(0.1, 0.1 + 3.0 * fit.headroomPct));
    case "OOM":         return 0;
  }
}

// ── Main ranking function ─────────────────────────────────────────────────────

export function rankOffersForConfig(
  offers: CloreOffer[],
  model: Model,
  quant: Quant,
  engine: EngineName,
  config: FinderConfig,
): RankResult {
  if (!offers.length) return { ranked: [], unfit: [], totalEvaluated: 0 };

  // Price range for inverse normalisation
  const prices = offers.map((o) => o.price_per_day);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = Math.max(maxPrice - minPrice, 0.01);

  const evaluated: RankedOffer[] = [];

  for (const offer of offers) {
    // Hard filters — null means unknown, skip the filter
    if (
      config.minDiskGb !== undefined &&
      offer.disk_gb !== null &&
      offer.disk_gb < config.minDiskGb
    ) continue;

    if (
      config.minDownloadMbps !== undefined &&
      offer.download_mbps !== null &&
      offer.download_mbps < config.minDownloadMbps
    ) continue;

    // VRAM fit
    const fit = fitForGpu(
      model,
      quant,
      offer.vram_gb,
      offer.gpu_count,
      config.contextK,
      config.batch,
      config.kvDtype,
    );

    // Engine scoring (all engines for this offer)
    const engineRecs = recommendEngines(
      model,
      offer.vram_gb,
      offer.gpu_count,
      config.useCase,
      config.concurrency,
    );

    const pickedEngine = engineRecs.find((r) => r.engine === engine) ?? null;
    const topEngine = engineRecs.find((r) => r.meetsVramMin) ?? null;

    // Disk capacity (null = unknown → pass with chip)
    const requiredDiskGb = quant.disk_size_gb + 20; // buffer for OS + swap
    const diskHeadroomGb = offer.disk_gb !== null ? offer.disk_gb - requiredDiskGb : null;
    const diskOk = offer.disk_gb === null || offer.disk_gb >= requiredDiskGb;

    // Download check against optional minimum
    const downloadOk =
      config.minDownloadMbps === undefined ||
      offer.download_mbps === null ||
      offer.download_mbps >= config.minDownloadMbps;

    // Download ETA: GB × 8000 Mbit/GB ÷ Mbps = seconds ÷ 60 = minutes
    const downloadEtaMin =
      offer.download_mbps !== null && offer.download_mbps > 0
        ? (quant.disk_size_gb * 8000) / offer.download_mbps / 60
        : null;

    // Scores
    const fitScore    = computeFitScore(fit);
    const engineScore = pickedEngine?.meetsVramMin ? pickedEngine.score : 0;
    const priceScore  = 1 - (offer.price_per_day - minPrice) / priceRange;

    // Composite: fit gates, engine shapes, price breaks ties
    // (0.4 + 0.6×x) form: poor engine reduces but does not zero the result
    const composite =
      fitScore *
      (0.4 + 0.6 * engineScore) *
      (0.5 + 0.5 * priceScore);

    const bucket = toBucket(fit.status);

    // Human-readable reason bullets
    const reasons: string[] = [];
    if (fit.status !== "OOM") {
      reasons.push(`${fit.headroomGb.toFixed(1)} GB VRAM headroom`);
    } else {
      reasons.push(`${Math.abs(fit.headroomGb).toFixed(1)} GB short`);
    }
    if (!diskOk && diskHeadroomGb !== null) {
      reasons.push(`Disk: need ${Math.ceil(Math.abs(diskHeadroomGb))} GB more`);
    }
    if (downloadEtaMin !== null) {
      reasons.push(`~${Math.ceil(downloadEtaMin)} min download`);
    }
    if (pickedEngine && !pickedEngine.meetsVramMin) {
      reasons.push(`${engine} needs more VRAM for this model`);
    }
    if (topEngine && pickedEngine && topEngine.engine !== engine && topEngine.meetsVramMin) {
      reasons.push(`Better engine available: ${topEngine.engine}`);
    }

    evaluated.push({
      offer,
      fit,
      pickedEngine,
      topEngine,
      diskOk,
      diskHeadroomGb,
      downloadOk,
      downloadEtaMin,
      scores: { fitScore, engineScore, priceScore, composite },
      bucket,
      reasons,
    });
  }

  const ranked = evaluated
    .filter((r) => r.bucket !== "oom")
    .sort((a, b) => {
      const bucketDiff = BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
      if (bucketDiff !== 0) return bucketDiff;
      const cDiff = b.scores.composite - a.scores.composite;
      if (Math.abs(cDiff) > 0.001) return cDiff;
      return a.offer.price_per_day - b.offer.price_per_day;
    });

  // OOM sorted by closest-to-fitting (smallest VRAM deficit first)
  const unfit = evaluated
    .filter((r) => r.bucket === "oom")
    .sort((a, b) => {
      const aDef = Math.abs(a.fit.headroomGb);
      const bDef = Math.abs(b.fit.headroomGb);
      if (Math.abs(aDef - bDef) > 0.01) return aDef - bDef;
      return a.offer.price_per_day - b.offer.price_per_day;
    });

  return { ranked, unfit, totalEvaluated: evaluated.length };
}
