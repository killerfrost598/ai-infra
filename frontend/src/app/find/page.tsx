"use client";

import { GpuFinderPanel } from "@/components/finder/GpuFinderPanel";

export default function FindPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">GPU Finder</h1>
      <GpuFinderPanel />
    </div>
  );
}
