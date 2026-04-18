"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { CloreRental, Server, ServerCreate } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

const EMPTY_FORM: ServerCreate = {
  external_server_id: "",
  hostname: "",
  ssh_port: 22,
  ssh_username: "root",
  ssh_password: "",
  ssh_private_key: "",
};

export default function ServersPage() {
  const router = useRouter();
  const [servers, setServers] = useState<Server[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rentals, setRentals] = useState<CloreRental[]>([]);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [startingSSH, setStartingSSH] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [form, setForm] = useState<ServerCreate>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Rentals that don't have a matching Server record (not rented via this platform)
  const unregisteredRentals = useMemo(() => {
    const extIds = new Set(servers.map((s) => s.external_server_id));
    return rentals.filter((r) => !extIds.has(r.id));
  }, [rentals, servers]);

  function load() {
    api.servers
      .list()
      .then((res) => { setServers(res.items); setTotal(res.total); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    // Fetch rentals silently — no Clore key = empty list
    api.clore.rentals().then((r) => setRentals(r.rentals)).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function handleStartSSH(serverId: string) {
    setStartingSSH(serverId);
    try {
      const session = await api.sessions.create({ server_id: serverId });
      sessionStorage.setItem("lab_session_id", session.id);
      router.push("/lab");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to start SSH session");
      setStartingSSH(null);
    }
  }

  function openForm() {
    setForm({ ...EMPTY_FORM, external_server_id: `manual-${Date.now()}` });
    setFormError(null);
    setAuthMode("password");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: ServerCreate = {
        ...form,
        ssh_password: authMode === "password" && form.ssh_password ? form.ssh_password : undefined,
        ssh_private_key: authMode === "key" && form.ssh_private_key ? form.ssh_private_key : undefined,
        gpu_model: form.gpu_model || undefined,
        os_image: form.os_image || undefined,
      };
      await api.servers.create(payload);
      setShowForm(false);
      setLoading(true);
      load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(server: Server) {
    if (!confirm(`Delete server ${server.hostname}? This cannot be undone.`)) return;
    setDeletingId(server.id);
    try {
      await api.servers.delete(server.id);
      load();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Servers</h1>
          {!loading && (
            <p className="mt-0.5 text-sm text-zinc-500">{total} registered</p>
          )}
        </div>
        <button onClick={openForm} className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Server
        </button>
      </div>

      {/* Registration form */}
      {showForm && (
        <div className="card overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-3">
            <h2 className="text-sm font-semibold text-zinc-200">Add external server</h2>
          </div>
          <form onSubmit={handleSubmit} className="p-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs text-zinc-500">Hostname / IP *</label>
                  <input required className="input" placeholder="192.168.1.100" value={form.hostname}
                    onChange={(e) => setForm({ ...form, hostname: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">SSH Port *</label>
                  <input required type="number" className="input" value={form.ssh_port}
                    onChange={(e) => setForm({ ...form, ssh_port: Number(e.target.value) })} />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-500">SSH Username *</label>
                <input required className="input" placeholder="root" value={form.ssh_username}
                  onChange={(e) => setForm({ ...form, ssh_username: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Server ID *</label>
                <input required className="input" placeholder="unique-id" value={form.external_server_id}
                  onChange={(e) => setForm({ ...form, external_server_id: e.target.value })} />
              </div>

              {/* Auth mode toggle */}
              <div className="col-span-2 space-y-3">
                <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
                  {(["password", "key"] as const).map((mode) => (
                    <button key={mode} type="button"
                      onClick={() => setAuthMode(mode)}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                        authMode === mode
                          ? "bg-zinc-700 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {mode === "password" ? "Password auth" : "Private key auth"}
                    </button>
                  ))}
                </div>

                {authMode === "password" ? (
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">SSH Password</label>
                    <input type="password" className="input" placeholder="leave blank for default key auth"
                      value={form.ssh_password ?? ""}
                      onChange={(e) => setForm({ ...form, ssh_password: e.target.value })} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">Private Key (PEM content)</label>
                    <textarea rows={6} className="input resize-none font-mono text-xs"
                      placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                      value={form.ssh_private_key ?? ""}
                      onChange={(e) => setForm({ ...form, ssh_private_key: e.target.value })} />
                    <p className="text-[10px] text-zinc-600">
                      Paste the full PEM block. RSA, Ed25519, ECDSA, and DSS keys are supported.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-500">GPU Model (optional)</label>
                <input className="input" placeholder="RTX 4090" value={form.gpu_model ?? ""}
                  onChange={(e) => setForm({ ...form, gpu_model: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">OS / Image (optional)</label>
                <input className="input" placeholder="ubuntu:22.04" value={form.os_image ?? ""}
                  onChange={(e) => setForm({ ...form, os_image: e.target.value })} />
              </div>
            </div>

            {formError && (
              <p className="mt-3 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-400">
                {formError}
              </p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? "Adding…" : "Add & Provision"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}
      {error && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}
      {!loading && !error && servers.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500">No servers registered yet.</p>
          <button onClick={openForm} className="btn-secondary text-xs">Register your first server</button>
        </div>
      )}

      {/* Server list */}
      <div className="space-y-2">
        {servers.map((s) => (
          <div key={s.id} className="card group flex items-center gap-4 px-5 py-4 transition-all hover:border-zinc-700">
            {/* Status dot */}
            <div className="shrink-0">
              <StatusBadge status={s.status} />
            </div>

            {/* Info — clickable area */}
            <Link href={`/servers/${s.id}`} className="flex flex-1 items-center gap-4 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-100">{s.hostname}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {s.ssh_username}@{s.hostname}:{s.ssh_port}
                  {s.has_ssh_key ? " · key" : s.has_ssh_password ? " · password" : ""}
                </p>
              </div>
              <div className="hidden shrink-0 text-right text-xs text-zinc-500 sm:block">
                <p>{s.gpu_model ?? "GPU unknown"}</p>
                <p>{s.vram_gb != null ? `${s.vram_gb} GB VRAM` : ""}{s.cuda_version ? ` · CUDA ${s.cuda_version}` : ""}</p>
              </div>
            </Link>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => handleStartSSH(s.id)}
                disabled={startingSSH === s.id || s.status === "TERMINATED"}
                className="btn-secondary text-xs opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                {startingSSH === s.id ? "Starting…" : "SSH"}
              </button>
              <Link href={`/servers/${s.id}`} className="btn-ghost text-xs opacity-0 group-hover:opacity-100">
                Open →
              </Link>
              <button
                onClick={() => handleDelete(s)}
                disabled={deletingId === s.id}
                className="btn-ghost text-xs text-rose-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                {deletingId === s.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Unregistered Clore rentals */}
      {unregisteredRentals.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-300">Active Clore Rentals (not registered)</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              These rentals exist on Clore.ai but aren&apos;t in your servers list. Register them to start SSH sessions.
            </p>
          </div>
          {unregisteredRentals.map((r) => (
            <div key={r.id} className="card overflow-hidden border-dashed border-zinc-700">
              <div className="flex items-center gap-4 px-5 py-4">
                <StatusBadge status={r.status.toUpperCase()} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-300">{r.gpu_name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {r.hostname}:{r.ssh_port} · {r.ssh_username}
                    {r.vram_gb > 0 ? ` · ${r.vram_gb} GB VRAM` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setRegisteringId(registeringId === r.id ? null : r.id)}
                  className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                >
                  {registeringId === r.id ? "Cancel" : "Register"}
                </button>
              </div>
              {registeringId === r.id && (
                <RegisterRentalInline
                  rental={r}
                  onSuccess={() => { setRegisteringId(null); load(); }}
                  onCancel={() => setRegisteringId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
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
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (authMode === "password" && !password) { setError("Password required"); return; }
    if (authMode === "key" && !privateKey.trim()) { setError("Private key required"); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.servers.create({
        external_server_id: rental.id,
        hostname: rental.hostname,
        ssh_port: rental.ssh_port,
        ssh_username: rental.ssh_username,
        gpu_model: rental.gpu_name || undefined,
        vram_gb: rental.vram_gb || undefined,
        ...(authMode === "password"
          ? { ssh_password: password }
          : { ssh_private_key: privateKey.trim() }),
      });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-zinc-800 bg-zinc-900/30 px-5 py-4 space-y-3">
      <p className="text-xs text-zinc-500">
        Provide the SSH credentials used when renting this server on Clore.ai.
      </p>
      <div className="flex gap-1 rounded border border-zinc-800 bg-zinc-900 p-0.5 w-fit">
        {(["password", "key"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setAuthMode(m)}
            className={`rounded px-3 py-1 text-xs transition-colors ${
              authMode === m ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {m === "password" ? "Password" : "Private Key"}
          </button>
        ))}
      </div>
      {authMode === "password" ? (
        <input type="password" className="input w-full text-sm" placeholder="SSH password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      ) : (
        <textarea className="input w-full text-sm font-mono resize-none" rows={4}
          placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
          value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className="btn-primary text-xs">
          {submitting ? "Registering…" : "Register Server"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
      </div>
    </form>
  );
}
