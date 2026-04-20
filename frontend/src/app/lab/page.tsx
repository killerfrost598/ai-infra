"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  History,
  Power,
  RefreshCw,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ParsedCommand, Session, SessionListItem } from "@/lib/types";
import { PtyTerminal } from "@/components/PtyTerminal";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/StatusBadge";

type RightTab = "commands" | "output" | "history";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export default function LabPage() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [commands, setCommands] = useState<ParsedCommand[]>([]);
  const [activeTab, setActiveTab] = useState<RightTab>("commands");
  const [selectedCmd, setSelectedCmd] = useState<ParsedCommand | null>(null);
  const [cmdLoading, setCmdLoading] = useState(false);
  const [isTerminatingSession, setIsTerminatingSession] = useState(false);
  const terminalKey = useRef(0);
  const hasAppliedInitialTarget = useRef(false);

  const loadSessions = useCallback(async () => {
    setSessionListLoading(true);
    try {
      const response = await api.sessions.list(undefined, undefined, 0, 50);
      setSessions(response.items);
      return response.items;
    } finally {
      setSessionListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAppliedInitialTarget.current) return;
    hasAppliedInitialTarget.current = true;
    let isCancelled = false;

    const queryTarget = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("session")
      : null;
    const storageTarget = typeof window !== "undefined"
      ? sessionStorage.getItem("lab_session_id")
      : null;

    if (storageTarget) {
      sessionStorage.removeItem("lab_session_id");
    }

    loadSessions().then((items) => {
      if (isCancelled) return;
      if (queryTarget) {
        setSelectedId(queryTarget);
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/lab");
        }
        return;
      }

      if (storageTarget && items.some((s) => s.id === storageTarget)) {
        setSelectedId(storageTarget);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedId) return;
    let isCancelled = false;
    setCommands([]);
    setSelectedCmd(null);
    setCmdLoading(true);

    Promise.all([
      api.sessions.get(selectedId),
      api.sessions.commandsSummary(selectedId),
    ]).then(([s, summary]) => {
      if (isCancelled) return;
      setSession(s);
      setCommands(summary.commands);
    }).catch(() => {
      if (isCancelled) return;
      setSession(null);
    }).finally(() => {
      if (isCancelled) return;
      setCmdLoading(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedId]);

  // useCallback prevents a new function reference on every render, which was
  // previously causing PtyTerminal to remount (and reconnect) on each state update.
  const refreshCommands = useCallback(async () => {
    if (!selectedId) return;
    setCmdLoading(true);
    try {
      const summary = await api.sessions.commandsSummary(selectedId);
      setCommands(summary.commands);
    } finally {
      setCmdLoading(false);
    }
  }, [selectedId]);

  const handleSessionSelect = useCallback((id: string) => {
    terminalKey.current += 1;
    setSelectedId(id);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/lab?session=${encodeURIComponent(id)}`);
    }
    setIsSessionDrawerOpen(false);
  }, []);

  const handleTerminateSession = useCallback(async () => {
    if (!selectedId || session?.status !== "ACTIVE") return;

    setIsTerminatingSession(true);
    try {
      const response = await api.sessions.terminate(selectedId);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to terminate session");
      }

      terminalKey.current += 1;
      setSelectedCmd(null);

      const [nextSession] = await Promise.all([
        api.sessions.get(selectedId).catch(() => null),
        loadSessions(),
      ]);
      setSession(nextSession);

      if (nextSession) {
        const summary = await api.sessions.commandsSummary(selectedId);
        setCommands(summary.commands);
      } else {
        setCommands([]);
      }
      toast.success("Session terminated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Could not terminate session: ${message}`);
    } finally {
      setIsTerminatingSession(false);
    }
  }, [loadSessions, selectedId, session?.status]);

  const selectedSessionListItem = sessions.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!isSessionDrawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSessionDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSessionDrawerOpen]);

  const ptySessionId = selectedId && session?.status === "ACTIVE" ? selectedId : null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border bg-background px-6 shrink-0">
        <div>
          <h1 className="text-base font-semibold">Lab</h1>
          <p className="text-xs text-muted-foreground">Interactive terminal + command history</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedId && session?.status === "ACTIVE" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive-secondary"
                  size="sm"
                  disabled={isTerminatingSession}
                  className="gap-1.5"
                >
                  <Power className="h-3.5 w-3.5" />
                  Terminate
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Terminate this session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will disconnect the terminal and mark the session as terminated.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleTerminateSession}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Terminate Session
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" size="sm" onClick={() => loadSessions()} disabled={sessionListLoading}>
            {sessionListLoading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setIsSessionDrawerOpen((prev) => !prev)}>
            Sessions
            {selectedSessionListItem && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({selectedSessionListItem.label ?? selectedSessionListItem.id.slice(0, 8)})
              </span>
            )}
          </Button>
        </div>
      </div>

      {!selectedId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
          <p>Select a session to begin terminal work.</p>
          <Button size="sm" onClick={() => setIsSessionDrawerOpen(true)}>
            Open Sessions
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden gap-1 p-3 bg-background">
          {/* Left Terminal Panel */}
          <TerminalPanel
            session={session}
            ptySessionId={ptySessionId}
            terminalKey={terminalKey.current}
          />

          {/* Right Terminal View Panel */}
          <TerminalViewPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            commands={commands}
            cmdLoading={cmdLoading}
            selectedCmd={selectedCmd}
            onSelectCmd={(cmd) => {
              setSelectedCmd(cmd);
              setActiveTab("output");
            }}
            session={session}
            onRefresh={refreshCommands}
          />
        </div>
      )}

      <SessionDrawer
        open={isSessionDrawerOpen}
        loading={sessionListLoading}
        sessions={sessions}
        selectedId={selectedId}
        onClose={() => setIsSessionDrawerOpen(false)}
        onRefresh={() => loadSessions()}
        onSelect={handleSessionSelect}
      />
    </div>
  );
}

