"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History, Plus, Power, Terminal, Cpu, ListChecks, Play } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useCreateSession, useServers } from "@/lib/queries";
import type { MachineSnapshotPayload, ModelEntry, ParsedCommand, Server, Session, SessionListItem } from "@/lib/types";
import { PtyTerminal } from "@/components/PtyTerminal";
import { SessionLogsModal } from "@/components/SessionLogsModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
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
import { MachineInfoTab } from "@/components/lab/MachineInfoTab";
import { TestRunsTab } from "@/components/lab/TestRunsTab";
import { RunModelPanel } from "@/components/lab/RunModelPanel";
import { OutcomeBanner } from "@/components/lab/OutcomeBanner";

// Fallback for non-secure contexts (HTTP) where crypto.randomUUID is unavailable
function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Live PTY parsing utilities (port of session_runner.py) ────────────────────

const _ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[P^_][^\x1b]*\x1b\\|[ -/]*[0-~])/g;
const _CTRL_RE = /[\x00-\x06\x0e-\x1a\x1c-\x1f]/g;
const _PS1_RE = /__PS1__(\d+)__(\d+)__/g;

function _stripAnsi(s: string): string {
  return s.replace(_ANSI_RE, "").replace(_CTRL_RE, "");
}

function _parsePtyBlock(
  block: string,
  startedMs: number,
  completedMs: number,
  exitCode: number,
): ParsedCommand | null {
  const cleaned = _stripAnsi(block).trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n").filter((l) => l.trim());
  if (!lines.length) return null;
  const command = lines[0].trim().replace(/^[^#$]*[#$]\s+/, "").trim();
  if (!command || command.startsWith("export PROMPT_COMMAND")) return null;
  const output = lines.slice(1).join("\n").trim();
  return {
    command,
    output,
    started_ms: startedMs,
    completed_ms: completedMs,
    duration_ms: Math.max(0, completedMs - startedMs),
    exit_code: exitCode,
  };
}

interface LabTab {
  tabId: string;
  sessionId: string;
  label: string;
  status: "ACTIVE" | "TERMINATED";
}

type ActiveView = "sessions" | "machine" | "runs";

const LAB_WORKSPACE_KEY = "inferix:lab-workspace:v1";

interface PersistedLabWorkspace {
  tabs: LabTab[];
  activeTabId: string | null;
  activeView: ActiveView;
  logsOpen: boolean;
  runModelOpen: boolean;
}

function sessionCommandsToParsed(session: Session | null): ParsedCommand[] {
  return (session?.commands ?? []).map((cmd) => {
    const started = new Date(cmd.executed_at).getTime();
    const stderr = cmd.stderr?.trim();
    const stdout = cmd.stdout?.trim();
    return {
      command: cmd.command,
      output: [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n\n"),
      started_ms: Number.isFinite(started) ? started : Date.now(),
      completed_ms: Number.isFinite(started) ? started + (cmd.duration_ms ?? 0) : Date.now(),
      duration_ms: cmd.duration_ms ?? 0,
      exit_code: cmd.exit_code,
    };
  });
}

function loadPersistedWorkspace(): PersistedLabWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAB_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedLabWorkspace>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((tab): tab is LabTab =>
          typeof tab?.tabId === "string" &&
          typeof tab?.sessionId === "string" &&
          typeof tab?.label === "string" &&
          (tab?.status === "ACTIVE" || tab?.status === "TERMINATED"),
        )
      : [];
    return {
      tabs,
      activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      activeView: parsed.activeView === "machine" || parsed.activeView === "runs" ? parsed.activeView : "sessions",
      logsOpen: Boolean(parsed.logsOpen),
      runModelOpen: Boolean(parsed.runModelOpen),
    };
  } catch {
    return null;
  }
}

function persistWorkspace(workspace: PersistedLabWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAB_WORKSPACE_KEY, JSON.stringify(workspace));
  } catch {
    // Non-fatal: private browsing or storage quota should not break Lab.
  }
}

