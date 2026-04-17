"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ParsedCommand, Session, SessionListItem } from "@/lib/types";
import { PtyTerminal } from "@/components/PtyTerminal";

type RightTab = "commands" | "output" | "log" | "playbook";

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
  const [session, setSession] = useState<Session | null>(null);
  const [commands, setCommands] = useState<ParsedCommand[]>([]);
  const [activeTab, setActiveTab] = useState<RightTab>("commands");
  const [selectedCmd, setSelectedCmd] = useState<ParsedCommand | null>(null);
  const [playbookContext, setPlaybookContext] = useState("");
  const [playbookYaml, setPlaybookYaml] = useState("");
  const [playbookLoading, setPlaybookLoading] = useState(false);
  const [playbookError, setPlaybookError] = useState<string | null>(null);
  const [cmdLoading, setCmdLoading] = useState(false);
  const terminalKey = useRef(0);

  useEffect(() => {
    api.sessions.list(undefined, "ACTIVE", 0, 50).then((r) => setSessions(r.items));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setCommands([]);
    setSelectedCmd(null);
    setPlaybookYaml("");
    setPlaybookError(null);
    setCmdLoading(true);

    Promise.all([
      api.sessions.get(selectedId),
      api.sessions.commandsSummary(selectedId),
    ]).then(([s, summary]) => {
      setSession(s);
      setCommands(summary.commands);
    }).catch(() => {
      setSession(null);
    }).finally(() => setCmdLoading(false));
  }, [selectedId]);

  async function refreshCommands() {
    if (!selectedId) return;
    setCmdLoading(true);
    try {
      const summary = await api.sessions.commandsSummary(selectedId);
      setCommands(summary.commands);
    } finally {
      setCmdLoading(false);
    }
  }

  async function handleConvert() {
    if (!selectedId) return;
    setPlaybookLoading(true);
    setPlaybookError(null);
    setPlaybookYaml("");
    try {
      const result = await api.sessions.toPlaybook(selectedId, playbookContext);
      setPlaybookYaml(result.playbook_yaml);
      setActiveTab("playbook");
    } catch (e) {
      setPlaybookError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPlaybookLoading(false);
    }
  }

  function copyPlaybook() {
    navigator.clipboard.writeText(playbookYaml);
  }

  const ptySessionId = selectedId && session?.status === "ACTIVE" ? selectedId : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-zinc-800/70 bg-zinc-950 px-6 shrink-0">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Lab</h1>
          <p className="text-xs text-zinc-500">Interactive terminal + command history + playbook builder</p>
        </div>
        <select
          className="input w-72 text-sm"
          value={selectedId ?? ""}
          onChange={(e) => {
            terminalKey.current += 1;
            setSelectedId(e.target.value || null);
          }}
        >
          <option value="">— select an active session —</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.server_hostname ?? s.server_id.slice(0, 8)} · {s.label ?? s.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {!selectedId ? (
        <div className="flex flex-1 items-center justify-center text-zinc-500 text-sm">
          Select an active session above to begin.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: terminal */}
          <div className="flex flex-col" style={{ width: "60%", minWidth: 0 }}>
            <div className="flex h-8 items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/40 px-3">
              <span className="text-xs text-zinc-500">Terminal</span>
              {session?.status === "TERMINATED" && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">terminated</span>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {ptySessionId ? (
                <PtyTerminal
                  key={`${ptySessionId}-${terminalKey.current}`}
                  sessionId={ptySessionId}
                  onDisconnect={refreshCommands}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-600 text-sm">
                  Session is terminated — terminal unavailable
                </div>
              )}
            </div>
          </div>

          {/* Right: panel */}
          <div className="flex flex-col border-l border-zinc-800/70" style={{ width: "40%", minWidth: 0 }}>
            {/* Tab bar */}
            <div className="flex h-8 shrink-0 items-center border-b border-zinc-800/60 bg-zinc-900/40">
              {(["commands", "output", "log", "playbook"] as RightTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`h-full px-4 text-xs transition-colors ${
                    activeTab === tab
                      ? "border-b-2 border-indigo-500 text-indigo-400"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {tab === "commands" ? `Commands${commands.length ? ` (${commands.length})` : ""}` :
                   tab === "output" ? "Output" :
                   tab === "log" ? "Full Log" : "Playbook"}
                </button>
              ))}
              {activeTab === "commands" && (
                <button
                  onClick={refreshCommands}
                  disabled={cmdLoading}
                  className="ml-auto mr-2 rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
                  title="Refresh"
                >
                  {cmdLoading ? "..." : "↻"}
                </button>
              )}
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
              {activeTab === "output" && (
                <OutputTab cmd={selectedCmd} onBack={() => setActiveTab("commands")} />
              )}
              {activeTab === "log" && (
                <LogTab ptyLog={session?.pty_log ?? null} />
              )}
              {activeTab === "playbook" && (
                <PlaybookTab
                  commands={commands}
                  context={playbookContext}
                  onContextChange={setPlaybookContext}
                  onConvert={handleConvert}
                  loading={playbookLoading}
                  error={playbookError}
                  yaml={playbookYaml}
                  onCopy={copyPlaybook}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  if (loading) return <div className="p-4 text-xs text-zinc-500">Loading commands…</div>;
  if (!commands.length)
    return (
      <div className="p-4 text-xs text-zinc-500">
        No commands detected yet. PROMPT_COMMAND markers are injected on session open —
        commands will appear here after you run them.
      </div>
    );

  return (
    <div className="divide-y divide-zinc-800/50">
      {commands.map((cmd, i) => (
        <button
          key={i}
          onClick={() => onSelect(cmd)}
          className={`w-full px-3 py-2 text-left transition-colors hover:bg-zinc-800/40 ${
            selectedCmd === cmd ? "bg-zinc-800/60" : ""
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                cmd.exit_code === 0 ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            <code className="flex-1 truncate text-xs text-zinc-200">{cmd.command}</code>
            <span className="shrink-0 text-[10px] text-zinc-600">{formatDuration(cmd.duration_ms)}</span>
          </div>
          <div className="mt-0.5 pl-3.5 text-[10px] text-zinc-600">{formatTime(cmd.started_ms)}</div>
        </button>
      ))}
    </div>
  );
}

