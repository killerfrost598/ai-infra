"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Check, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { DownloadFile, DownloadSnapshot } from "@/lib/types";

interface ModelDownloadModalProps {
  downloadId: string;
  repoId: string;
  onClose: () => void;
  onComplete: (success: boolean) => void;
}

function fmtTime(s: number): string {
  if (!s || s <= 0 || !isFinite(s)) return "--";
  const sec = Math.floor(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function fmtMb(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

const STATUS_COLORS: Record<DownloadFile["status"], string> = {
  cached: "text-emerald-400/70",
  pending: "text-slate-400",
  downloading: "text-blue-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
};

const BADGE_CLASSES: Record<DownloadFile["status"], string> = {
  cached: "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50",
  pending: "bg-slate-800 text-slate-400 border border-slate-700",
  downloading: "bg-blue-900/40 text-blue-400 border border-blue-800/50",
  completed: "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50",
  failed: "bg-red-900/40 text-red-400 border border-red-800/50",
};

function FileRow({ file }: { file: DownloadFile }) {
  return (
    <div
      className={`rounded border border-border/60 bg-card/60 p-3 transition-colors ${
        file.status === "downloading" ? "border-blue-800/50 bg-blue-950/20" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate font-mono text-[11px] text-foreground"
          title={file.filename}
          style={{ direction: "rtl", textAlign: "left" }}
        >
          {file.filename}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_CLASSES[file.status]}`}>
          {file.status}
        </span>
      </div>

      {/* Per-file progress bar */}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/60">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            file.status === "failed"
              ? "bg-red-500"
              : file.status === "cached" || file.status === "completed"
              ? "bg-emerald-500"
              : "bg-blue-500"
          }`}
          style={{ width: `${file.percent}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>
          {fmtMb(file.downloaded_mb)} / {fmtMb(file.size_mb)}
        </span>
        <span>{file.percent.toFixed(1)}%</span>
      </div>

      {file.error && (
        <p className="mt-1 text-[10px] text-red-400">{file.error}</p>
      )}
    </div>
  );
}

export function ModelDownloadModal({
  downloadId,
  repoId,
  onClose,
  onComplete,
}: ModelDownloadModalProps) {
  const [snap, setSnap] = useState<DownloadSnapshot | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const onCompleteRef = useRef(onComplete);

  // Keep the callback ref current without re-running the SSE effect.
  // Parent re-renders (polling, etc.) recreate onComplete; if it were in the
  // dep array, every parent render would tear down and rebuild the EventSource,
  // and the new connection would race the old one for queue events — both
  // losing them in the process.
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const url = api.modelDownloads.streamUrl(downloadId);
    const src = new EventSource(url);
    sourceRef.current = src;

    src.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as DownloadSnapshot;
        setSnap(data);
      } catch {
        /* ignore parse error */
      }
    };

    src.addEventListener("complete", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as DownloadSnapshot;
        setSnap(data);
        setIsDone(true);
        onCompleteRef.current(!data.error && !data.files.some((f) => f.status === "failed"));
      } catch {
        setIsDone(true);
        onCompleteRef.current(false);
      }
      src.close();
    });

    src.onerror = () => {
      setIsDone(true);
      src.close();
    };

    return () => {
      src.close();
    };
  }, [downloadId]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.modelDownloads.cancel(downloadId);
    } finally {
      setCancelling(false);
      sourceRef.current?.close();
      setIsDone(true);
    }
  };

  const totalFiles = snap?.total_files ?? 0;
  const fileIndex = snap?.file_index ?? 0;
  const percent = snap?.percent ?? 0;
  const avgSpeed = snap?.avg_speed_mbps ?? 0;
  const elapsed = snap?.elapsed ?? 0;
  const eta = snap?.eta_seconds ?? 0;
  const hasError = snap?.error || snap?.files.some((f) => f.status === "failed");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex w-[600px] max-w-[95vw] flex-col rounded-xl border border-border bg-background shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Model Download</h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{repoId}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close (download continues in background)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Aggregate stats */}
        <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
          <div className="bg-background px-4 py-3 text-center">
            <p className="font-mono text-xl font-bold tabular-nums text-foreground">
              {avgSpeed.toFixed(1)}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">MB/s</p>
          </div>
          <div className="bg-background px-4 py-3 text-center">
            <p className="font-mono text-xl font-bold tabular-nums text-foreground">
              {fmtTime(elapsed)}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">Elapsed</p>
          </div>
          <div className="bg-background px-4 py-3 text-center">
            <p className="font-mono text-xl font-bold tabular-nums text-foreground">
              {isDone ? (hasError ? "—" : "Done") : fmtTime(eta)}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">ETA</p>
          </div>
        </div>

        {/* Overall progress */}
        <div className="px-5 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {fileIndex} / {totalFiles} files
            </span>
            <span className="font-mono font-semibold text-foreground">
              {percent.toFixed(1)}%
            </span>
            {snap && (
              <span>
                {fmtMb(snap.downloaded_mb)} / {fmtMb(snap.total_mb)}
              </span>
            )}
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                hasError ? "bg-red-500" : isDone ? "bg-emerald-500" : "bg-blue-500"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* File list */}
        <div className="max-h-64 flex-1 overflow-y-auto px-5 pb-2">
          {snap ? (
            <div className="space-y-1.5">
              {snap.files.map((f) => (
                <FileRow key={f.filename} file={f} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting to download stream...
            </div>
          )}
        </div>

        {/* Terminal state banner */}
        {isDone && (
          <div
            className={`mx-5 mb-3 rounded-md border px-4 py-2.5 text-sm ${
              hasError
                ? "border-red-800/50 bg-red-950/30 text-red-400"
                : "border-emerald-800/50 bg-emerald-950/30 text-emerald-400"
            }`}
          >
            <div className="flex items-center gap-2">
              {hasError ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : (
                <Check className="h-4 w-4 shrink-0" />
              )}
              {hasError
                ? snap?.error
                  ? `Failed: ${snap.error}`
                  : "One or more files failed to download."
                : `Complete in ${fmtTime(elapsed)}.`}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-[10px] text-muted-foreground">
            Closing this modal does not cancel the download.
          </p>
          <div className="flex gap-2">
            {!isDone && (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1 px-3 text-xs"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={onClose}
            >
              {isDone ? "Close" : "Hide"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
