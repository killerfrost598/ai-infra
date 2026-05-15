"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, ArrowRight, KeyRound, Plus, Server as ServerIcon, Terminal, Trash2, Wifi } from "lucide-react";
import { api } from "@/lib/api";
import {
  keys,
  useServers,
  useRentals,
  useCloreBalance,
  useCreateServer,
  useDeleteServer,
  useCreateSession,
  useEndCloreRental,
  useInferenceMetrics,
} from "@/lib/queries";
import type { CloreRental, InferenceProxyMetricResponse, Server, ServerCreate, SSHTestResult } from "@/lib/types";
import { cloreBillingLabels } from "@/lib/clore-billing";
import { serverSchema, type ServerFormValues } from "@/lib/schemas";
import { CloreAccountSummary } from "@/components/clore/CloreAccountSummary";
import { TerminalModal } from "@/components/terminal/TerminalModal";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layouts/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/layouts/page-states";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

export default function ServersPage() {
  const { data: serversData, isLoading, error } = useServers();
  const { data: rentalsData } = useRentals();
  const { data: balanceData } = useCloreBalance();
  const { data: proxyMetrics } = useInferenceMetrics();
  const servers: Server[] = useMemo(() => serversData?.items ?? [], [serversData?.items]);
  const total = serversData?.total ?? 0;
  const rentals: CloreRental[] = useMemo(() => rentalsData?.rentals ?? [], [rentalsData?.rentals]);

  const createServer = useCreateServer();
  const deleteServer = useDeleteServer();
  const endCloreRental = useEndCloreRental();
  const createSession = useCreateSession();

  const qc = useQueryClient();

  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [startingSSH, setStartingSSH] = useState<string | null>(null);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [terminalServer, setTerminalServer] = useState<Server | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [sshTestResults, setSshTestResults] = useState<Record<string, SSHTestResult>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const [endingRentalId, setEndingRentalId] = useState<string | null>(null);
  const [endRentalTarget, setEndRentalTarget] = useState<CloreRental | null>(null);
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

  const rentalByExternalId = useMemo(
    () => new Map(rentals.map((r) => [r.id, r])),
    [rentals],
  );

  const registeredRentalCount = useMemo(
    () => servers.filter((s) => rentalByExternalId.has(s.external_server_id)).length,
    [servers, rentalByExternalId],
  );

  const readyCount = servers.filter((s) => s.status === "READY").length;
  const provisioningCount = servers.filter((s) => s.status === "PROVISIONING").length;
  const manualCount = servers.filter((s) => s.external_server_id?.startsWith("manual-")).length;

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

  async function handleStartSSH(serverId: string) {
    setStartingSSH(serverId);
    try {
      const session = await createSession.mutateAsync({ server_id: serverId });
      const server = servers.find((s) => s.id === serverId) ?? null;
      setTerminalSessionId(session.id);
      setTerminalServer(server);
      setTerminalOpen(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to start SSH session");
    } finally {
      setStartingSSH(null);
    }
  }

  async function handleDisconnectTerminal() {
    const sessionId = terminalSessionId;
    setTerminalOpen(false);
    setTerminalSessionId(null);
    setTerminalServer(null);
    if (sessionId) {
      try {
        await api.sessions.terminate(sessionId);
      } catch {
        // Closing the modal should not be blocked by a stale session.
      }
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

  function handleEndRental(rental: CloreRental) {
    setEndRentalTarget(rental);
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

  function confirmEndRental() {
    if (!endRentalTarget) return;
    setEndingRentalId(endRentalTarget.id);
    endCloreRental.mutate(endRentalTarget.id, {
      onSettled: () => {
        setEndingRentalId(null);
        setEndRentalTarget(null);
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Servers"
        description="Manage registered hosts, Clore rentals, SSH readiness, and rental spend."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/clore?tab=marketplace">
                Rent GPU
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
            <Button variant="outline" onClick={openForm}>
              <Plus className="size-3.5" />
              Add External
            </Button>
          </div>
        )}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <CloreAccountSummary
          balance={balanceData}
          rentals={rentals}
          registeredCount={registeredRentalCount}
        />
        <Card className="grid grid-cols-2 overflow-hidden">
          <ServerMetric label="Registered" value={String(total)} />
          <ServerMetric label="Ready" value={String(readyCount)} tone="green" />
          <ServerMetric label="Provisioning" value={String(provisioningCount)} tone="amber" />
          <ServerMetric label="External" value={String(manualCount)} />
        </Card>
        <ProxyUtilizationPanel metrics={proxyMetrics} />
      </div>

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
          description="Rent a GPU from Clore or register an external SSH host to start running workloads."
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild size="sm">
                <Link href="/clore?tab=marketplace">Rent GPU</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={openForm}>Add External</Button>
            </div>
          )}
        />
      )}

      {servers.length > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Registered Servers</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Open terminals, verify SSH, and track Clore billing on rented machines.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{total} total</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {servers.map((s) => {
          const rental = rentalByExternalId.get(s.external_server_id);
          const billing = rental ? cloreBillingLabels(rental) : null;
          return (
          <Card key={s.id} className="overflow-hidden transition-colors hover:border-muted-foreground/30">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ServerIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/servers/${s.id}`} className="truncate font-medium hover:underline">
                      {s.hostname}
                    </Link>
                    <StatusBadge status={s.status} />
                    {rental && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Clore rental
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{s.ssh_username}@{s.hostname}:{s.ssh_port}</span>
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="size-3" />
                      {s.has_ssh_key ? "key" : s.has_ssh_password ? "password" : "no auth"}
                    </span>
                    <span>{s.gpu_model ?? "GPU unknown"}</span>
                    {s.vram_gb != null && <span>{s.vram_gb} GB VRAM</span>}
                    {s.cuda_version && <span>CUDA {s.cuda_version}</span>}
                  </div>
                  {billing && (billing.rate || billing.cost || billing.creationFee) && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      {[billing.rate, billing.cost, billing.creationFee ? `fee ${billing.creationFee}` : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={testingId === s.id}
                  disabled={s.status === "TERMINATED"}
                  onClick={() => handleTestSSH(s.id)}
                >
                  <Wifi className="size-3.5" />
                  {s.status === "PROVISIONING" ? "Re-check SSH" : "Test SSH"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={startingSSH === s.id}
                  disabled={s.status === "TERMINATED"}
                  onClick={() => handleStartSSH(s.id)}
                >
                  <Terminal className="size-3.5" />
                  Open Terminal
                </Button>
                {rental && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:text-destructive"
                    loading={endingRentalId === rental.id}
                    onClick={() => handleEndRental(rental)}
                  >
                    End Rental
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive"
                  loading={deletingId === s.id}
                  onClick={() => handleDelete(s)}
                >
                  <Trash2 className="size-3.5" />
                  Remove
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
          </Card>
          );
        })}
      </div>

      {unregisteredRentals.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">Active Clore Rentals (not registered)</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These rentals exist on Clore.ai but aren&apos;t in your servers list. Register them to start SSH sessions.
            </p>
          </div>
          {unregisteredRentals.map((r) => {
            const billing = cloreBillingLabels(r);
            return (
            <Card key={r.id} className="overflow-hidden border-dashed">
              <div className="flex items-center gap-4 px-5 py-4">
                <StatusBadge status={r.status.toUpperCase()} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{r.gpu_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.hostname}:{r.ssh_port} · {r.ssh_username}
                    {r.vram_gb > 0 ? ` · ${r.vram_gb} GB VRAM` : ""}
                    {billing.rate ? ` · ${billing.rate}` : ""}
                  </p>
                  {billing.cost && (
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{billing.cost}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:text-destructive"
                  loading={endingRentalId === r.id}
                  onClick={() => handleEndRental(r)}
                >
                  End Rental
                </Button>
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
            );
          })}
        </div>
      )}

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget ? `Remove server ${deleteTarget.hostname}?` : "Remove server?"}
        description="This removes only the local server record from this platform. It does not stop a Clore.ai rental."
        confirmLabel="Remove Server"
        onConfirm={confirmDeleteServer}
      />
      <ConfirmActionDialog
        open={!!endRentalTarget}
        onOpenChange={(open) => {
          if (!open) setEndRentalTarget(null);
        }}
        title={endRentalTarget ? `End Clore rental on ${endRentalTarget.gpu_name}?` : "End Clore rental?"}
        description="This stops the Clore.ai rental and billing for this machine. Any registered server record will be marked inactive after sync."
        confirmLabel="End Rental"
        onConfirm={confirmEndRental}
      />
      <TerminalModal
        open={terminalOpen}
        onOpenChange={(open) => {
          if (!open) setTerminalOpen(false);
          else setTerminalOpen(true);
        }}
        sessionId={terminalSessionId}
        serverMeta={{
          gpu_model: terminalServer?.gpu_model,
          vram_gb: terminalServer?.vram_gb,
          hostname: terminalServer?.hostname,
          status: terminalServer?.status,
        }}
        onDisconnect={handleDisconnectTerminal}
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

function ProxyUtilizationPanel({ metrics }: { metrics?: InferenceProxyMetricResponse }) {
  const summary = metrics?.summary;
  const cost = summary?.estimated_cost_usd_24h;
  const efficiency = summary?.effectiveness_score_24h;

  return (
    <Card className="px-5 py-4 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Proxy utilization</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Request volume, latency, token throughput, and spend efficiency over the last 24 hours.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-5">
          <CompactMetric label="Routes" value={String(metrics?.active_routes ?? 0)} />
          <CompactMetric label="Req/min" value={String(summary?.requests_last_minute ?? 0)} />
          <CompactMetric label="Tokens" value={String(summary?.total_tokens_24h ?? 0)} />
          <CompactMetric label="TPS" value={summary?.avg_tokens_per_second_24h?.toFixed(1) ?? "-"} />
          <CompactMetric
            label="Efficiency"
            value={efficiency == null ? (cost == null ? "-" : "0") : `${Math.round(efficiency)}/$`}
          />
        </div>
      </div>
    </Card>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ServerMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "amber";
}) {
  const color =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "";

  return (
    <div className="min-h-[86px] border-b border-r border-border p-4 odd:border-l-0 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
