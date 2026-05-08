"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  Copy,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Power,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  PtyTerminal,
  type PtyConnectionState,
  type PtyStats,
} from "@/components/PtyTerminal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ServerMeta {
  gpu_model?: string | null;
  vram_gb?: number | null;
  hostname?: string | null;
  status?: string | null;
  /** Optional uptime label like "42m 18s". */
  uptime?: string | null;
}

interface TerminalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /** Short id shown next to the "Terminal" title (e.g. ses_7f3a91). */
  sessionLabel?: string;
  serverMeta?: ServerMeta;
  /** Called when the user clicks "Disconnect session" (or closes the modal). */
  onDisconnect?: () => void;
  onData?: (data: Uint8Array) => void;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortId(id: string | null | undefined, prefix = "ses"): string {
  if (!id) return "—";
  const tail = id.replace(/-/g, "").slice(0, 6);
  return `${prefix}_${tail}`;
}

interface StatusMeta {
  dotClass: string;
  bannerClass: string;
  textClass: string;
  label: string;
  detail: string;
}

function statusMeta(state: PtyConnectionState, reason?: string): StatusMeta {
  switch (state) {
    case "connecting":
      return {
        dotClass: "bg-amber-500",
        bannerClass:
          "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/40",
        textClass: "text-amber-700 dark:text-amber-300",
        label: "Connecting",
        detail: "negotiating handshake…",
      };
    case "connected":
      return {
        dotClass: "bg-emerald-500",
        bannerClass:
          "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800/40",
        textClass: "text-emerald-700 dark:text-emerald-300",
        label: "Connected",
        detail: "streaming live output",
      };
    case "idle":
      return {
        dotClass: "bg-blue-500",
        bannerClass:
          "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800/40",
        textClass: "text-blue-700 dark:text-blue-300",
        label: "Connected · idle",
        detail: "cursor blinking",
      };
    case "unavailable":
      return {
        dotClass: "bg-rose-500",
        bannerClass:
          "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800/40",
        textClass: "text-rose-700 dark:text-rose-300",
        label: "Unavailable",
        detail: reason ?? "session unavailable",
      };
    case "closed":
    default:
      return {
        dotClass: "bg-zinc-400 dark:bg-zinc-500",
        bannerClass:
          "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/50 dark:border-zinc-800",
        textClass: "text-zinc-600 dark:text-zinc-400",
        label: "Closed",
        detail: reason ?? "session ended cleanly",
      };
  }
}

