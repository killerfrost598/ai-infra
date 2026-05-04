"use client";

import { useState } from "react";
import { usePlaybooks, useCreatePlaybook, useDeletePlaybook, useServers } from "@/lib/queries";
import type { Playbook, Server } from "@/lib/types";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function PlaybooksPage() {
  const { data, isLoading, error } = usePlaybooks();
  const playbooks: Playbook[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const createPlaybook = useCreatePlaybook();
  const deletePlaybook = useDeletePlaybook();
  const { data: serversData } = useServers();
  const readyServers: Server[] = (serversData?.items ?? []).filter(
    (s: Server) => s.status === "READY" || s.status === "PROVISIONING",
  );

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", git_repo: "", git_branch: "main", git_commit: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.git_repo.trim()) return;
    setCreateError(null);
    createPlaybook.mutate(
      {
        name: form.name.trim(),
        git_repo: form.git_repo.trim(),
        git_branch: form.git_branch.trim() || "main",
        git_commit: form.git_commit.trim() || undefined,
      },
      {
        onSuccess: () => {
          setForm({ name: "", git_repo: "", git_branch: "main", git_commit: "" });
          setShowForm(false);
        },
        onError: (err) => setCreateError(err.message),
      }
    );
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete playbook "${name}"?`)) return;
    deletePlaybook.mutate(id, {
      onError: (err) => alert(err.message),
    });
  }

  async function handleRun(playbook: Playbook) {
    if (readyServers.length === 0) {
      toast.error("No ready servers to run this playbook on.");
      return;
    }
    const server = readyServers[0];
    setRunningId(playbook.id);
    try {
      await api.playbooks.run(playbook.id, server.id);
      toast.success(`Playbook "${playbook.name}" queued on ${server.hostname}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Playbooks</h1>
          {!isLoading && <p className="mt-0.5 text-sm text-muted-foreground">{total} registered</p>}
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "Register playbook"}
        </Button>
      </div>

      {showForm && (
        <Card className="px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold">Register Ansible playbook</h2>
          {createError && <p className="text-xs text-destructive">{createError}</p>}

          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input
                  placeholder="vllm-deploy"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Branch</label>
                <Input
                  value={form.git_branch}
                  onChange={(e) => setField("git_branch", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Git repository URL</label>
                <Input
                  className="font-mono"
                  placeholder="https://github.com/org/playbooks.git"
                  value={form.git_repo}
                  onChange={(e) => setField("git_repo", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Pin commit <span className="text-muted-foreground/50">(optional)</span>
                </label>
                <Input
                  className="font-mono"
                  placeholder="abc1234"
                  value={form.git_commit}
                  onChange={(e) => setField("git_commit", e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                loading={createPlaybook.isPending}
                disabled={!form.name.trim() || !form.git_repo.trim()}
              >
                Register
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-muted-foreground" />
          Loading…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}
      {!isLoading && !error && playbooks.length === 0 && !showForm && (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-muted-foreground">No playbooks registered yet.</p>
          <p className="text-xs text-muted-foreground/60">Playbooks are Ansible repositories used to automate model deployment.</p>
        </Card>
      )}

      <div className="space-y-2">
        {playbooks.map((p) => (
          <Card key={p.id} className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{p.git_repo}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                    {p.git_branch}
                  </span>
                  {p.git_commit && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {p.git_commit.slice(0, 7)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={runningId === p.id}
                  disabled={!!runningId || readyServers.length === 0}
                  onClick={() => handleRun(p)}
                  title={readyServers.length === 0 ? "No ready servers" : `Run on ${readyServers[0].hostname}`}
                >
                  Run
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  loading={deletePlaybook.isPending}
                  onClick={() => handleDelete(p.id, p.name)}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
