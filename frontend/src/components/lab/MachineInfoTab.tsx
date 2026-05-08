"use client";

import { useState } from "react";
import { RefreshCw, Cpu, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { MachineSnapshotPayload, Session } from "@/lib/types";

interface MachineInfoTabProps {
  session: Session | null;
  onSnapshotUpdated: (snap: MachineSnapshotPayload) => void;
}

export function MachineInfoTab({ session, onSnapshotUpdated }: MachineInfoTabProps) {
  const [reprobing, setReprobing] = useState(false);
  const snap = session?.latest_snapshot ?? null;

  async function handleReprobe() {
    if (!session || session.status === "TERMINATED") return;
    setReprobing(true);
    try {
      const updated = await api.sessions.refreshSnapshot(session.id);
      onSnapshotUpdated(updated);
      toast.success("Snapshot updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reprobe failed");
    } finally {
      setReprobing(false);
    }
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No active session selected
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Machine Info</h2>
            {snap?.captured_at && (
              <p className="text-xs text-muted-foreground">
                Captured {new Date(snap.captured_at).toLocaleString()}
                {snap.is_stale && (
                  <span className="ml-2 text-amber-500">· Stale (&gt;24 h)</span>
                )}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReprobe}
            disabled={reprobing || session.status === "TERMINATED"}
            className="h-7 gap-1.5 text-xs"
          >
            {reprobing
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />
            }
            {reprobing ? "Probing..." : "Reprobe"}
          </Button>
        </div>

        {!snap ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No snapshot yet.{" "}
            <button
              className="underline underline-offset-4 hover:text-foreground"
              onClick={handleReprobe}
              disabled={reprobing}
            >
              Run a probe
            </button>{" "}
            to capture machine details.
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                GPUs ({snap.gpu_count})
              </div>
              {snap.gpus.length === 0 ? (
                <p className="text-sm text-muted-foreground">No GPUs detected</p>
              ) : (
                <div className="space-y-2">
                  {snap.gpus.map((gpu, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-sm">
                      <span className="font-medium">{gpu.name}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{gpu.vram_gb} GB</span>
                        <span>CC {gpu.cc}</span>
                      </div>
                    </div>
                  ))}
                  {!snap.homogeneous && (
                    <p className="text-xs text-amber-500">Mixed GPU types detected - TP unsupported</p>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Stack</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Driver</p>
                  <p className="font-mono">{snap.driver_version ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CUDA runtime</p>
                  <p className="font-mono">{snap.cuda_runtime_host ?? "—"}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Software</div>
              <div className="flex flex-wrap gap-2">
                <PresenceBadge label="Docker" present={snap.docker_present} />
                <PresenceBadge label="NCT" present={snap.nvidia_container_toolkit} />
                <PresenceBadge
                  label="NVLink"
                  present={!!snap.nvlink_topology && snap.nvlink_topology.includes("NVLink")}
                />
              </div>
            </Card>

            {snap.nvlink_topology && (
              <Card className="p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  NVLink Topology
                </div>
                <pre className="overflow-x-auto rounded bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {snap.nvlink_topology}
                </pre>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PresenceBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
        present
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted/30 text-muted-foreground"
      }`}
    >
      {present
        ? <CheckCircle className="h-3 w-3" />
        : <XCircle className="h-3 w-3 opacity-50" />
      }
      {label}
    </div>
  );
}