export default function LabPage() {
  const { resolvedTheme } = useTheme();
  const ptyTheme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  const [tabs, setTabs] = useState<LabTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [showServerPicker, setShowServerPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const [isTerminatingActive, setIsTerminatingActive] = useState(false);

  // Secondary view state
  const [activeView, setActiveView] = useState<ActiveView>("sessions");
  const [runModelOpen, setRunModelOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingQuantId, setPendingQuantId] = useState<string | null>(null);

  // Active tab's session data — drives the logs panel
  const [session, setSession] = useState<Session | null>(null);
  const [commands, setCommands] = useState<ParsedCommand[]>([]);
  const [cmdLoading, setCmdLoading] = useState(false);

  // History drawer
  const [historySessions, setHistorySessions] = useState<SessionListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // L4 — live command tracking per tab
  const ptyBufferRef = useRef<Record<string, string>>({});
  const [liveCommandsMap, setLiveCommandsMap] = useState<Record<string, ParsedCommand[]>>({});

  const hasAppliedInitialTarget = useRef(false);
  const hasHydratedWorkspace = useRef(false);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; });
  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;
  const activeSessionId = activeTab?.sessionId ?? null;

  // Lazy-load models only when the Run Model panel is opened
  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ["models", "all"],
    queryFn: () => api.models.list(),
    enabled: runModelOpen,
    staleTime: 5 * 60 * 1000,
  });
  const models: ModelEntry[] = modelsData ?? [];

  // ── Tab status drift reconciliation — poll backend every 30 s ────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const activeTabs = tabsRef.current.filter((t) => t.status === "ACTIVE");
      if (!activeTabs.length) return;
      for (const tab of activeTabs) {
        try {
          const s = await api.sessions.get(tab.sessionId);
          if (s.status === "TERMINATED") {
            setTabs((prev) =>
              prev.map((t) => t.tabId === tab.tabId ? { ...t, status: "TERMINATED" } : t)
            );
          }
        } catch {
          // Session may be gone; will reconcile on next tick
        }
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load session data when active tab changes ──────────────────────────────
  useEffect(() => {
    if (!activeSessionId) {
      setSession(null);
      setCommands([]);
      return;
    }
    let cancelled = false;
    setCmdLoading(true);
    setCommands([]);

    Promise.all([
      api.sessions.get(activeSessionId),
      api.sessions.commandsSummary(activeSessionId),
    ]).then(([s, summary]) => {
      if (cancelled) return;
      setSession(s);
      setCommands([...sessionCommandsToParsed(s), ...summary.commands]);
    }).catch(() => {
      if (cancelled) return;
      setSession(null);
    }).finally(() => {
      if (cancelled) return;
      setCmdLoading(false);
    });

    return () => { cancelled = true; };
  }, [activeSessionId]);

  // ── Load from URL or sessionStorage on mount ───────────────────────────────
  useEffect(() => {
    if (hasAppliedInitialTarget.current) return;
    hasAppliedInitialTarget.current = true;

    const params = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const queryTarget = params.get("session");
    const modelId = params.get("model_id");
    const quantId = params.get("quant_id");
    const storageTarget = typeof window !== "undefined"
      ? sessionStorage.getItem("lab_session_id")
      : null;

    if (storageTarget) sessionStorage.removeItem("lab_session_id");
    if (typeof window !== "undefined") window.history.replaceState({}, "", "/lab");

    // Pre-seed Run Model panel when navigated from Models page
    if (modelId || quantId) {
      if (modelId) setPendingModelId(modelId);
      if (quantId) setPendingQuantId(quantId);
      setRunModelOpen(true);
    }

    const targetId = queryTarget || storageTarget;
    if (!targetId) {
      const saved = loadPersistedWorkspace();
      if (!saved || saved.tabs.length === 0) {
        hasHydratedWorkspace.current = true;
        return;
      }

      Promise.all(
        saved.tabs.map((tab) =>
          api.sessions.get(tab.sessionId)
            .then((s) => ({
              ...tab,
              label: s.label ?? tab.label,
              status: s.status as "ACTIVE" | "TERMINATED",
            }))
            .catch(() => null),
        ),
      ).then((restored) => {
        const nextTabs = restored.filter((tab): tab is LabTab => Boolean(tab));
        if (nextTabs.length > 0) {
          setTabs(nextTabs);
          setActiveTabId(
            nextTabs.some((tab) => tab.tabId === saved.activeTabId)
              ? saved.activeTabId
              : nextTabs[0].tabId,
          );
          setActiveView(saved.activeView ?? "sessions");
          setLogsOpen(Boolean(saved.logsOpen));
          setRunModelOpen(Boolean(saved.runModelOpen || modelId || quantId));
        }
      }).finally(() => {
        hasHydratedWorkspace.current = true;
      });
      return;
    }

    api.sessions.get(targetId).then((s) => {
      const newTab: LabTab = {
        tabId: genId(),
        sessionId: s.id,
        label: s.label ?? `Session ${s.id.slice(0, 8)}`,
        status: s.status,
      };
      setTabs([newTab]);
      setActiveTabId(newTab.tabId);
    }).finally(() => {
      hasHydratedWorkspace.current = true;
    });
  }, []);

  useEffect(() => {
    if (!hasHydratedWorkspace.current) return;
    persistWorkspace({
      tabs,
      activeTabId,
      activeView,
      logsOpen,
      runModelOpen,
    });
  }, [tabs, activeTabId, activeView, logsOpen, runModelOpen]);

  // ── Tab management ─────────────────────────────────────────────────────────
  const addTab = useCallback((sessionId: string, label: string, status: "ACTIVE" | "TERMINATED") => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.sessionId === sessionId);
      if (existing) {
        setActiveTabId(existing.tabId);
        return prev;
      }
      const newTab: LabTab = { tabId: genId(), sessionId, label, status };
      setActiveTabId(newTab.tabId);
      return [...prev, newTab];
    });
  }, []);

  const confirmCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.tabId === tabId);
    if (!tab) return;
    if (tab.status === "ACTIVE") {
      setClosingTabId(tabId);
    } else {
      doCloseTab(tabId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  const doCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.tabId === tabId);
    if (tab?.status === "ACTIVE") {
      api.sessions.terminate(tab.sessionId).catch(() => {});
    }
    const remaining = tabs.filter((t) => t.tabId !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[remaining.length - 1]?.tabId ?? null);
    }
    setClosingTabId(null);
    // Cleanup live command buffers
    delete ptyBufferRef.current[tabId];
    setLiveCommandsMap((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, [tabs, activeTabId]);

  // L4 — process incoming PTY bytes for a tab, extract commands from PS1 markers
  const handlePtyData = useCallback((tabId: string, data: Uint8Array) => {
    const chunk = new TextDecoder().decode(data);
    ptyBufferRef.current[tabId] = (ptyBufferRef.current[tabId] ?? "") + chunk;
    const buf = ptyBufferRef.current[tabId];

    interface Marker { ms: number; code: number; idx: number; end: number }
    const markers: Marker[] = [];
    _PS1_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = _PS1_RE.exec(buf)) !== null) {
      markers.push({ ms: parseInt(m[1]), code: parseInt(m[2]), idx: m.index, end: m.index + m[0].length });
    }

    if (markers.length < 2) {
      if (buf.length > 100000) ptyBufferRef.current[tabId] = buf.slice(-50000);
      return;
    }

    const newCmds: ParsedCommand[] = [];
    for (let i = 0; i < markers.length - 1; i++) {
      const block = buf.slice(markers[i].end, markers[i + 1].idx);
      const cmd = _parsePtyBlock(block, markers[i].ms, markers[i + 1].ms, markers[i + 1].code);
      if (cmd) newCmds.push(cmd);
    }
    ptyBufferRef.current[tabId] = buf.slice(markers[markers.length - 1].idx);

    if (newCmds.length > 0) {
      setLiveCommandsMap((prev) => ({
        ...prev,
        [tabId]: [...(prev[tabId] ?? []), ...newCmds],
      }));
    }
  }, []);

  // ── Terminate the active tab's session ────────────────────────────────────
  const handleTerminateActive = useCallback(async () => {
    if (!activeTab || activeTab.status !== "ACTIVE") return;
    setIsTerminatingActive(true);
    try {
      await api.sessions.terminate(activeTab.sessionId);
      setTabs((prev) =>
        prev.map((t) => t.tabId === activeTabId ? { ...t, status: "TERMINATED" } : t)
      );
      const [nextSession, summary] = await Promise.all([
        api.sessions.get(activeTab.sessionId).catch(() => null),
        api.sessions.commandsSummary(activeTab.sessionId).catch(() => ({ commands: [] as ParsedCommand[], total: 0 })),
      ]);
      setSession(nextSession);
      setCommands(summary.commands);
      toast.success("Session terminated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to terminate");
    } finally {
      setIsTerminatingActive(false);
    }
  }, [activeTab, activeTabId]);

  const refreshCommands = useCallback(async () => {
    if (!activeSessionId) return;
    setCmdLoading(true);
    try {
      const [s, summary] = await Promise.all([
        api.sessions.get(activeSessionId),
        api.sessions.commandsSummary(activeSessionId),
      ]);
      setSession(s);
      setCommands([...sessionCommandsToParsed(s), ...summary.commands]);
    } finally {
      setCmdLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!logsOpen || !activeSessionId) return;
    if (!commands.some((cmd) => cmd.exit_code == null)) return;
    const id = window.setInterval(() => {
      refreshCommands();
    }, 3000);
    return () => window.clearInterval(id);
  }, [logsOpen, activeSessionId, commands, refreshCommands]);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    api.sessions.list(undefined, undefined, 0, 50)
      .then((r) => setHistorySessions(r.items))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  const handleSnapshotUpdated = useCallback((snap: MachineSnapshotPayload) => {
    setSession((prev) => prev ? { ...prev, latest_snapshot: snap } : prev);
  }, []);

  const closingTab = closingTabId ? tabs.find((t) => t.tabId === closingTabId) ?? null : null;

  // L4 — use live commands while session is active, fall back to API data after termination
  const liveCommands = activeTabId ? (liveCommandsMap[activeTabId] ?? []) : [];
  const effectiveCommands = activeTab?.status === "ACTIVE" && liveCommands.length > 0
    ? [...commands, ...liveCommands]
    : commands;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* Header / tab strip */}
      <div className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4">
        {/* Tabs */}
        <div className="flex flex-1 items-center gap-1 min-w-0">
          {tabs.map((tab) => (
            <div
              key={tab.tabId}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTabId(tab.tabId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveTabId(tab.tabId);
                }
              }}
              className={`flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                tab.tabId === activeTabId
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                tab.status === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground/30"
              }`} />
              <span className="max-w-[120px] truncate">{tab.label}</span>
              <button
                className="ml-0.5 rounded px-0.5 opacity-50 transition-all hover:bg-destructive/20 hover:text-destructive hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => { e.stopPropagation(); confirmCloseTab(tab.tabId); }}
                title="Close tab"
                aria-label={`Close ${tab.label} tab`}
              >
                ×
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowServerPicker(true)}
          >
            <Plus className="h-3 w-3" />
            New Session
          </Button>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-2">
          {activeTab && (
            <div className="hidden items-center gap-2 text-[11px] text-muted-foreground lg:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${activeTab.status === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
              <span className="max-w-[180px] truncate">{activeTab.label}</span>
            </div>
          )}
          {activeTab?.status === "ACTIVE" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive-secondary"
                  size="sm"
                  disabled={isTerminatingActive}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Power className="h-3 w-3" />
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
                    onClick={handleTerminateActive}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Terminate Session
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {tabs.length > 0 && (
            <Button
              variant={logsOpen ? "secondary" : "outline"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setLogsOpen((v) => !v)}
            >
              <History className="h-3 w-3" />
              {logsOpen ? "Hide Logs" : "Logs Panel"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => { setShowHistory(true); loadHistory(); }}
          >
            Session History
          </Button>
        </div>
      </div>

      {/* Secondary nav */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/20 px-4">
        {([
          { id: "sessions", label: "Sessions", icon: Terminal },
          { id: "machine", label: "Machine Info", icon: Cpu },
          { id: "runs", label: "Test Runs", icon: ListChecks },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
              activeView === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <Button
            size="sm"
            variant={runModelOpen ? "secondary" : "outline"}
            className="h-7 gap-1.5 text-xs"
            onClick={() => setRunModelOpen((v) => !v)}
            disabled={!activeTab}
          >
            <Play className="h-3 w-3" />
            Run Model
          </Button>
        </div>
      </div>

      {/* Main content */}
      {tabs.length === 0 ? (
        <AvailableServersPanel
          onStart={(sessionId, label) => addTab(sessionId, label, "ACTIVE")}
          onManageServers={() => setShowServerPicker(true)}
        />
      ) : (
        <div className="relative flex-1 overflow-hidden">
          {/* Sessions view — always mounted to keep PTY alive, hidden when inactive */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: activeView === "sessions" ? "flex" : "none" }}
          >
            {/* Outcome banner: appears when there's a RUNNING run for this server */}
            <OutcomeBanner serverId={session?.server_id ?? null} />

            <div className="relative flex-1 overflow-hidden">
            {tabs.map((tab) => (
              <div
                key={tab.tabId}
                className="absolute inset-0"
                style={{ display: tab.tabId === activeTabId ? "block" : "none" }}
              >
                {tab.status === "ACTIVE" ? (
                  <PtyTerminal
                    key={tab.sessionId}
                    sessionId={tab.sessionId}
                    theme={ptyTheme}
                    onDisconnect={() =>
                      setTabs((prev) =>
                        prev.map((t) => t.tabId === tab.tabId ? { ...t, status: "TERMINATED" } : t)
                      )
                    }
                    onData={(data) => handlePtyData(tab.tabId, data)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
                    Session terminated — terminal unavailable
                  </div>
                )}
              </div>
            ))}

            {/* Logs slide-in — no backdrop, terminal stays interactive */}
            <SessionLogsModal
              isOpen={logsOpen}
              onClose={() => setLogsOpen(false)}
              sessionId={activeSessionId}
              session={session}
              commands={effectiveCommands}
              cmdLoading={activeTab?.status === "ACTIVE" ? false : cmdLoading}
              onRefresh={refreshCommands}
            />
            </div>
          </div>

          {/* Machine Info */}
          {activeView === "machine" && (
            <MachineInfoTab
              session={session}
              onSnapshotUpdated={handleSnapshotUpdated}
            />
          )}

          {/* Test Runs */}
          {activeView === "runs" && (
            <TestRunsTab serverId={session?.server_id ?? null} />
          )}

          {/* Run Model Panel — absolute overlay at bottom */}
          <RunModelPanel
            open={runModelOpen}
            onClose={() => setRunModelOpen(false)}
            serverId={session?.server_id ?? null}
            sessionId={activeSessionId}
            models={models}
            modelsLoading={modelsLoading}
            pendingModelId={pendingModelId}
            pendingQuantId={pendingQuantId}
            onPendingConsumed={() => { setPendingModelId(null); setPendingQuantId(null); }}
            onCommandExecuted={() => {
              setLogsOpen(true);
              refreshCommands();
            }}
            onShowTerminal={() => setActiveView("sessions")}
          />
        </div>
      )}

      {/* Confirm close active tab */}
      <AlertDialog open={!!closingTab} onOpenChange={(open) => { if (!open) setClosingTabId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will terminate the active SSH session on{" "}
              <strong>{closingTab?.label}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closingTabId && doCloseTab(closingTabId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Close &amp; Terminate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Server picker */}
      {showServerPicker && (
        <ServerPickerModal
          onClose={() => setShowServerPicker(false)}
          onStart={(sessionId, label) => {
            addTab(sessionId, label, "ACTIVE");
            setShowServerPicker(false);
          }}
        />
      )}

      {/* History drawer */}
      <SessionDrawer
        open={showHistory}
        loading={historyLoading}
        sessions={historySessions}
        selectedId={activeSessionId}
        onClose={() => setShowHistory(false)}
        onRefresh={loadHistory}
        onSelect={(id) => {
          const s = historySessions.find((item) => item.id === id);
          if (s) addTab(id, s.server_hostname ?? `Session ${id.slice(0, 8)}`, s.status);
          setShowHistory(false);
        }}
      />
    </div>
  );
}

// ── Server Picker Modal ───────────────────────────────────────────────────────

function AvailableServersPanel({
  onStart,
  onManageServers,
}: {
  onStart: (sessionId: string, label: string) => void;
  onManageServers: () => void;
}) {
  const { data: serversData, isLoading } = useServers();
  const createSession = useCreateSession();
  const [startingId, setStartingId] = useState<string | null>(null);
  const servers = serversData?.items ?? [];
  const available = servers.filter((s) => s.status === "READY" || s.status === "PROVISIONING");

  async function start(server: Server) {
    setStartingId(server.id);
    try {
      const session = await createSession.mutateAsync({ server_id: server.id });
      onStart(session.id, server.hostname);
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-base font-semibold">Lab Servers</h1>
        <p className="text-xs text-muted-foreground">Start a terminal session from an available machine.</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading servers...</p>
        ) : available.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
            <Terminal className="mb-3 h-8 w-8 opacity-25" />
            No ready servers are available.
            <div className="mt-4">
              <Button size="sm" onClick={onManageServers}>Add or rent a server</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {available.map((server) => (
              <Card key={server.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{server.hostname}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {server.gpu_model ?? "GPU unknown"}{server.vram_gb ? ` · ${server.vram_gb} GB` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      {server.ssh_username}@{server.hostname}:{server.ssh_port}
                    </p>
                  </div>
                  <StatusBadge status={server.status} />
                </div>
                <Button
                  size="sm"
                  className="mt-4 h-8 w-full gap-1.5 text-xs"
                  disabled={!!startingId}
                  loading={startingId === server.id}
                  onClick={() => start(server)}
                >
                  <Terminal className="h-3 w-3" />
                  Start session
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServerPickerModal({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (sessionId: string, label: string) => void;
}) {
  const { data: serversData, isLoading } = useServers();
  const createSession = useCreateSession();
  const [startingId, setStartingId] = useState<string | null>(null);

  const readyServers = (serversData?.items ?? []).filter(
    (s: Server) => s.status === "READY" || s.status === "PROVISIONING"
  );

  async function handleStart(server: Server) {
    setStartingId(server.id);
    try {
      const session = await createSession.mutateAsync({ server_id: server.id });
      onStart(session.id, server.hostname);
    } catch {
      setStartingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <Card className="w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Start New Session</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading servers…</p>
        ) : readyServers.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">No servers available.</p>
            <Link
              href="/servers"
              className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
            >
              Go to Servers →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {readyServers.map((server: Server) => (
              <button
                key={server.id}
                onClick={() => handleStart(server)}
                disabled={!!startingId}
                className="w-full rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{server.hostname}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {server.gpu_model ?? "GPU unknown"} · {server.ssh_username}
                    </p>
                  </div>
                  {startingId === server.id && (
                    <span className="text-xs text-muted-foreground">Connecting…</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Session Drawer (History browser) ─────────────────────────────────────────

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
        className={`absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        aria-label="Close history drawer"
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-sm border-l border-border bg-background shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <div>
              <h2 className="text-sm font-semibold">Session History</h2>
              <p className="text-xs text-muted-foreground">Open a session as a tab</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                {loading ? "…" : "Refresh"}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading && sessions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No sessions found.</div>
            ) : (
              <div className="space-y-1">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      s.id === selectedId
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/70 hover:bg-muted/40"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {s.label ?? `Session ${s.id.slice(0, 8)}`}
                      </span>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.server_hostname ?? s.server_id.slice(0, 8)}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground/70">
                      <span>
                        {s.command_count} cmd{s.command_count !== 1 ? "s" : ""}
                      </span>
                      <span>{new Date(s.started_at).toLocaleString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
