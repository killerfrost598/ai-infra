"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Server, SessionListItem, SSHTestResult, TaskRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [server, setServer] = useState<Server | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const [sshTest, setSshTest] = useState<SSHTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const [history, setHistory] = useState<TaskRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [deleting, setDeleting] = useState(false);

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [startingSession, setStartingSession] = useState(false);

  // ── Load server ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.servers.get(id).then(setServer).catch((e: Error) => setServerError(e.message));
  }, [id]);

  // ── SSH sessions ─────────────────────────────────────────────────────────────
  const loadSessions = useCallback(() => {
    api.sessions
      .list(id, undefined, 0, 10)
      .then((res) => setSessions(res.items))
      .finally(() => setSessionsLoading(false));
  }, [id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function startSession() {
    setStartingSession(true);
    try {
      const session = await api.sessions.create({ server_id: id });
      router.push(`/sessions/${session.id}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to start session");
      setStartingSession(false);
    }
  }

  // ── Task run history ─────────────────────────────────────────────────────────
  const loadHistory = useCallback(() => {
    api.taskRuns.list(0, 30, id)
      .then((res) => setHistory(res.items))
      .finally(() => setHistoryLoading(false));
  }, [id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── SSH test ─────────────────────────────────────────────────────────────────
  async function testSSH() {
    setTesting(true);
    setSshTest(null);
    try {
      const result = await api.servers.ssh.test(id);
      setSshTest(result);
    } catch (err: unknown) {
      setSshTest({ success: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!server) return;
    if (!confirm(`Permanently delete ${server.hostname}?\n\nThis removes the server record and all associated task runs. The server itself is NOT terminated on the provider.`)) return;
    setDeleting(true);
    try {
      await api.servers.delete(id);
      router.push("/servers");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (serverError) return (
    <div className="space-y-3">
      <Link href="/servers" className="btn-ghost px-0 text-zinc-500">← Servers</Link>
      <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{serverError}</p>
    </div>
  );

  if (!server) return (
    <div className="space-y-3">
      <Link href="/servers" className="btn-ghost px-0 text-zinc-500">← Servers</Link>
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        Loading…
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <Link href="/servers" className="btn-ghost px-0 text-zinc-500">← Servers</Link>
        <button onClick={handleDelete} disabled={deleting} className="btn-danger text-xs">
          {deleting ? "Deleting…" : "Delete server"}
        </button>
      </div>

      {/* Server info card */}
      <div className="card px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">{server.hostname}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
              <span>{server.ssh_username}@{server.hostname}:{server.ssh_port}</span>
              {server.has_ssh_key && (
                <span className="inline-flex items-center gap-1 text-xs text-indigo-400">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                  private key
                </span>
              )}
              {!server.has_ssh_key && server.has_ssh_password && (
                <span className="text-xs text-zinc-600">password auth</span>
              )}
              {!server.has_ssh_key && !server.has_ssh_password && (
                <span className="text-xs text-amber-500">no auth configured</span>
              )}
            </div>
          </div>
          <StatusBadge status={server.status} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "GPU", value: server.gpu_model ?? "—" },
            { label: "VRAM", value: server.vram_gb != null ? `${server.vram_gb} GB` : "—" },
            { label: "CUDA", value: server.cuda_version ?? "—" },
            { label: "RAM", value: server.ram_gb != null ? `${server.ram_gb} GB` : "—" },
            { label: "OS", value: server.os_image ?? "—" },
            { label: "Provider ID", value: server.external_server_id },
            { label: "Registered", value: new Date(server.created_at).toLocaleDateString() },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-zinc-900/60 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{label}</p>
              <p className="mt-0.5 truncate text-sm text-zinc-300">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* SSH connectivity */}
      <div className="card px-6 py-4">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-zinc-300">SSH Connectivity</h2>
          <button onClick={testSSH} disabled={testing} className="btn-secondary text-xs py-1.5 px-3">
            {testing ? (
              <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" /> Testing…</>
            ) : "Test connection"}
          </button>
          {sshTest && (
            <span className={`flex items-center gap-1.5 text-sm ${sshTest.success ? "text-emerald-400" : "text-rose-400"}`}>
              {sshTest.success
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              }
              {sshTest.message}
            </span>
          )}
        </div>
      </div>

      {/* SSH Sessions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-label">SSH Sessions</h2>
          <div className="flex items-center gap-2">
            <Link href={`/sessions?server_id=${id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
              View all →
            </Link>
            <button
              onClick={startSession}
              disabled={startingSession}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {startingSession ? (
                <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400/40 border-t-white" /> Starting…</>
              ) : "Start session"}
            </button>
          </div>
        </div>

        {sessionsLoading && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
            Loading…
          </div>
        )}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-xs text-zinc-600">No sessions for this server yet.</p>
        )}
        <div className="space-y-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/sessions/${s.id}`}
              className="card flex items-center gap-4 px-4 py-3 hover:border-zinc-700 transition-colors"
            >
              <StatusBadge status={s.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200">
                  {s.label ?? <span className="text-zinc-500 italic">unlabeled</span>}
                </p>
                <p className="mt-0.5 text-xs text-zinc-600">{s.command_count} command{s.command_count !== 1 ? "s" : ""}</p>
              </div>
              <p className="shrink-0 text-xs text-zinc-500">{new Date(s.started_at).toLocaleString()}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Task history */}
      <div className="space-y-3">
        <h2 className="section-label">Task History</h2>
        {historyLoading && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
            Loading…
          </div>
        )}
        {!historyLoading && history.length === 0 && (
          <p className="text-xs text-zinc-600">No task runs for this server yet.</p>
        )}
        <div className="space-y-2">
          {history.map((r) => (
            <Link
              key={r.id}
              href={`/task-runs/${r.id}`}
              className="card flex items-center gap-4 px-4 py-3 hover:border-zinc-700 transition-colors"
            >
              <StatusBadge status={r.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200">{r.task_type}</p>
                {r.metadata_json?.command && (
                  <p className="mt-0.5 truncate font-mono text-xs text-zinc-600">
                    $ {String(r.metadata_json.command)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right text-xs text-zinc-500">
                <p>{r.started_at ? new Date(r.started_at).toLocaleString() : "queued"}</p>
                {r.duration_seconds != null && <p>{r.duration_seconds}s</p>}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
