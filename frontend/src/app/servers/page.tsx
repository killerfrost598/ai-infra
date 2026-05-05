"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { keys, useServers, useRentals, useCreateServer, useDeleteServer, useCreateSession } from "@/lib/queries";
import type { CloreRental, Server, ServerCreate, SSHTestResult } from "@/lib/types";
import { serverSchema, type ServerFormValues } from "@/lib/schemas";
import { StatusBadge } from "@/components/StatusBadge";
import { PtyTerminal } from "@/components/PtyTerminal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layouts/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/layouts/page-states";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ServersPage() {
  const { data: serversData, isLoading, error } = useServers();
  const { data: rentalsData } = useRentals();
  const servers: Server[] = serversData?.items ?? [];
  const total = serversData?.total ?? 0;
  const rentals: CloreRental[] = rentalsData?.rentals ?? [];

  const createServer = useCreateServer();
  const deleteServer = useDeleteServer();
  const createSession = useCreateSession();

  const qc = useQueryClient();

  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [startingSSH, setStartingSSH] = useState<string | null>(null);
  const [terminalSession, setTerminalSession] = useState<{ id: string; serverName: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [sshTestResults, setSshTestResults] = useState<Record<string, SSHTestResult>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const [sshPrivateKey, setSshPrivateKey] = useState("");

  const form = useForm<ServerFormValues>({
    resolver: zodResolver(serverSchema),
    defaultValues: {
      hostname: "",
      ssh_username: "root",
      ssh_port: 22,
      ssh_password: "",
      gpu_model: "",
      notes: "",
    },
  });

  const unregisteredRentals = useMemo(() => {
    const extIds = new Set(servers.map((s) => s.external_server_id));
    return rentals.filter((r) => !extIds.has(r.id));
  }, [rentals, servers]);

  // Auto-poll every 10 s while any server is in PROVISIONING state (S3)
  const hasProvisioning = servers.some((s) => s.status === "PROVISIONING");
  useEffect(() => {
    if (!hasProvisioning) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: keys.servers() });
    }, 10000);
    return () => clearInterval(id);
  }, [hasProvisioning, qc]);

  async function handleTestSSH(serverId: string) {
    setTestingId(serverId);
    setExpandedTestId(serverId);
    try {
      const result = await api.servers.ssh.test(serverId);
      setSshTestResults((prev) => ({ ...prev, [serverId]: result }));
      if (result.success) {
        qc.invalidateQueries({ queryKey: keys.servers() });
      }
    } catch (e) {
      setSshTestResults((prev) => ({
        ...prev,
        [serverId]: {
          success: false,
          message: e instanceof Error ? e.message : "Test failed",
          steps: [{ step: "error", success: false, message: e instanceof Error ? e.message : "Unknown error", elapsed_ms: 0 }],
        },
      }));
    } finally {
      setTestingId(null);
    }
  }

  function openForm() {
    form.reset();
    setSshPrivateKey("");
    setFormError(null);
    setAuthMode("password");
    setShowForm(true);
  }

  async function handleStartSSH(serverId: string, serverName: string) {
    setStartingSSH(serverId);
    try {
      const session = await createSession.mutateAsync({ server_id: serverId });
      setTerminalSession({ id: session.id, serverName });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to start SSH session");
    } finally {
      setStartingSSH(null);
    }
  }

  const handleSubmit = form.handleSubmit(async (data: ServerFormValues) => {
    setFormError(null);
    const payload: ServerCreate = {
      external_server_id: `manual-${Date.now()}`,
      hostname: data.hostname,
      ssh_port: data.ssh_port,
      ssh_username: data.ssh_username,
      ssh_password: authMode === "password" && data.ssh_password ? data.ssh_password : undefined,
      ssh_private_key: authMode === "key" && sshPrivateKey ? sshPrivateKey : undefined,
      gpu_model: data.gpu_model || undefined,
    };
    createServer.mutate(payload, {
      onSuccess: () => {
        setShowForm(false);
        form.reset();
        setSshPrivateKey("");
      },
      onError: (err) => setFormError(err.message),
    });
  });

  function handleDelete(server: Server) {
    setDeleteTarget(server);
  }

  function confirmDeleteServer() {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    deleteServer.mutate(deleteTarget.id, {
      onSettled: () => {
        setDeletingId(null);
        setDeleteTarget(null);
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Servers"
        description={!isLoading ? `${total} registered` : "Register external or rented servers and manage SSH access."}
        actions={(
          <Button onClick={openForm}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Server
          </Button>
        )}
      />

      {showForm && (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Add external server</h2>
          </div>
          <form onSubmit={handleSubmit} className="p-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs text-muted-foreground">Hostname / IP *</label>
                  <Input placeholder="192.168.1.100" {...form.register("hostname")} />
                  {form.formState.errors.hostname && (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.hostname.message}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">SSH Port *</label>
                  <Input type="number" {...form.register("ssh_port", { valueAsNumber: true })} />
                  {form.formState.errors.ssh_port && (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.ssh_port.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">SSH Username *</label>
                <Input placeholder="root" {...form.register("ssh_username")} />
                {form.formState.errors.ssh_username && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.ssh_username.message}</p>
                )}
              </div>

              <div className="col-span-2 space-y-3">
                <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-1">
                  {(["password", "key"] as const).map((mode) => (
                    <button key={mode} type="button"
                      onClick={() => setAuthMode(mode)}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                        authMode === mode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {mode === "password" ? "Password auth" : "Private key auth"}
                    </button>
                  ))}
                </div>

                {authMode === "password" ? (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">SSH Password</label>
                    <Input type="password" placeholder="leave blank for default key auth"
                      {...form.register("ssh_password")} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Private Key (PEM content)</label>
                    <textarea rows={6} className="input resize-none font-mono text-xs w-full"
                      placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                      value={sshPrivateKey}
                      onChange={(e) => setSshPrivateKey(e.target.value)} />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">GPU Model (optional)</label>
                <Input placeholder="RTX 4090" {...form.register("gpu_model")} />
              </div>
            </div>

            {formError && (
              <div className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formError}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" loading={form.formState.isSubmitting || createServer.isPending}>Add &amp; Provision</Button>
              <Button type="button" variant="ghost" onClick={() => { setShowForm(false); form.reset(); setSshPrivateKey(""); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error.message} />}
      {!isLoading && !error && servers.length === 0 && (
        <EmptyState
          title="No servers registered yet."
          action={<Button variant="outline" size="sm" onClick={openForm}>Register your first server</Button>}
        />
      )}

      <div className="space-y-2">
        {servers.map((s) => (
          <div key={s.id} className="overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-muted-foreground/30">
            <div className="group flex items-center gap-4 px-5 py-4">
              <div className="shrink-0">
                <StatusBadge status={s.status} />
              </div>

              <Link href={`/servers/${s.id}`} className="flex flex-1 items-center gap-4 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.hostname}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {s.ssh_username}@{s.hostname}:{s.ssh_port}
                    {s.has_ssh_key ? " · key" : s.has_ssh_password ? " · password" : ""}
                  </p>
                </div>
                <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                  <p>{s.gpu_model ?? "GPU unknown"}</p>
                  <p>{s.vram_gb != null ? `${s.vram_gb} GB VRAM` : ""}{s.cuda_version ? ` · CUDA ${s.cuda_version}` : ""}</p>
                </div>
              </Link>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 transition-opacity sm:flex-nowrap">
                <Button
                  variant="outline"
                  size="sm"
                  loading={testingId === s.id}
                  disabled={s.status === "TERMINATED"}
                  onClick={() => handleTestSSH(s.id)}
                >
                  {s.status === "PROVISIONING" ? "Re-check SSH" : "Test SSH"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={startingSSH === s.id}
                  disabled={s.status === "TERMINATED"}
                  onClick={() => handleStartSSH(s.id, s.hostname)}
                >
                  Open Terminal
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  loading={deletingId === s.id}
                  onClick={() => handleDelete(s)}
                >
                  Delete
                </Button>
              </div>
            </div>

            {/* Inline SSH test log */}
            {expandedTestId === s.id && sshTestResults[s.id] && (
              <div className="border-t border-border bg-muted/10 px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    SSH Connectivity
                  </span>
                  <button
                    onClick={() => setExpandedTestId(null)}
                    className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Close SSH connectivity details"
                  >
                    ×
                  </button>
                </div>
                <div className="space-y-1.5">
                  {sshTestResults[s.id].steps.map((step, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 font-mono text-xs ${
                        step.success ? "text-dark-green" : "text-destructive"
                      }`}
                    >
                      <span className="shrink-0 w-3">{step.success ? "✓" : "✗"}</span>
                      <span className="shrink-0 text-muted-foreground w-20">{step.step}</span>
                      <span className="flex-1 truncate">{step.message}</span>
                      {step.elapsed_ms > 0 && (
                        <span className="shrink-0 text-muted-foreground/60">{step.elapsed_ms}ms</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Terminal dialog — no logs, plain SSH terminal */}
      <Dialog
        open={!!terminalSession}
        onOpenChange={(open) => {
          if (!open && terminalSession) {
            api.sessions.terminate(terminalSession.id).catch(() => {});
            setTerminalSession(null);
          }
        }}
      >
        <DialogContent size="xl" closeOnInteractionOutside className="p-0">
          <DialogHeader className="px-4 py-3">
            <DialogTitle className="text-sm font-medium">
              Terminal — {terminalSession?.serverName}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {terminalSession && (
              <PtyTerminal
                key={terminalSession.id}
                sessionId={terminalSession.id}
                onDisconnect={() => setTerminalSession(null)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {unregisteredRentals.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">Active Clore Rentals (not registered)</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These rentals exist on Clore.ai but aren&apos;t in your servers list. Register them to start SSH sessions.
            </p>
          </div>
          {unregisteredRentals.map((r) => (
            <Card key={r.id} className="overflow-hidden border-dashed">
              <div className="flex items-center gap-4 px-5 py-4">
                <StatusBadge status={r.status.toUpperCase()} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{r.gpu_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.hostname}:{r.ssh_port} · {r.ssh_username}
                    {r.vram_gb > 0 ? ` · ${r.vram_gb} GB VRAM` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRegisteringId(registeringId === r.id ? null : r.id)}
                >
                  {registeringId === r.id ? "Cancel" : "Register"}
                </Button>
              </div>
              {registeringId === r.id && (
                <RegisterRentalInline
                  rental={r}
                  onSuccess={() => setRegisteringId(null)}
                  onCancel={() => setRegisteringId(null)}
                />
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Delete server ${deleteTarget.hostname}?` : "Delete server?"}
        description="This removes the server record from the platform. This action cannot be undone."
        confirmLabel="Delete Server"
        onConfirm={confirmDeleteServer}
      />
    </div>
  );
}

function RegisterRentalInline({
  rental, onSuccess, onCancel,
}: {
  rental: CloreRental;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const createServer = useCreateServer();
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (authMode === "password" && !password) { setError("Password required"); return; }
    if (authMode === "key" && !privateKey.trim()) { setError("Private key required"); return; }
    setError(null);
    createServer.mutate(
      {
        external_server_id: rental.id,
        hostname: rental.hostname,
        ssh_port: rental.ssh_port,
        ssh_username: rental.ssh_username,
        gpu_model: rental.gpu_name || undefined,
        vram_gb: rental.vram_gb || undefined,
        ...(authMode === "password" ? { ssh_password: password } : { ssh_private_key: privateKey.trim() }),
      },
      { onSuccess, onError: (err) => setError(err.message) }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-muted/10 px-5 py-4 space-y-3">
      <p className="text-xs text-muted-foreground">Provide the SSH credentials used when renting this server on Clore.ai.</p>
      <div className="flex gap-1 rounded border border-border bg-muted/20 p-0.5 w-fit">
        {(["password", "key"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setAuthMode(m)}
            className={`rounded px-3 py-1 text-xs transition-colors ${
              authMode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {m === "password" ? "Password" : "Private Key"}
          </button>
        ))}
      </div>
      {authMode === "password" ? (
        <Input type="password" placeholder="SSH password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      ) : (
        <textarea className="input w-full text-sm font-mono resize-none" rows={4}
          placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
          value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={createServer.isPending}>Register Server</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