function OutputTab({ cmd, onBack }: { cmd: ParsedCommand | null; onBack: () => void }) {
  if (!cmd)
    return (
      <div className="p-4 text-xs text-zinc-500">
        Select a command from the Commands tab to see its output.
      </div>
    );

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-[10px] text-zinc-500 hover:text-zinc-300">
          ← back
        </button>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            cmd.exit_code === 0
              ? "bg-emerald-900/40 text-emerald-400"
              : "bg-red-900/40 text-red-400"
          }`}
        >
          exit {cmd.exit_code}
        </span>
        <span className="text-[10px] text-zinc-600">{formatDuration(cmd.duration_ms)}</span>
        <span className="text-[10px] text-zinc-600">{formatTime(cmd.started_ms)}</span>
      </div>
      <code className="mb-2 block text-xs text-indigo-300">$ {cmd.command}</code>
      {cmd.output ? (
        <pre className="terminal overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
          {cmd.output}
        </pre>
      ) : (
        <p className="text-xs text-zinc-600">(no output)</p>
      )}
    </div>
  );
}

function LogTab({ ptyLog }: { ptyLog: string | null }) {
  if (!ptyLog)
    return <div className="p-4 text-xs text-zinc-500">No PTY log available for this session.</div>;
  return (
    <pre className="terminal m-3 overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
      {ptyLog}
    </pre>
  );
}

function PlaybookTab({
  commands,
  context,
  onContextChange,
  onConvert,
  loading,
  error,
  yaml,
  onCopy,
}: {
  commands: ParsedCommand[];
  context: string;
  onContextChange: (v: string) => void;
  onConvert: () => void;
  loading: boolean;
  error: string | null;
  yaml: string;
  onCopy: () => void;
}) {
  const successCount = commands.filter((c) => c.exit_code === 0).length;

  return (
    <div className="p-3">
      <p className="mb-3 text-xs text-zinc-400">
        Convert {successCount} successful command{successCount !== 1 ? "s" : ""} into an Ansible playbook using Claude.
      </p>
      <label className="section-label mb-1 block">Context (optional)</label>
      <input
        className="input mb-3 w-full text-xs"
        placeholder="e.g. Deploy vLLM with Mistral 7B"
        value={context}
        onChange={(e) => onContextChange(e.target.value)}
      />
      <button
        onClick={onConvert}
        disabled={loading || commands.length === 0}
        className="btn-primary w-full text-sm disabled:opacity-40"
      >
        {loading ? "Generating…" : "Convert to Playbook"}
      </button>
      {error && (
        <p className="mt-2 rounded bg-red-950/40 px-3 py-2 text-xs text-red-400">{error}</p>
      )}
      {yaml && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="section-label">Generated Playbook</span>
            <button onClick={onCopy} className="btn-ghost text-[10px]">
              Copy
            </button>
          </div>
          <pre className="terminal overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
            {yaml}
          </pre>
        </div>
      )}
    </div>
  );
}
