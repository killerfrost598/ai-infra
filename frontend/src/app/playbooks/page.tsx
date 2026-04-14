"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Playbook } from "@/lib/types";

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", git_repo: "", git_branch: "main", git_commit: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<string | null>(null);

  function load() {
    api.playbooks.list()
      .then((res) => { setPlaybooks(res.items); setTotal(res.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.git_repo.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.playbooks.create({
        name: form.name.trim(),
        git_repo: form.git_repo.trim(),
        git_branch: form.git_branch.trim() || "main",
        git_commit: form.git_commit.trim() || undefined,
      });
      setForm({ name: "", git_repo: "", git_branch: "main", git_commit: "" });
      setShowForm(false);
      load();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete playbook "${name}"?`)) return;
    setDeleting(id);
    try {
      await api.playbooks.delete(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Playbooks</h1>
          {!loading && <p className="mt-0.5 text-sm text-zinc-500">{total} registered</p>}
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary text-sm">
          {showForm ? "Cancel" : "Register playbook"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Register Ansible playbook</h2>
          {createError && <p className="text-xs text-rose-400">{createError}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Name</label>
              <input
                className="input w-full text-sm"
                placeholder="vllm-deploy"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Branch</label>
              <input
                className="input w-full text-sm"
                value={form.git_branch}
                onChange={(e) => setField("git_branch", e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">Git repository URL</label>
              <input
                className="input w-full text-sm font-mono"
                placeholder="https://github.com/org/playbooks.git"
                value={form.git_repo}
                onChange={(e) => setField("git_repo", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Pin commit <span className="text-zinc-600">(optional)</span></label>
              <input
                className="input w-full text-sm font-mono"
                placeholder="abc1234"
                value={form.git_commit}
                onChange={(e) => setField("git_commit", e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={creating || !form.name.trim() || !form.git_repo.trim()} className="btn-primary text-sm">
              {creating ? "Registering…" : "Register"}
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}
      {error && <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>}
      {!loading && !error && playbooks.length === 0 && !showForm && (
        <div className="card flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-zinc-500">No playbooks registered yet.</p>
          <p className="text-xs text-zinc-600">Playbooks are Ansible repositories used to automate model deployment.</p>
        </div>
      )}

      <div className="space-y-2">
        {playbooks.map((p) => (
          <div key={p.id} className="card px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-zinc-100">{p.name}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{p.git_repo}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-400">
                    {p.git_branch}
                  </span>
                  {p.git_commit && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-500">
                      {p.git_commit.slice(0, 7)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(p.id, p.name)}
                disabled={deleting === p.id}
                className="btn-danger text-xs py-1.5 px-3 shrink-0"
              >
                {deleting === p.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
