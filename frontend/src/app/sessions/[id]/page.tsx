"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Session, SessionCommand } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

// xterm uses browser DOM — skip SSR entirely.
const PtyTerminal = dynamic(
  () => import("@/components/PtyTerminal").then((m) => m.PtyTerminal),
  { ssr: false }
);

type Tab = "terminal" | "history";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("terminal");
  const [terminating, setTerminating] = useState(false);

  const loadSession = useCallback(() => {
    api.sessions
      .get(id)
      .then(setSession)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // When the WS closes, reload session so pty_log shows in History.
  function handleTerminalDisconnect() {
    loadSession();
  }

  async function handleTerminate() {
    if (!confirm("Terminate this session? The SSH connection will be closed.")) return;
    setTerminating(true);
    try {
      await api.sessions.terminate(id);
      loadSession();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Terminate failed");
    } finally {
      setTerminating(false);
    }
  }

  if (error) return (
    <div className="space-y-3">
      <Link href="/sessions" className="btn-ghost px-0 text-zinc-500">← Sessions</Link>
      <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
    </div>
  );

  if (!session) return (
    <div className="space-y-3">
      <Link href="/sessions" className="btn-ghost px-0 text-zinc-500">← Sessions</Link>
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        Loading…
      </div>
    </div>
  );

  const isActive = session.status === "ACTIVE";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/sessions" className="btn-ghost px-0 text-zinc-500 shrink-0">← Sessions</Link>
          <StatusBadge status={session.status} />
          <h1 className="truncate text-base font-semibold text-zinc-100">
            {session.label ?? `Session ${session.id.slice(0, 8)}`}
          </h1>
          <Link href={`/servers/${session.server_id}`} className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300">
            {session.server_id.slice(0, 8)}…
          </Link>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={api.sessions.downloadTranscriptUrl(id)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs py-1.5 px-3"
          >
            Download
          </a>
          {isActive && (
            <button
              onClick={handleTerminate}
              disabled={terminating}
              className="btn-danger text-xs"
            >
              {terminating ? "Terminating…" : "Terminate"}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        <TabButton active={tab === "terminal"} onClick={() => setTab("terminal")} disabled={!isActive}>
          Terminal
          {isActive && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          History
          {session.commands.length > 0 && (
            <span className="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {session.commands.length}
            </span>
          )}
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {tab === "terminal" && (
          <div className="h-full rounded-lg overflow-hidden border border-zinc-800">
            {isActive ? (
              <PtyTerminal sessionId={id} onDisconnect={handleTerminalDisconnect} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-500">Session is terminated. Switch to History to view output.</p>
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="h-full overflow-y-auto space-y-4 pr-1">
            {/* PTY raw log */}
            {session.pty_log && (
              <div className="card overflow-hidden">
                <div className="border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-400">PTY session output</span>
                  <span className="text-[10px] text-zinc-600">{session.pty_log.length.toLocaleString()} chars</span>
                </div>
                <pre className="terminal max-h-96 overflow-auto p-4 text-xs whitespace-pre-wrap scrollbar-thin">
                  {session.pty_log}
                </pre>
              </div>
            )}

            {/* HTTP command history */}
            {session.commands.length > 0 && (
              <div className="space-y-2">
                <p className="section-label">Command history</p>
                {session.commands.map((cmd) => (
                  <CommandBlock key={cmd.id} cmd={cmd} sessionId={id} />
                ))}
              </div>
            )}

            {!session.pty_log && session.commands.length === 0 && (
              <div className="card px-6 py-10 text-center">
                <p className="text-sm text-zinc-500">No history recorded yet.</p>
                {isActive && (
                  <p className="mt-1 text-xs text-zinc-600">
                    Switch to Terminal to interact — output is saved when the session closes.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-4 py-2 text-sm border-b-2 transition-colors ${
        active
          ? "border-indigo-500 text-indigo-400 font-medium"
          : "border-transparent text-zinc-500 hover:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
      }`}
    >
      {children}
    </button>
  );
}

function CommandBlock({ cmd, sessionId }: { cmd: SessionCommand; sessionId: string }) {
  const exitOk = cmd.exit_code === 0;
  return (
    <div className="card space-y-1.5 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-zinc-600 font-mono text-xs">[{cmd.sequence_num}]</span>
          <span className="text-indigo-400 font-mono text-xs">$</span>
          <span className="font-mono text-sm text-zinc-200 truncate">{cmd.command}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs text-zinc-600">
          <span className={exitOk ? "text-emerald-500" : "text-rose-400"}>exit {cmd.exit_code ?? "?"}</span>
          {cmd.duration_ms != null && <span>{cmd.duration_ms}ms</span>}
          <a
            href={api.sessions.downloadCommandUrl(sessionId, cmd.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-400"
            title="Download output"
          >
            ↓
          </a>
        </div>
      </div>
      {(cmd.stdout || cmd.stderr) && (
        <pre className="rounded bg-zinc-900/60 px-3 py-2 font-mono text-xs text-zinc-300 whitespace-pre-wrap overflow-x-auto max-h-48">
          {cmd.stdout}
          {cmd.stderr && <span className="text-rose-400">{cmd.stderr}</span>}
        </pre>
      )}
    </div>
  );
}
