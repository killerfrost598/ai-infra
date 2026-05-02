"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  History,
  RefreshCw,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { ParsedCommand, Session } from "@/lib/types";
import { Button } from "@/components/ui/button";

type LogTab = "commands" | "output" | "history";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export interface SessionLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  session: Session | null;
  commands: ParsedCommand[];
  cmdLoading: boolean;
  onRefresh: () => void;
}

export function SessionLogsModal({
  isOpen,
  onClose,
  sessionId,
  session,
  commands,
  cmdLoading,
  onRefresh,
}: SessionLogsModalProps) {
  const [activeTab, setActiveTab] = useState<LogTab>("commands");
  const [selectedCmd, setSelectedCmd] = useState<ParsedCommand | null>(null);

  useEffect(() => {
    setSelectedCmd(null);
    setActiveTab("commands");
  }, [sessionId]);

  const tabs: Array<{ id: LogTab; label: string; icon: LucideIcon }> = [
    { id: "commands", label: "Commands", icon: Terminal },
    { id: "output", label: "Output", icon: FileText },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 z-20 flex w-96 flex-col border-l border-border/70 bg-gradient-to-b from-muted/50 via-muted/25 to-background/90 shadow-2xl transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
    >
      {/* Tab navigation */}
      <div className="flex shrink-0 items-center border-b border-border/70 bg-background/60 px-2 py-1.5 backdrop-blur">
        <div className="flex flex-1 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.id === "commands" && commands.length > 0 && (
                  <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                    {commands.length}
                  </span>
                )}
              </span>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          {activeTab === "commands" && (
            <button
              onClick={onRefresh}
              disabled={cmdLoading}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
              title="Refresh commands"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${cmdLoading ? "animate-spin" : ""}`} />
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            title="Close logs"
          >
            ×
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "commands" && (
          <CommandsTab
            commands={commands}
            loading={cmdLoading}
            selectedCmd={selectedCmd}
            onSelect={(cmd) => {
              setSelectedCmd(cmd);
              setActiveTab("output");
            }}
          />
        )}
        {activeTab === "output" && <OutputTab cmd={selectedCmd} />}
        {activeTab === "history" && <HistoryTab ptyLog={session?.pty_log ?? null} />}
      </div>
    </div>
  );
}

// ── Commands Tab ─────────────────────────────────────────────────────────────

function CommandsTab({
  commands,
  loading,
  selectedCmd,
  onSelect,
}: {
  commands: ParsedCommand[];
  loading: boolean;
  selectedCmd: ParsedCommand | null;
  onSelect: (cmd: ParsedCommand) => void;
}) {
  if (loading)
    return <div className="p-4 text-xs text-muted-foreground">Loading commands…</div>;

  if (!commands.length)
    return (
      <div className="p-4 text-xs leading-relaxed text-muted-foreground/70">
        No commands detected yet. Commands appear here after you run them in the terminal.
      </div>
    );

  return (
    <div className="divide-y divide-border/50">
      {commands.map((cmd, i) => (
        <button
          key={`${cmd.started_ms}-${cmd.command}-${i}`}
          onClick={() => onSelect(cmd)}
          className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${
            selectedCmd === cmd
              ? "border-l-primary bg-primary/10"
              : "border-l-transparent hover:border-l-muted-foreground/30 hover:bg-muted/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                cmd.exit_code === 0 ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            <code className="flex-1 truncate text-xs font-mono text-foreground">
              {cmd.command}
            </code>
            <span className="shrink-0 text-[10px] text-muted-foreground/50">
              {formatDuration(cmd.duration_ms)}
            </span>
          </div>
          <div className="mt-1 pl-3.5 text-[10px] text-muted-foreground/60">
            {formatTime(cmd.started_ms)}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Output Tab ───────────────────────────────────────────────────────────────

function OutputTab({ cmd }: { cmd: ParsedCommand | null }) {
  if (!cmd)
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <p className="text-xs text-muted-foreground/60">
          Select a command from the Commands tab to view its output.
        </p>
      </div>
    );

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${
              cmd.exit_code === 0
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400"
            }`}
          >
            exit {cmd.exit_code}
          </span>
          <span className="text-[10px] text-muted-foreground/60">{formatDuration(cmd.duration_ms)}</span>
          <span className="text-[10px] text-muted-foreground/60">{formatTime(cmd.started_ms)}</span>
          <CopyTextButton className="ml-auto" text={cmd.output} label="Copy Output" />
        </div>
        <code className="block truncate text-xs font-mono text-foreground/80">$ {cmd.command}</code>
      </div>
      {cmd.output ? (
        <pre className="terminal flex-1 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-muted/40 p-2.5 text-xs leading-relaxed text-zinc-300">
          {cmd.output}
        </pre>
      ) : (
        <p className="py-8 text-center text-xs text-muted-foreground/50">(no output captured)</p>
      )}
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ ptyLog }: { ptyLog: string | null }) {
  if (!ptyLog)
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <p className="text-xs text-muted-foreground/60">No PTY history available</p>
      </div>
    );

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-foreground/70">PTY Transcript</span>
        <CopyTextButton text={ptyLog} label="Copy History" />
      </div>
      <pre className="terminal flex-1 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-muted/40 p-3 text-xs leading-relaxed text-zinc-300">
        {ptyLog}
      </pre>
    </div>
  );
}

// ── Copy Button ──────────────────────────────────────────────────────────────

function CopyTextButton({
  text,
  label,
  className,
}: {
  text: string | null;
  label: string;
  className?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const hasText = Boolean(text && text.trim().length > 0);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const onCopy = useCallback(async () => {
    if (!text) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
        toast.success("Copied to clipboard");
        return;
      } catch {
        // fall through to execCommand fallback
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("execCommand returned false");
      setCopyState("copied");
      toast.success("Copied to clipboard");
    } catch {
      setCopyState("error");
      toast.error("Copy failed. Try again.");
    }
  }, [text]);

  const buttonLabel = copyState === "copied" ? "Copied" : copyState === "error" ? "Retry" : label;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!hasText}
      onClick={onCopy}
      className={`h-6 gap-1.5 border-border/60 bg-background/70 px-2 text-[11px] ${className ?? ""}`}
    >
      {copyState === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {buttonLabel}
    </Button>
  );
}
