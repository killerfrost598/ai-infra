"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { HostCapabilitySnapshot } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  serverId: string;
  snapshot: HostCapabilitySnapshot | null;
  onReprobed: () => void;
}

function timeAgo(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CapabilitySnapshotCard({ serverId, snapshot, onReprobed }: Props) {
  const [reprobing, setReprobing] = useState(false);

  async function handleReprobe() {
    setReprobing(true);
    try {
      await api.servers.reprobe(serverId);
      onReprobed();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Reprobe failed");
    } finally {
      setReprobing(false);
    }
  }

  return (
    <Card className="px-6 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Hardware Snapshot</h2>
          {snapshot && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Probed {timeAgo(snapshot.captured_at)}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" loading={reprobing} onClick={handleReprobe}>
          {reprobing ? "Probing…" : "Re-probe"}
        </Button>
      </div>

      {!snapshot && (
        <p className="text-xs text-muted-foreground/60">
          No snapshot available. Provision or re-probe this server to capture hardware details.
        </p>
      )}

      {snapshot && (
        <div className="space-y-3">
          {/* GPU list */}
          {snapshot.gpus && snapshot.gpus.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                GPUs ({snapshot.gpu_count})
              </p>
              <div className="space-y-1">
                {snapshot.gpus.map((g, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-foreground/80">{g.name}</span>
                    <span className="text-muted-foreground">CC {g.cc}</span>
                    <span className="text-muted-foreground">{g.vram_gb} GB VRAM</span>
                    {g.pcie_gen && (
                      <span className="text-muted-foreground/60">
                        PCIe Gen{g.pcie_gen}×{g.pcie_width}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Driver", value: snapshot.driver_version ?? "—" },
              { label: "CUDA (host)", value: snapshot.cuda_runtime_host ?? "—" },
              { label: "Docker", value: snapshot.docker_present ? "Yes" : "No" },
              {
                label: "nvidia-ct",
                value: snapshot.nvidia_container_toolkit ? "Yes" : "No",
              },
              {
                label: "Homogeneous",
                value: snapshot.homogeneous ? "Yes" : "Mixed GPUs",
              },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {label}
                </p>
                <p className="mt-0.5 text-xs text-foreground/80">{value}</p>
              </div>
            ))}
          </div>

          {/* NVLink topology */}
          {snapshot.nvlink_topology && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                NVLink Topology
              </p>
              <pre className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground overflow-x-auto">
                {snapshot.nvlink_topology}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
