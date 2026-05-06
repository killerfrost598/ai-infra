export interface GpuProfile {
  key: string;
  name: string;
  cc: number;
  vram_gb: number;
}

export const GPU_PROFILES: GpuProfile[] = [
  { key: "v100_16",  name: "V100 16GB",   cc: 7.0,  vram_gb: 16  },
  { key: "v100_32",  name: "V100 32GB",   cc: 7.0,  vram_gb: 32  },
  { key: "t4",       name: "T4 16GB",     cc: 7.5,  vram_gb: 16  },
  { key: "rtx_3090", name: "RTX 3090 24GB", cc: 8.6, vram_gb: 24 },
  { key: "a100_40",  name: "A100 40GB",   cc: 8.0,  vram_gb: 40  },
  { key: "a100_80",  name: "A100 80GB",   cc: 8.0,  vram_gb: 80  },
  { key: "rtx_4090", name: "RTX 4090 24GB", cc: 8.9, vram_gb: 24 },
  { key: "l4",       name: "L4 24GB",     cc: 8.9,  vram_gb: 24  },
  { key: "l40s",     name: "L40S 48GB",   cc: 8.9,  vram_gb: 48  },
  { key: "h100_80",  name: "H100 80GB",   cc: 9.0,  vram_gb: 80  },
  { key: "h200_141", name: "H200 141GB",  cc: 9.0,  vram_gb: 141 },
  { key: "b200",     name: "B200 192GB",  cc: 10.0, vram_gb: 192 },
];

export function findGpuProfile(key: string): GpuProfile | undefined {
  return GPU_PROFILES.find((g) => g.key === key);
}

export function quantFitsGpu(
  quant: { cc_min: string | null; vram_weights_gb: number },
  gpu: GpuProfile,
): boolean {
  // 0 means unknown — skip the VRAM check
  if (quant.vram_weights_gb > 0 && quant.vram_weights_gb > gpu.vram_gb) return false;
  if (quant.cc_min) {
    const ccMin = parseFloat(quant.cc_min);
    if (!isNaN(ccMin) && ccMin > gpu.cc) return false;
  }
  return true;
}