function ShortcutChip({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {keys.map((k, i) => (
          <kbd
            key={i}
            className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.04)]"
          >
            {k}
          </kbd>
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function HeaderIconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

const META_KEY_LABEL =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

export function TerminalModal({
  open,
  onOpenChange,
  sessionId,
  sessionLabel,
  serverMeta,
  onDisconnect,
  onData,
}: TerminalModalProps) {
  const { resolvedTheme } = useTheme();
  const ptyTheme = resolvedTheme === "dark" ? "dark" : "light";

  const [state, setState] = useState<PtyConnectionState>("connecting");
  const [stateReason, setStateReason] = useState<string | undefined>();
  const [stats, setStats] = useState<PtyStats>({
    bytesSent: 0,
    bytesReceived: 0,
    latencyMs: null,
    cols: 0,
    rows: 0,
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  // Idle detection — promote "connected" → "idle" after 3s without bytes
  const lastByteAtRef = useRef<number>(performance.now());
  useEffect(() => {
    if (state !== "connected" && state !== "idle") return;
    const t = setInterval(() => {
      const sinceMs = performance.now() - lastByteAtRef.current;
      setState((prev) =>
        prev === "connected" && sinceMs > 3000
          ? "idle"
          : prev === "idle" && sinceMs <= 500
            ? "connected"
            : prev,
      );
    }, 750);
    return () => clearInterval(t);
  }, [state]);

  // Reset on session change/open
  useEffect(() => {
    if (!open) return;
    setState("connecting");
    setStateReason(undefined);
    setStats({ bytesSent: 0, bytesReceived: 0, latencyMs: null, cols: 0, rows: 0 });
    setFullscreen(false);
    setReconnectKey(0);
    lastByteAtRef.current = performance.now();
  }, [open, sessionId]);

  // ESC closes the modal
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const handleData = useCallback(
    (data: Uint8Array) => {
      lastByteAtRef.current = performance.now();
      onData?.(data);
    },
    [onData],
  );

  const handleState = useCallback(
    (next: PtyConnectionState, reason?: string) => {
      setState(next);
      setStateReason(reason);
      if (next === "connected") lastByteAtRef.current = performance.now();
    },
    [],
  );

  const meta = useMemo(() => statusMeta(state, stateReason), [state, stateReason]);

  const gpuLabel = useMemo(() => {
    const parts: string[] = [];
    if (serverMeta?.gpu_model) parts.push(serverMeta.gpu_model);
    if (serverMeta?.vram_gb) parts.push(`${serverMeta.vram_gb} GB`);
    return parts.join(" · ");
  }, [serverMeta?.gpu_model, serverMeta?.vram_gb]);

  const promptLabel = useMemo(() => {
    const host = serverMeta?.hostname ?? "remote";
    const cols = stats.cols || "—";
    const rows = stats.rows || "—";
    return `ubuntu@${host}: ~/inferix — ${cols}×${rows}`;
  }, [serverMeta?.hostname, stats.cols, stats.rows]);

  const handleCopyAll = useCallback(async () => {
    // xterm doesn't expose a public buffer-to-text API on our import surface.
    // Best effort: copy the visible selection if any; otherwise no-op.
    const sel = window.getSelection?.()?.toString() ?? "";
    if (sel) {
      try {
        await navigator.clipboard.writeText(sel);
      } catch {
        /* clipboard may be denied — silent */
      }
    }
  }, []);

  const handleDownloadLog = useCallback(() => {
    if (!sessionId) return;
    window.open(`/api/v1/sessions/${sessionId}/pty/log`, "_blank", "noopener");
  }, [sessionId]);

  const handleDisconnect = useCallback(() => {
    onDisconnect?.();
    onOpenChange(false);
  }, [onDisconnect, onOpenChange]);

  if (!open) return null;

  const isLive = state === "connecting" || state === "connected" || state === "idle";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Terminal session"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
        onClick={() => onOpenChange(false)}
      />

      {/* modal shell */}
      <div
        className={cn(
          "relative flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl",
          fullscreen
            ? "h-[calc(100vh-16px)] w-[calc(100vw-16px)]"
            : "h-[min(640px,calc(100vh-32px))] w-[min(880px,calc(100vw-32px))]",
        )}
      >
        {/* HEADER */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-background/95 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              <span className="font-mono text-sm font-bold">{">_"}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold leading-tight">Terminal</h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {sessionLabel ?? shortId(sessionId)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {gpuLabel && <span className="font-medium">{gpuLabel}</span>}
                {gpuLabel && serverMeta?.hostname && <span aria-hidden>·</span>}
                {serverMeta?.hostname && (
                  <span className="font-mono">{serverMeta.hostname}</span>
                )}
                {serverMeta?.uptime && (
                  <>
                    <span aria-hidden>·</span>
                    <span>up {serverMeta.uptime}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderIconButton label="Copy selection" onClick={handleCopyAll}>
              <Copy className="h-3.5 w-3.5" />
            </HeaderIconButton>
            <HeaderIconButton label="Save log" onClick={handleDownloadLog}>
              <Save className="h-3.5 w-3.5" />
            </HeaderIconButton>
            <HeaderIconButton label="Clear scrollback" onClick={() => setReconnectKey((k) => k + 1)}>
              <Trash2 className="h-3.5 w-3.5" />
            </HeaderIconButton>
            <HeaderIconButton label="Download log" onClick={handleDownloadLog}>
              <Download className="h-3.5 w-3.5" />
            </HeaderIconButton>
            <HeaderIconButton
              label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={() => setFullscreen((v) => !v)}
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </HeaderIconButton>
            <HeaderIconButton label="Close" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </HeaderIconButton>
          </div>
        </div>

        {/* STATUS BAR */}
        <div
          className={cn(
            "flex items-center justify-between gap-3 border-b px-4 py-1.5 text-[11px]",
            meta.bannerClass,
          )}
        >
          <div className={cn("flex min-w-0 items-center gap-2", meta.textClass)}>
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dotClass)} />
            <span className="truncate">
              <span className="font-medium">{meta.label}</span>
              {meta.detail && (
                <span className="ml-1.5 opacity-80">· {meta.detail}</span>
              )}
            </span>
          </div>
          <div className={cn("flex shrink-0 items-center gap-2 font-mono", meta.textClass)}>
            <span title="Bytes sent">↑ {fmtBytes(stats.bytesSent)}</span>
            <span aria-hidden className="opacity-50">·</span>
            <span title="Bytes received">↓ {fmtBytes(stats.bytesReceived)}</span>
            <span aria-hidden className="opacity-50">·</span>
            <span title="Connection latency">
              {stats.latencyMs == null ? "— ms" : `${stats.latencyMs} ms`}
            </span>
          </div>
        </div>

        {/* TERMINAL BODY */}
        <div className="relative flex flex-1 flex-col overflow-hidden bg-muted/30 p-3">
          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            {/* inner browser-like titlebar */}
            <div className="relative flex h-7 shrink-0 items-center justify-center border-b border-border bg-muted/40 px-2">
              <div className="absolute left-2 flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {promptLabel}
              </div>
              <div className="absolute right-1.5 flex items-center gap-1">
                <span className="rounded-md bg-background px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                  shell
                </span>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="New tab (coming soon)"
                  disabled
                  title="New tab — coming soon"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* pty content / overlay states */}
            <div className="relative flex-1 overflow-hidden">
              {sessionId && isLive && (
                <PtyTerminal
                  key={`${sessionId}:${reconnectKey}`}
                  sessionId={sessionId}
                  theme={ptyTheme}
                  onDisconnect={() => onDisconnect?.()}
                  onData={handleData}
                  onState={handleState}
                  onStats={setStats}
                  className="absolute inset-0 h-full w-full"
                />
              )}

              {state === "connecting" && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-[1px]">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Opening WebSocket to /api/v1/sessions/{shortId(sessionId)}/pty…
                  </p>
                </div>
              )}

              {(state === "closed" || state === "unavailable") && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 px-6 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted">
                    <Power className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Session ended</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {state === "unavailable"
                        ? stateReason ?? "Session unavailable"
                        : "Closed gracefully"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => setReconnectKey((k) => k + 1)}>
                      Reconnect
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDownloadLog}>
                      Download log
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <ShortcutChip keys={["^", "C"]} label="interrupt" />
            <ShortcutChip keys={["^", "D"]} label="EOF" />
            <ShortcutChip keys={[META_KEY_LABEL, "K"]} label="clear" />
            <ShortcutChip keys={[META_KEY_LABEL, "F"]} label="find" />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDisconnect}
            className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/30"
          >
            <Power className="mr-1.5 h-3 w-3" />
            Disconnect session
          </Button>
        </div>
      </div>
    </div>
  );
}