// ============================================================================
// Terminal Panel Component (Left Side)
// ============================================================================

function TerminalPanel({
  session,
  ptySessionId,
  terminalKey,
}: {
  session: Session | null;
  ptySessionId: string | null;
  terminalKey: number;
}) {
  return (
    <div className="flex-1 flex flex-col rounded-lg border border-border bg-muted/30 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex h-9 items-center gap-3 border-b border-border bg-muted/50 px-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary/80" />
          <span className="text-xs font-medium text-foreground">Terminal</span>
        </div>
        {session?.status === "TERMINATED" && (
          <span className="ml-auto rounded-full bg-destructive/20 px-2 py-0.5 text-[10px] font-medium text-destructive">
            terminated
          </span>
        )}
      </div>

      {/* Terminal Content */}
      <div className="flex-1 overflow-hidden">
        {ptySessionId ? (
          <PtyTerminal
            key={`${ptySessionId}-${terminalKey}`}
            sessionId={ptySessionId}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/10 text-muted-foreground text-sm">
            Session is terminated — terminal unavailable
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Terminal View Panel Component (Right Side with Tabs)
// ============================================================================

function TerminalViewPanel({
  activeTab,
  onTabChange,
  commands,
  cmdLoading,
  selectedCmd,
  onSelectCmd,
  session,
  onRefresh,
}: {
  activeTab: RightTab;
  onTabChange: (tab: RightTab) => void;
  commands: ParsedCommand[];
  cmdLoading: boolean;
  selectedCmd: ParsedCommand | null;
  onSelectCmd: (cmd: ParsedCommand) => void;
  session: Session | null;
  onRefresh: () => void;
}) {
  const tabs: Array<{ id: RightTab; label: string; icon: LucideIcon }> = [
    { id: "commands", label: "Commands", icon: Terminal },
    { id: "output", label: "Output", icon: FileText },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div className="h-full w-80 flex flex-col rounded-xl border border-border/70 bg-gradient-to-b from-muted/50 via-muted/25 to-background/90 overflow-hidden shadow-sm">
      {/* Tab Navigation */}
      <div className="flex shrink-0 items-center border-b border-border/70 bg-background/60 px-2 py-1.5 backdrop-blur">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <tab.icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                {tab.id === "commands" && commands.length > 0 && (
                  <span className="rounded-full bg-primary/20 px-1.5 py-0 text-[10px] font-semibold text-primary">
                    {commands.length}
                  </span>
                )}
              </span>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Refresh Button */}
        {activeTab === "commands" && (
          <button
            onClick={onRefresh}
            disabled={cmdLoading}
            className="ml-auto p-1.5 rounded-md transition-colors hover:bg-muted/60 disabled:opacity-40 text-muted-foreground hover:text-foreground"
            title="Refresh commands"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${cmdLoading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "commands" && (
          <CommandsTab
            commands={commands}
            loading={cmdLoading}
            selectedCmd={selectedCmd}
            onSelect={onSelectCmd}
          />
        )}
        {activeTab === "output" && (
          <OutputTab cmd={selectedCmd} />
        )}
        {activeTab === "history" && (
          <HistoryTab ptyLog={session?.pty_log ?? null} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Tab Content Components
// ============================================================================

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
      <div className="p-4 text-xs text-muted-foreground/70 leading-relaxed">
        No commands detected yet. Commands will appear here after you run them in the terminal.
      </div>
    );

  return (
    <div className="divide-y divide-border/50">
      {commands.map((cmd, i) => (
        <button
          key={`${cmd.started_ms}-${cmd.command}-${i}`}
          onClick={() => onSelect(cmd)}
          className={`w-full px-3 py-2.5 text-left transition-colors border-l-2 ${
            selectedCmd === cmd
              ? "bg-primary/10 border-l-primary"
              : "border-l-transparent hover:bg-muted/50 hover:border-l-muted-foreground/30"
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

function OutputTab({ cmd }: { cmd: ParsedCommand | null }) {
  if (!cmd)
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-muted-foreground/60 text-xs">
          <p className="mb-1">No command selected</p>
          <p className="text-[11px] text-muted-foreground/40">
            Select a command from the Commands tab to view its output.
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
              cmd.exit_code === 0
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400"
            }`}
          >
            <span>exit {cmd.exit_code}</span>
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatDuration(cmd.duration_ms)}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatTime(cmd.started_ms)}
          </span>
          <CopyTextButton
            className="ml-auto"
            text={cmd.output}
            label="Copy Output"
          />
        </div>
        <code className="block text-xs font-mono text-foreground/80 truncate">
          $ {cmd.command}
        </code>
      </div>

      {cmd.output ? (
        <pre className="terminal flex-1 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-300 bg-muted/40 p-2.5 rounded border border-border/50">
          {cmd.output}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground/50 py-8 text-center">
          (no output captured)
        </p>
      )}
    </div>
  );
}

function HistoryTab({ ptyLog }: { ptyLog: string | null }) {
  if (!ptyLog)
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-muted-foreground/60 text-xs">
          <p>No PTY history available</p>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
        <span className="text-[11px] font-medium text-foreground/70">PTY Transcript</span>
        <CopyTextButton text={ptyLog} label="Copy History" />
      </div>
      <pre className="terminal flex-1 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-300 bg-muted/40 rounded border border-border/50 p-3">
        {ptyLog}
      </pre>
    </div>
  );
}

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
  const supportsClipboard = typeof navigator !== "undefined" && Boolean(navigator.clipboard);
  const hasText = Boolean(text && text.trim().length > 0);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const onCopy = useCallback(async () => {
    if (!text) return;
    if (!supportsClipboard) {
      setCopyState("error");
      toast.error("Clipboard is not available in this browser context");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      toast.success("Copied to clipboard");
    } catch {
      setCopyState("error");
      toast.error("Copy failed. Try again.");
    }
  }, [supportsClipboard, text]);

  const buttonLabel = copyState === "copied" ? "Copied" : copyState === "error" ? "Retry" : label;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!hasText || !supportsClipboard}
      onClick={onCopy}
      className={`h-6 gap-1.5 border-border/60 bg-background/70 px-2 text-[11px] ${className ?? ""}`}
      title={supportsClipboard ? label : "Clipboard unavailable"}
    >
      {copyState === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {buttonLabel}
    </Button>
  );
}

// ============================================================================

function SessionDrawer({
  open,
  loading,
  sessions,
  selectedId,
  onClose,
  onRefresh,
  onSelect,
}: {
  open: boolean;
  loading: boolean;
  sessions: SessionListItem[];
  selectedId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={`absolute inset-0 z-30 ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <button
        className={`absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-label="Close sessions drawer"
      />

      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-sm border-l border-border bg-background shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <div>
              <h2 className="text-sm font-semibold">Sessions</h2>
              <p className="text-xs text-muted-foreground">Open a session in Lab</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                {loading ? "..." : "Refresh"}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading && sessions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Loading sessions...</div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No sessions available.</div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => {
                  const isSelected = session.id === selectedId;
                  return (
                    <button
                      key={session.id}
                      onClick={() => onSelect(session.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-primary/60 bg-primary/10"
                          : "border-border/70 hover:bg-muted/40"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {session.label ?? `Session ${session.id.slice(0, 8)}`}
                        </span>
                        <StatusBadge status={session.status} />
                      </div>

                      <div className="text-xs text-muted-foreground">
                        {session.server_hostname ?? session.server_id.slice(0, 8)}
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground/70">
                        <span>
                          {session.command_count} cmd{session.command_count !== 1 ? "s" : ""}
                        </span>
                        <span>
                          {new Date(session.started_at).toLocaleString()}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ============================================================================

