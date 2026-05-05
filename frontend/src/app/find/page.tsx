"use client";

import { GpuFinderPanel } from "@/components/finder/GpuFinderPanel";
import { PageHeader } from "@/components/layouts/page-header";

export default function FindPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="GPU Finder"
        description="Rank marketplace offers for model fit, throughput potential, and cost efficiency."
      />
      <GpuFinderPanel />
    </div>
  );
}
