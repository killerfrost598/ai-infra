"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Clock3, Copy, FileText, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import type { InferenceBenchmark, Server, SessionListItem, SSHTestResult, TaskRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const [gpuBenchmarks, setGpuBenchmarks] = useState<InferenceBenchmark[]>([]);
  const [benchmarksLoading, setBenchmarksLoading] = useState(false);

  // Task run detail modal
  const [taskRunModal, setTaskRunModal] = useState<TaskRun | null>(null);
  const [taskRunLogs, setTaskRunLogs] = useState<string>("");
  const [taskRunLogsLoading, setTaskRunLogsLoading] = useState(false);
  const [taskRunLogsCopied, setTaskRunLogsCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      api.servers.get(id),
      api.sessions.list(id, undefined, 0, 10),
      api.taskRuns.list(0, 30, id),
    ])
      .then(([s, sessRes, histRes]) => {
        setServer(s);
        setSessions(sessRes.items);
        setHistory(histRes.items);
        if (s.gpu_model) {
          setBenchmarksLoading(true);
          api.benchmarks
            .forGpu(s.gpu_model)
            .then((res) => setGpuBenchmarks(res.items))
            .finally(() => setBenchmarksLoading(false));
        }
      })
      .catch((e: Error) => setServerError(e.message))
      .finally(() => {
        setSessionsLoading(false);
        setHistoryLoading(false);
      });
  }, [id]);

  async function startSession() {
    setStartingSession(true);
    try {
      const session = await api.sessions.create({ server_id: id });
      sessionStorage.setItem("lab_session_id", session.id);
      router.push("/lab");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to start session");
      setStartingSession(false);
    }
  }

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

  async function openTaskRunModal(run: TaskRun) {
    setTaskRunModal(run);
    setTaskRunLogsLoading(true);
    setTaskRunLogs("");
    setTaskRunLogsCopied(false);
    try {
      const logs = await api.taskRuns.logs(run.id);
      setTaskRunLogs(logs);
    } catch {
      setTaskRunLogs("");
    } finally {
      setTaskRunLogsLoading(false);
    }
  }

  if (serverError) return (
    <div className="space-y-3">
      <Link href="/servers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Servers</Link>
      <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{serverError}</p>
    </div>
  );

  if (!server) return (
    <div className="space-y-3">
      <Link href="/servers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Servers</Link>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
        Loading…
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <Link href="/servers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Servers</Link>
        <Button variant="destructive" size="sm" loading={deleting} onClick={handleDelete}>
          {deleting ? "Deleting…" : "Delete server"}
        </Button>
      </div>

      {/* Server info card */}
      <Card className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{server.hostname}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{server.ssh_username}@{server.hostname}:{server.ssh_port}</span>
              {server.has_ssh_key && (
                <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                  private key
                </span>
              )}
              {!server.has_ssh_key && server.has_ssh_password && (
                <span className="text-xs text-muted-foreground/60">password auth</span>
              )}
              {!server.has_ssh_key && !server.has_ssh_password && (
                <span className="text-xs text-amber-600 dark:text-amber-500">no auth configured</span>
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
            <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</p>
              <p className="mt-0.5 truncate text-sm text-foreground/80">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* SSH connectivity */}
      <Card className="px-6 py-4">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold">SSH Connectivity</h2>
          <Button variant="outline" size="sm" loading={testing} onClick={testSSH}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {sshTest && (
            <span className={`flex items-center gap-1.5 text-sm ${sshTest.success ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {sshTest.success
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              }
              {sshTest.message}
            </span>
          )}
        </div>
      </Card>

      {/* SSH Sessions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">SSH Sessions</h2>
          <Button size="sm" loading={startingSession} onClick={startSession}>
            {!startingSession && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            )}
            {startingSession ? "Connecting…" : "Open terminal"}
          </Button>
        </div>

        {sessionsLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
            Loading…
          </div>
        )}
        {!sessionsLoading && sessions.length === 0 && (
          <p className="text-xs text-muted-foreground/60">No sessions for this server yet.</p>
        )}
        <div className="space-y-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                sessionStorage.setItem("lab_session_id", s.id);
                router.push(`/lab?session=${encodeURIComponent(s.id)}`);
              }}
              className="flex w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 hover:border-muted-foreground/30 transition-colors text-left"
            >
              <StatusBadge status={s.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  {s.label ?? <span className="text-muted-foreground italic">unlabeled</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">{s.command_count} command{s.command_count !== 1 ? "s" : ""}</p>
              </div>
              <p className="shrink-0 text-xs text-muted-foreground">{new Date(s.started_at).toLocaleString()}</p>
            </button>
          ))}
        </div>
      </div>

      {/* GPU Benchmarks */}
      {server.gpu_model && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">GPU Benchmarks</h2>
            <Link href={`/benchmarks?gpu=${encodeURIComponent(server.gpu_model)}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          </div>
          {benchmarksLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
              Loading…
            </div>
          )}
          {!benchmarksLoading && gpuBenchmarks.length === 0 && (
            <p className="text-xs text-muted-foreground/60">
              No benchmarks for {server.gpu_model} yet.{" "}
              <Link href="/benchmarks" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">Record one →</Link>
            </p>
          )}
          {gpuBenchmarks.length > 0 && (
            <div className="space-y-2">
              {gpuBenchmarks.slice(0, 5).map((b) => (
                <Card key={b.id} className="px-4 py-3 flex items-center gap-4 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-foreground/80">{b.model_name}</p>
                    {b.quantization && <p className="text-xs text-muted-foreground/60">{b.quantization}</p>}
                  </div>
                  {b.tokens_per_second_avg != null && (
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-emerald-600 dark:text-emerald-400">{b.tokens_per_second_avg.toFixed(1)} t/s</p>
                      {b.max_parallel_connections != null && (
                        <p className="text-xs text-muted-foreground/60">{b.max_parallel_connections} concurrent</p>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task history */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Task History</h2>
        {historyLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
            Loading…
          </div>
        )}
        {!historyLoading && history.length === 0 && (
          <p className="text-xs text-muted-foreground/60">No task runs for this server yet.</p>
        )}
        <div className="space-y-2">
          {history.map((r) => (
            <button
              key={r.id}
              onClick={() => openTaskRunModal(r)}
              className="flex w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 hover:border-muted-foreground/30 transition-colors text-left"
            >
              <StatusBadge status={r.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{r.task_type}</p>
                {r.metadata_json?.command != null && (
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground/60">
                    $ {String(r.metadata_json.command)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <p>{r.started_at ? new Date(r.started_at).toLocaleString() : "queued"}</p>
                {r.duration_seconds != null && <p>{r.duration_seconds}s</p>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Task run detail modal ────────────────────────────────────────────── */}
      <Dialog open={!!taskRunModal} onOpenChange={(open) => { if (!open) { setTaskRunModal(null); setTaskRunLogsCopied(false); } }}>
        <DialogContent size="lg" className="max-h-[86vh] overflow-hidden border border-border/80 bg-gradient-to-b from-background to-muted/20">
          <DialogHeader className="bg-gradient-to-r from-muted/40 to-background">
            <DialogTitle className="flex items-center gap-3">
              {taskRunModal && <StatusBadge status={taskRunModal.status} />}
              <span>{taskRunModal?.task_type}</span>
            </DialogTitle>
            <DialogDescription>
              Inspect execution logs and timing for this server task.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="gap-3">
            {taskRunModal && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Started</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-foreground/85">
                    <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                    {taskRunModal.started_at ? new Date(taskRunModal.started_at).toLocaleString() : "queued"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Duration</p>
                  <p className="mt-1 text-xs text-foreground/85">
                    {taskRunModal.duration_seconds != null ? `${taskRunModal.duration_seconds}s` : "running"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Run ID</p>
                  <p className="mt-1 truncate font-mono text-xs text-foreground/85">{taskRunModal.id}</p>
                </div>
              </div>
            )}

            {taskRunModal?.error_summary && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{taskRunModal.error_summary}</span>
              </div>
            )}

            <div className="rounded-xl border border-border/70 bg-background/70 shadow-sm">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  Execution Logs
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!taskRunLogs || taskRunLogsLoading}
                  className="h-6 gap-1.5 px-2 text-[11px]"
                  onClick={async () => {
                    if (!taskRunLogs) return;
                    try {
                      await navigator.clipboard.writeText(taskRunLogs);
                      setTaskRunLogsCopied(true);
                      window.setTimeout(() => setTaskRunLogsCopied(false), 1800);
                    } catch {
                      setTaskRunLogsCopied(false);
                    }
                  }}
                >
                  {taskRunLogsCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {taskRunLogsCopied ? "Copied" : "Copy logs"}
                </Button>
              </div>

              <div className="max-h-[50vh] overflow-auto">
                {taskRunLogsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
                    Loading logs…
                  </div>
                ) : taskRunLogs ? (
                  <pre className="terminal whitespace-pre-wrap p-4 text-xs leading-relaxed">
                    {taskRunLogs}
                  </pre>
                ) : (
                  <p className="py-10 text-center text-xs text-muted-foreground/70">No logs available.</p>
                )}
              </div>
            </div>
          </DialogBody>

          <DialogFooter className="px-4 py-3">
            <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              {taskRunModal?.status === "SUCCESS" ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  Completed successfully
                </>
              ) : null}
            </div>
            {taskRunModal && (
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link href={`/task-runs/${taskRunModal.id}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open full view
                </Link>
              </Button>
            )}
            <Button size="sm" onClick={() => setTaskRunModal(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
