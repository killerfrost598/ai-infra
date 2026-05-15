"use client";

import { useEffect, useState } from "react";
import { useCloreBalance, useRentClore } from "@/lib/queries";
import type { CloreOffer, RentRequest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PRESET_IMAGES = [
  { label: "Ubuntu Jupyter (Clore)", value: "cloreai/jupyter:ubuntu24.04-v2" },
  { label: "Custom…", value: "__custom__" },
];

const ALL_CURRENCIES = ["CLORE-Blockchain", "USD-Blockchain", "bitcoin"];

interface Props {
  offer: CloreOffer;
  onClose: () => void;
}

export function RentDialog({ offer, onClose }: Props) {
  const rentClore = useRentClore();
  const { data: balance } = useCloreBalance();
  const [imagePreset, setImagePreset] = useState("cloreai/jupyter:ubuntu24.04-v2");
  const [customImage, setCustomImage] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [orderType, setOrderType] = useState<"on-demand" | "spot">("on-demand");
  const availableCurrencies = offer.allowed_coins?.length
    ? ALL_CURRENCIES.filter((c) => offer.allowed_coins.includes(c))
    : ALL_CURRENCIES;
  const [currency, setCurrency] = useState(
    availableCurrencies.includes("CLORE-Blockchain") ? "CLORE-Blockchain" : availableCurrencies[0] ?? "CLORE-Blockchain",
  );
  const [spotPrice, setSpotPrice] = useState("");
  const [portsRaw, setPortsRaw] = useState('{"22": "tcp"}');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [envRaw, setEnvRaw] = useState("");
  const [command, setCommand] = useState("");
  const [jupyterToken, setJupyterToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [keyGenMsg, setKeyGenMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!balance?.balances?.length) return;
    const allowed = offer.allowed_coins?.length
      ? ALL_CURRENCIES.filter((c) => offer.allowed_coins.includes(c))
      : ALL_CURRENCIES;
    const nonZero = balance.balances.filter((w) => w.amount > 0 && allowed.includes(w.currency));
    if (!nonZero.length) return;
    const highest = nonZero.reduce((a, b) => (a.amount >= b.amount ? a : b));
    setCurrency(highest.currency);
  }, [balance, offer.allowed_coins]);

  const image = imagePreset === "__custom__" ? customImage.trim() : imagePreset;

  function validatePorts(): Record<string, string> | null {
    if (!portsRaw.trim()) return {};
    try {
      const parsed = JSON.parse(portsRaw);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, string>;
    } catch { return null; }
  }

  function validateEnv(): Record<string, string> | null {
    if (!envRaw.trim()) return {};
    try {
      const parsed = JSON.parse(envRaw);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, string>;
    } catch { return null; }
  }

  function handleSubmit() {
    setError(null);
    if (!image) { setError("Docker image is required."); return; }
    if (authMode === "password" && !sshPassword) { setError("SSH password is required."); return; }
    if (authMode === "key" && !sshKey.trim()) { setError("SSH public key is required."); return; }
    const ports = validatePorts();
    if (ports === null) { setError('Ports must be valid JSON, e.g. {"22": "tcp"}'); return; }
    const env = validateEnv();
    if (env === null) { setError('Env must be valid JSON, e.g. {"MY_VAR": "value"}'); return; }

    const req: RentRequest = {
      offer_id: offer.id, image, order_type: orderType, currency,
      ...(authMode === "password" ? { ssh_password: sshPassword } : { ssh_key: sshKey.trim() }),
      ...(Object.keys(ports).length ? { ports } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(command.trim() ? { command: command.trim() } : {}),
      ...(jupyterToken.trim() ? { jupyter_token: jupyterToken.trim() } : {}),
      ...(orderType === "spot" && spotPrice ? { spot_price: parseFloat(spotPrice) } : {}),
    };

    rentClore.mutate(req, { onSuccess: onClose, onError: (e) => setError(e.message) });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <Card className="w-full max-w-lg overflow-y-auto max-h-[90vh] px-6 py-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Rent {offer.gpu_name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ${offer.price_per_day.toFixed(2)}/day · {offer.vram_gb} GB VRAM
              {offer.gpu_count > 1 && ` · ${offer.gpu_count}× GPU`}
            </p>
          </div>
          <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Docker image</label>
          <select className="input w-full text-sm" value={imagePreset} onChange={(e) => setImagePreset(e.target.value)}>
            {PRESET_IMAGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {imagePreset === "__custom__" && (
            <Input className="mt-2 text-sm" placeholder="docker.io/user/image:tag"
              value={customImage} onChange={(e) => setCustomImage(e.target.value)} />
          )}
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">SSH authentication</label>
          <div className="flex gap-2 mb-2">
            {(["password", "key"] as const).map((m) => (
              <button key={m} onClick={() => setAuthMode(m)}
                className={`rounded px-3 py-1 text-xs transition-colors ${authMode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {m === "password" ? "Password" : "SSH Key Pair"}
              </button>
            ))}
          </div>
          {authMode === "password" ? (
            <Input type="password" placeholder="Alphanumeric, max 32 chars"
              maxLength={32} value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">Public key <span className="text-muted-foreground/60">(sent to Clore → injected into authorized_keys)</span></p>
                <Button type="button" variant="outline" size="sm" disabled={generatingKey}
                  onClick={async () => {
                    setGeneratingKey(true); setKeyGenMsg(null);
                    try {
                      const { api } = await import("@/lib/api");
                      const { public_key } = await api.settings.generateKeypair();
                      setSshKey(public_key);
                      setKeyGenMsg("Key pair generated; private key stored in platform settings.");
                    } catch (e) {
                      setKeyGenMsg(e instanceof Error ? e.message : "Generation failed");
                    } finally { setGeneratingKey(false); }
                  }}>
                  {generatingKey ? "Generating…" : "Generate"}
                </Button>
              </div>
              <textarea className="input w-full text-sm font-mono resize-none" rows={2}
                placeholder="ssh-ed25519 AAAA… or ssh-rsa AAAA… (or click Generate)"
                value={sshKey} onChange={(e) => setSshKey(e.target.value)} />
              {keyGenMsg && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{keyGenMsg}</p>
              )}
              <div className="rounded bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="text-foreground/70 font-medium">Private key:</span> the platform will use the SSH private key
                stored in <span className="text-indigo-400">Settings → SSH Key</span> to connect terminal sessions.
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Order type</label>
            <select className="input w-full text-sm" value={orderType} onChange={(e) => setOrderType(e.target.value as "on-demand" | "spot")}>
              <option value="on-demand">On-demand</option>
              <option value="spot">Spot</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Currency</label>
            <select className="input w-full text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {orderType === "spot" && (
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Max spot price ($/day)</label>
            <Input type="number" step="0.01" className="text-sm"
              placeholder={offer.price_per_day.toFixed(2)} value={spotPrice} onChange={(e) => setSpotPrice(e.target.value)} />
          </div>
        )}

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Port mappings (JSON)</label>
          <Input className="text-sm font-mono" value={portsRaw} onChange={(e) => setPortsRaw(e.target.value)}
            placeholder='{"22": "tcp", "8888": "http"}' />
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">Port 22/tcp is required for SSH access.</p>
        </div>

        <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
          {showAdvanced ? "▲ Hide advanced" : "▼ Advanced (env, command, Jupyter token)"}
        </button>
        {showAdvanced && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Environment variables (JSON)</label>
              <Input className="text-sm font-mono" value={envRaw} onChange={(e) => setEnvRaw(e.target.value)} placeholder='{"HF_TOKEN": "hf_..."}' />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Startup command</label>
              <Input className="text-sm" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="bash -c 'pip install vllm && ...'" />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 block">Jupyter token</label>
              <Input className="text-sm" value={jupyterToken} onChange={(e) => setJupyterToken(e.target.value)} placeholder="max 32 chars" maxLength={32} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={rentClore.isPending} onClick={handleSubmit}>Confirm rent</Button>
        </div>
      </Card>
    </div>
  );
}
