"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "input" | "seeding";
type SeedStatus = "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" | null;

function parseRepoId(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/huggingface\.co\/([^/?#]+\/[^/?#]+)/);
  return match ? match[1] : trimmed;
}

export function SeedModelDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("input");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<SeedStatus>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const sawRunningRef = useRef(false);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>  | null>(null);

  function stopPolling() {
    if (pollRef.current)    { clearInterval(pollRef.current);   pollRef.current    = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }

  useEffect(() => {
    if (!open) {
      stopPolling();
      setStep("input");
      setInput("");
      setStatus(null);
      setErrorMsg("");
      sawRunningRef.current = false;
    }
    return stopPolling;
  }, [open]);

  const seed = useMutation({
    mutationFn: (repoId: string) => api.models.seed(repoId),
    onSuccess: () => {
      sawRunningRef.current = false;
      setStep("seeding");
      setStatus("RUNNING");
      timeoutRef.current = setTimeout(() => startPolling(), 1500);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Seed failed");
    },
  });

  function startPolling() {
    let polls = 0;
    pollRef.current = setInterval(async () => {
      if (++polls > 90) {
        stopPolling();
        setStatus("FAILED");
        setErrorMsg("Timed out after 3 minutes. Check Celery worker logs.");
        return;
      }

      try {
        const result = await api.models.syncStatus();
        if (!result.status) return;

        const s = result.status as SeedStatus;

        if (s === "RUNNING") sawRunningRef.current = true;

        setStatus(s);

        if (sawRunningRef.current && (s === "SUCCESS" || s === "PARTIAL")) {
          stopPolling();
          qc.invalidateQueries({ queryKey: ["models"] });
          timeoutRef.current = setTimeout(() => onOpenChange(false), 1200);
        } else if (sawRunningRef.current && s === "FAILED") {
          stopPolling();
          setErrorMsg(result.error_summary ?? "Seeding failed");
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
  }

  function handleSubmit() {
    const repoId = parseRepoId(input);
    if (!repoId || !repoId.includes("/")) {
      toast.error("Enter a valid HuggingFace repo ID (e.g. Qwen/Qwen3-4B)");
      return;
    }
    seed.mutate(repoId);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Seed model from HuggingFace</DialogTitle>
          <DialogDescription>
            Enter a HuggingFace repo ID or URL. We&apos;ll fetch the base model and all
            community quants via Celery.
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <>
            <DialogBody>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Qwen/Qwen3-4B  or  https://huggingface.co/…"
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                autoFocus
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} loading={seed.isPending} disabled={!input.trim()}>
                Seed
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "seeding" && (
          <DialogBody>
            {(status === "RUNNING" || status === null) && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Spinner size="md" className="border-t-primary shrink-0" />
                Fetching metadata and community quants from HuggingFace…
              </div>
            )}
            {(status === "SUCCESS" || status === "PARTIAL") && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <span>✓</span>
                Seeded successfully — refreshing model list…
              </div>
            )}
            {status === "FAILED" && (
              <div className="space-y-3">
                <p className="text-sm text-destructive">Seeding failed.</p>
                {errorMsg && (
                  <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                    {errorMsg}
                  </p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}
