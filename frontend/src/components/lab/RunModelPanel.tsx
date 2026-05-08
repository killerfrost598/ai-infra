"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Copy, Terminal, X, Loader2, AlertTriangle, CheckCircle, ListChecks, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useCreateModelRun } from "@/lib/queries";
import { QuantChip } from "@/components/models/QuantChip";
import type {
  DeploymentPlanStep,
  FeasibilityCheckOut,
  LaunchRecommendation,
  ModelEntry,
  ModelQuant,
} from "@/lib/types";

type EngineOption = "VLLM";

interface RunModelPanelProps {
  open: boolean;
  onClose: () => void;
  serverId: string | null;
  sessionId: string | null;
  models: ModelEntry[];
  modelsLoading: boolean;
  pendingModelId?: string | null;
  pendingQuantId?: string | null;
  onPendingConsumed?: () => void;
  onCommandExecuted?: () => void;
  onShowTerminal?: () => void;
}

export function RunModelPanel({ open, onClose, serverId, sessionId, models, modelsLoading, pendingModelId, pendingQuantId, onPendingConsumed, onCommandExecuted, onShowTerminal }: RunModelPanelProps) {
  const [search, setSearch] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [selectedQuant, setSelectedQuant] = useState<ModelQuant | null>(null);
  const [engine, setEngine] = useState<EngineOption>("VLLM");
  const [recommendation, setRecommendation] = useState<LaunchRecommendation | null>(null);
  const [copied, setCopied] = useState(false);
  const [injectedRunId, setInjectedRunId] = useState<string | null>(null);
  const [executedRunStatus, setExecutedRunStatus] = useState<"SUCCESS" | "FAILED" | null>(null);
  const [outcomeNote, setOutcomeNote] = useState("");
  const [aiGuidance, setAiGuidance] = useState("");
  const [deploymentPlanOpen, setDeploymentPlanOpen] = useState(false);
  const [runningCommandKey, setRunningCommandKey] = useState<string | null>(null);
  const [terminalInjected, setTerminalInjected] = useState<Record<string, boolean>>({});

  const queryClient = useQueryClient();
  const createRun = useCreateModelRun();

  // Auto-select model/quant when navigated from Models page
  useEffect(() => {
    if (!pendingModelId || models.length === 0) return;
    const model = models.find((m) => m.id === pendingModelId);
    if (!model) return;
    setSelectedModel(model);
    setSearch(model.name);
    if (pendingQuantId) {
      const quant = model.quants.find((q) => q.id === pendingQuantId);
      if (quant) setSelectedQuant(quant);
    }
    onPendingConsumed?.();
  }, [pendingModelId, pendingQuantId, models, onPendingConsumed]);

  const recommendMutation = useMutation({
    mutationFn: () => {
      if (!serverId || !selectedModel || !selectedQuant) throw new Error("Missing selection");
      return api.lab.recommend({
        server_id: serverId,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
        engine,
        session_id: sessionId ?? undefined,
      });
    },
    onSuccess: (data) => setRecommendation(data),
    onError: (e: Error) => toast.error(e.message),
  });

  const injectMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId || !recommendation?.injectable_command) throw new Error("No command to inject");
      let runId = injectedRunId;
      if (!runId && serverId && selectedModel && selectedQuant) {
        const run = await createRun.mutateAsync({
          server_id: serverId,
          session_id: sessionId,
          model_id: selectedModel.id,
          quant_id: selectedQuant.id,
          engine: engine as "VLLM" | "SGLANG" | "OLLAMA",
          mode: recommendation.install_plan?.mode ?? "container",
          container_image: recommendation.install_plan?.container_image ?? undefined,
          launch_command: recommendation.injectable_command,
          feasibility_verdict: recommendation.feasibility?.verdict ?? "UNKNOWN",
          forced: recommendation.force_required,
        });
        runId = run.id;
        setInjectedRunId(runId);
      }
      return api.lab.inject(sessionId, {
        command: recommendation.injectable_command,
        dry_run: false,
        model_run_id: runId ?? undefined,
      });
    },
    onSuccess: () => toast.success("Command injected into terminal"),
    onError: (e: Error) => toast.error(e.message),
  });

  const executeMutation = useMutation({
    mutationFn: () => {
      if (!sessionId || !serverId || !selectedModel || !selectedQuant) {
        throw new Error("Missing session, server, model, or quant");
      }
      return api.lab.executeRecommendation(sessionId, {
        server_id: serverId,
        session_id: sessionId,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
        engine,
        force: recommendation?.force_required ?? false,
      });
    },
    onSuccess: (data) => {
      setExecutedRunStatus(data.run.status === "SUCCESS" ? "SUCCESS" : "FAILED");
      queryClient.invalidateQueries({ queryKey: ["model-runs"] });
      if (data.run.status === "SUCCESS") {
        toast.success("Model is healthy");
      } else {
        toast.error(data.run.failure_message ?? "Launch failed");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assistMutation = useMutation({
    mutationFn: () => {
      if (!serverId || !selectedModel || !selectedQuant) throw new Error("Missing selection");
      return api.lab.assist({
        server_id: serverId,
        session_id: sessionId ?? undefined,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
        engine,
        provider: "auto",
      });
    },
    onSuccess: (data) => {
      setAiGuidance(data.guidance);
      toast.success(`AI guidance from ${data.provider}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const planMutation = useMutation({
    mutationFn: () => {
      if (!serverId || !selectedModel || !selectedQuant) throw new Error("Missing selection");
      return api.lab.planDeployment({
        server_id: serverId,
        session_id: sessionId ?? undefined,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
        engine,
        runtime_mode: "auto",
      });
    },
    onSuccess: () => setDeploymentPlanOpen(true),
    onError: (e: Error) => toast.error(e.message),
  });

  const runCommandMutation = useMutation({
    mutationFn: async ({ key, command }: { key: string; command: string }) => {
      if (!sessionId) throw new Error("No active session");
      setRunningCommandKey(key);
      onShowTerminal?.();
      return api.lab.inject(sessionId, {
        command,
        dry_run: false,
      });
    },
    onSuccess: (_result, vars) => {
      setTerminalInjected((prev) => ({ ...prev, [vars.key]: true }));
      onCommandExecuted?.();
      toast.success("Command sent to terminal");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setRunningCommandKey(null),
  });

  const updateRunMutation = useMutation({
    mutationFn: ({ succeeded, notes }: { succeeded: boolean; notes?: string }) => {
      if (!injectedRunId) throw new Error("No run to update");
      return api.modelRuns.update(injectedRunId, {
        status: succeeded ? "SUCCESS" : "FAILED",
        succeeded,
        operator_notes: notes,
      });
    },
    onSuccess: () => {
      toast.success("Run outcome saved");
      setInjectedRunId(null);
      setOutcomeNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCopy() {
    if (!recommendation?.injectable_command) return;
    navigator.clipboard.writeText(recommendation.injectable_command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const filteredModels = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.model_key.toLowerCase().includes(search.toLowerCase()),
  );

  const aiCommands = extractExecutableBlocks(aiGuidance);

  if (!open) return null;

  return (
    <div className="absolute bottom-0 right-0 top-0 z-20 flex w-full max-w-xl flex-col border-l border-border/70 bg-gradient-to-b from-muted/50 via-muted/25 to-background/90 shadow-2xl">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/80">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-sm font-semibold">Run Model</h3>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading models...
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Model</label>
                <select
                  value={selectedModel?.id ?? ""}
                  onChange={(e) => {
                    const model = models.find((m) => m.id === e.target.value) ?? null;
                    setSelectedModel(model);
                    setSelectedQuant(null);
                    setRecommendation(null);
                    setSearch(model?.name ?? "");
                  }}
                  className="mb-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select from model knowledge base...</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.param_count_b}B{m.family ? `, ${m.family}` : ""})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Search models..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedModel(null);
                    setSelectedQuant(null);
                    setRecommendation(null);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {search && !selectedModel && (
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                    {filteredModels.slice(0, 20).map((m) => (
                      <button
                        key={m.id}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted/40"
                        onClick={() => {
                          setSelectedModel(m);
                          setSelectedQuant(null);
                          setRecommendation(null);
                          setSearch(m.name);
                        }}
                      >
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{m.param_count_b}B</span>
                      </button>
                    ))}
                    {filteredModels.length === 0 && (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No models found</p>
                    )}
                  </div>
                )}
                {selectedModel && (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Selected: {selectedModel.name} - {selectedModel.param_count_b}B
                  </p>
                )}
              </div>

              {selectedModel && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Quantization</label>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedModel.quants.map((q) => (
                      <QuantChip
                        key={q.id}
                        quant={q}
                        selected={selectedQuant?.id === q.id}
                        onSelect={() => { setSelectedQuant(q); setRecommendation(null); }}
                        showActions={false}
                      />
                    ))}
                    {selectedModel.quants.length === 0 && (
                      <p className="text-xs text-muted-foreground">No quants available</p>
                    )}
                  </div>
                </div>
              )}

              {selectedQuant && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Engine</label>
                  <div className="flex gap-2">
                    {(["VLLM"] as EngineOption[]).map((e) => (
                      <button
                        key={e}
                        onClick={() => { setEngine(e); setRecommendation(null); }}
                        className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${engine === e ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 hover:bg-muted/60"}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    SGLang will appear here after its launcher is wired.
                  </p>
                </div>
              )}

              {selectedQuant && (
                <Button
                  size="sm"
                  onClick={() => recommendMutation.mutate()}
                  disabled={recommendMutation.isPending || !serverId}
                  className="h-8 text-xs"
                >
                  {recommendMutation.isPending ? (
                    <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Checking...</>
                  ) : "Get Recommendation"}
                </Button>
              )}

              {recommendation && (
                <div className="space-y-3">
                  {recommendation.requires_reprobe && (
                    <Card className="border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mr-1.5 inline h-4 w-4" />
                      No host snapshot. Switch to Machine Info tab and run a Reprobe first.
                    </Card>
                  )}

                  {recommendation.warnings.length > 0 && (
                    <div className="space-y-1">
                      {recommendation.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
                      ))}
                    </div>
                  )}

                  {recommendation.feasibility && (
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-xs font-medium">Feasibility</span>
                        <VerdictBadge verdict={recommendation.feasibility.verdict} />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recommendation.feasibility.checks.map((c) => (
                          <FeasibilityChip key={c.id} check={c} />
                        ))}
                      </div>
                    </div>
                  )}

                  {recommendation.injectable_command && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium">Launch Command</p>
                      <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">
                        {recommendation.injectable_command}
                      </pre>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => planMutation.mutate()}
                          disabled={planMutation.isPending || !sessionId}
                        >
                          {planMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListChecks className="h-3 w-3" />}
                          Plan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => assistMutation.mutate()}
                          disabled={assistMutation.isPending}
                        >
                          {assistMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                          AI help
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => injectMutation.mutate()}
                          disabled={injectMutation.isPending || executeMutation.isPending || !sessionId}
                        >
                          {injectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />}
                          Inject
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => executeMutation.mutate()}
                          disabled={executeMutation.isPending || injectMutation.isPending || !sessionId}
                        >
                          {executeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                          Run &amp; observe
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      {deploymentPlanOpen && planMutation.data && (
                        <Card className="mt-3 border-border bg-muted/20 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium">
                              Deployment plan: {planMutation.data.runtime_mode}
                            </p>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${planMutation.data.ready_to_run ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-amber-500/30 text-amber-600 dark:text-amber-400"}`}>
                              {planMutation.data.ready_to_run ? "READY" : "NEEDS REVIEW"}
                            </span>
                          </div>
                          {planMutation.data.blockers.length > 0 && (
                            <div className="mb-2 space-y-1">
                              {planMutation.data.blockers.map((b) => (
                                <p key={b} className="text-xs text-amber-600 dark:text-amber-400">{b}</p>
                              ))}
                            </div>
                          )}
                          <div className="space-y-2">
                          {planMutation.data.steps.map((step) => (
                              <ExecutableStep
                                key={step.id}
                                step={step}
                                injected={terminalInjected[`plan:${step.id}`]}
                                running={runningCommandKey === `plan:${step.id}`}
                                disabled={!sessionId || runCommandMutation.isPending}
                                onRun={(command) => runCommandMutation.mutate({ key: `plan:${step.id}`, command })}
                              />
                            ))}
                          </div>
                        </Card>
                      )}
                      {aiGuidance && (
                        <Card className="mt-3 border-blue-500/30 bg-blue-500/10 p-3">
                          <p className="mb-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">AI deployment help</p>
                          {aiCommands.length > 0 && (
                            <div className="mb-2 space-y-2">
                              {aiCommands.map((command, i) => (
                                <ExecutableCommand
                                  key={`${i}-${command.slice(0, 24)}`}
                                  command={command}
                                  label={`AI command ${i + 1}`}
                                  injected={terminalInjected[`ai:${i}`]}
                                  running={runningCommandKey === `ai:${i}`}
                                  disabled={!sessionId || runCommandMutation.isPending}
                                  onRun={() => runCommandMutation.mutate({ key: `ai:${i}`, command })}
                                />
                              ))}
                            </div>
                          )}
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">
                            {aiGuidance}
                          </pre>
                        </Card>
                      )}
                      {executedRunStatus && (
                        <p className={`mt-2 text-xs ${executedRunStatus === "SUCCESS" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {executedRunStatus === "SUCCESS"
                            ? "Run recorded as successful after health check."
                            : "Run recorded as failed. Open Test Runs for details."}
                        </p>
                      )}
                    </div>
                  )}

                  {injectedRunId && (
                    <Card className="border-blue-500/30 bg-blue-500/10 p-3">
                      <p className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-400">Did it work?</p>
                      <input
                        type="text"
                        placeholder="Optional notes..."
                        value={outcomeNote}
                        onChange={(e) => setOutcomeNote(e.target.value)}
                        className="mb-2 w-full rounded border border-input bg-background/50 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 gap-1 bg-emerald-600 text-xs hover:bg-emerald-700"
                          onClick={() => updateRunMutation.mutate({ succeeded: true, notes: outcomeNote || undefined })}
                          disabled={updateRunMutation.isPending}
                        >
                          <CheckCircle className="h-3 w-3" /> Success
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 gap-1 text-xs"
                          onClick={() => updateRunMutation.mutate({ succeeded: false, notes: outcomeNote || undefined })}
                          disabled={updateRunMutation.isPending}
                        >
                          <X className="h-3 w-3" /> Failed
                        </Button>
                      </div>
                    </Card>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExecutableStep({
  step,
  injected,
  running,
  disabled,
  onRun,
}: {
  step: DeploymentPlanStep;
  injected?: boolean;
  running: boolean;
  disabled: boolean;
  onRun: (command: string) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background/70 p-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{step.stage}</span>
        <p className="min-w-0 flex-1 text-xs font-medium">{step.title}</p>
        {step.command && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={disabled || running}
            onClick={() => onRun(step.command as string)}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run
          </Button>
        )}
      </div>
      {step.command && (
        <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-[10px] leading-relaxed">{step.command}</pre>
      )}
      {step.expected && <p className="mt-1 text-[11px] text-muted-foreground">{step.expected}</p>}
      {injected && <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">Sent to terminal. Watch the open session for live output and prompts.</p>}
    </div>
  );
}

function ExecutableCommand({
  command,
  label,
  injected,
  running,
  disabled,
  onRun,
}: {
  command: string;
  label: string;
  injected?: boolean;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <div className="rounded-md border border-blue-500/20 bg-background/70 p-2">
      <div className="mb-1 flex items-center gap-2">
        <p className="flex-1 text-xs font-medium">{label}</p>
        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" disabled={disabled || running} onClick={onRun}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run
        </Button>
      </div>
      <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[10px] leading-relaxed">{command}</pre>
      {injected && <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">Sent to terminal. Watch the open session for live output and prompts.</p>}
    </div>
  );
}

function extractExecutableBlocks(text: string): string[] {
  if (!text.trim()) return [];
  const blocks: string[] = [];
  const fence = /```(?:bash|sh|shell|console)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const command = cleanupCommandBlock(match[1]);
    if (command) blocks.push(command);
  }
  if (blocks.length > 0) return blocks.slice(0, 8);

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("$ "))
    .map((line) => cleanupCommandBlock(line.slice(2)))
    .filter((line): line is string => Boolean(line))
    .slice(0, 8);
}

function cleanupCommandBlock(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\$ /, "").trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
    });
  return lines.join("\n").trim();
}

function VerdictBadge({ verdict }: { verdict: "READY" | "BLOCKED" | "UNKNOWN" }) {
  const styles: Record<string, string> = {
    READY:   "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    BLOCKED: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    UNKNOWN: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles[verdict] ?? ""}`}>
      {verdict}
    </span>
  );
}

function FeasibilityChip({ check }: { check: FeasibilityCheckOut }) {
  const styles: Record<string, string> = {
    PASS:    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    FAIL:    "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    UNKNOWN: "bg-muted/50 text-muted-foreground border-border",
  };
  const icons: Record<string, string> = { PASS: "v", FAIL: "x", UNKNOWN: "?" };
  return (
    <span
      title={check.reason}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${styles[check.status] ?? ""}`}
    >
      {icons[check.status] ?? "?"} {check.id.replace(/_/g, " ")}
    </span>
  );
}
