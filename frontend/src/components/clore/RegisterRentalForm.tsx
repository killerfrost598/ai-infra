"use client";

import { useState } from "react";
import { useCreateServer } from "@/lib/queries";
import type { CloreRental } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  rental: CloreRental;
  onSuccess: () => void;
  onCancel: () => void;
}

export function RegisterRentalForm({ rental, onSuccess, onCancel }: Props) {
  const createServer = useCreateServer();
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [generatingKey, setGeneratingKey] = useState(false);
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
        cuda_version: rental.cuda_version || undefined,
        ...(authMode === "password" ? { ssh_password: password } : { ssh_private_key: privateKey.trim() }),
      },
      { onSuccess, onError: (err) => setError(err.message) },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-muted/10 px-4 py-3 space-y-3">
      <p className="text-xs text-muted-foreground">Register this rental so you can start SSH sessions from this platform.</p>
      <div className="flex gap-1 rounded border border-border bg-muted/20 p-0.5 w-fit">
        {(["password", "key"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setAuthMode(m)}
            className={`rounded px-3 py-1 text-xs transition-colors ${authMode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {m === "password" ? "Password" : "Private Key"}
          </button>
        ))}
      </div>
      {authMode === "password" ? (
        <Input type="password" placeholder="SSH password" value={password} onChange={(e) => setPassword(e.target.value)} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">Private key (PEM) — stored securely in the platform</p>
            <Button type="button" variant="outline" size="sm" disabled={generatingKey}
              onClick={async () => {
                setGeneratingKey(true);
                try {
                  await import("@/lib/api").then(({ api }) => api.settings.generateKeypair());
                  setError("Key pair generated — private key saved to platform settings. Note: the public key was NOT sent to this existing rental.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Generation failed");
                } finally { setGeneratingKey(false); }
              }}>
              {generatingKey ? "Generating…" : "Generate"}
            </Button>
          </div>
          <textarea className="input w-full text-sm font-mono resize-none" rows={4}
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
            value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={createServer.isPending}>Register Server</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
