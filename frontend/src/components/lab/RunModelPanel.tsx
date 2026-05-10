"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronRight, Loader2, Play, Square, Cpu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { QuantChip } from "@/components/models/QuantChip";
import type { ModelEntry, ModelQuant, PipelineModelFlags, Session } from "@/lib/types";

interface PipelineStepperViewProps {
  session: Session | null;
  models: ModelEntry[];
  modelsLoading: boolean;
}

type StepStatus = "idle" | "running" | "success" | "failed";

interface StepState {
  status: StepStatus;
  taskRunId: string | null;
}

const DEFAULT_FLAGS: PipelineModelFlags = {
  enable_tools: false,
  tool_call_parser: null,
  enable_thinking: false,
  reasoning_parser: null,
  max_model_len: null,
  gpu_memory_utilization: 0.9,
  dtype: "auto",
  tensor_parallel_size: 1,
  enable_chunked_prefill: false,
  trust_remote_code: false,
  extra_flags: "",
  remote_port: 8000,
};

function toolCallParserForFamily(family: string): string {
  if (family.includes("llama")) return "llama3_json";
  if (family.includes("mistral")) return "mistral";
  return "hermes";
}

function reasoningParserForFamily(family: string): string {
  if (family.includes("deepseek")) return "deepseek_r1";
  return "qwen3";
}

// ── Inline log viewer with SSE streaming ─────────────────────────────────────

function TaskRunLog({
  taskRunId,
  onDone,
}: {
  taskRunId: string;
  onDone: (status: "SUCCESS" | "FAILED") => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    setLines([]);
    const source = new EventSource(`/api/v1/task-runs/${taskRunId}/logs/stream`);
    let settled = false;

    async function finalise() {
      if (settled) return;
      settled = true;
      try {
        const run = await api.taskRuns.get(taskRunId);
        onDoneRef.current(run.status === "SUCCESS" ? "SUCCESS" : "FAILED");
      } catch {
        onDoneRef.current("FAILED");
      }
    }

    source.onmessage = (e) => setLines((prev) => [...prev, e.data].slice(-400));
    source.addEventListener("done", () => { source.close(); finalise(); });
    source.onerror = () => { source.close(); finalise(); };

    return () => { settled = true; source.close(); };
  }, [taskRunId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  return (
    <pre
      ref={logRef}
      className="terminal mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed"
    >
      {lines.join("\n") || "Waiting for output..."}
    </pre>
  );
}

// ── Step header strip ─────────────────────────────────────────────────────────

function StepStrip({
  current,
  statuses,
  onGoTo,
}: {
  current: number;
  statuses: StepStatus[];
  onGoTo: (n: number) => void;
}) {
  const labels = ["Init Server", "Install vLLM", "Download Model", "Run & Tweak"];
  return (
    <div className="flex items-center border-b border-border bg-muted/20 px-4 py-3">
      {labels.map((label, i) => {
        const n = i + 1;
        const status = statuses[i];
        const isCurrent = n === current;
        const canGoTo = status === "success" || n <= current;
        return (
          <div key={n} className="flex flex-1 items-center gap-2">
            <button
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors ${
                isCurrent
                  ? "bg-background font-semibold text-foreground shadow-sm"
                  : canGoTo
                  ? "text-muted-foreground hover:text-foreground cursor-pointer"
                  : "cursor-default text-muted-foreground/40"
              }`}
              onClick={() => canGoTo && onGoTo(n)}
              disabled={!canGoTo}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  status === "success"
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : status === "failed"
                    ? "border-red-500 bg-red-500 text-white"
                    : status === "running"
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {status === "success" ? (
                  <Check className="h-3 w-3" />
                ) : status === "failed" ? (
                  "!"
                ) : status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  n
                )}
              </span>
              <span className="hidden sm:block">{label}</span>
            </button>
            {i < labels.length - 1 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PipelineStepperView({ session, models, modelsLoading }: PipelineStepperViewProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [steps, setSteps] = useState<StepState[]>([
    { status: "idle", taskRunId: null },
    { status: "idle", taskRunId: null },
    { status: "idle", taskRunId: null },
    { status: "idle", taskRunId: null },
  ]);

  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [selectedQuant, setSelectedQuant] = useState<ModelQuant | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [flags, setFlags] = useState<PipelineModelFlags>(DEFAULT_FLAGS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const serverId = session?.server_id ?? null;
  const sessionId = session?.id ?? null;

  function patchStep(idx: number, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function handleStepDone(idx: number, status: "SUCCESS" | "FAILED") {
    const stepStatus: StepStatus = status === "SUCCESS" ? "success" : "failed";
    patchStep(idx, { status: stepStatus });
    if (status === "SUCCESS" && idx < 3) {
      setCurrentStep(idx + 2);
    }
  }

  async function startStep(
    idx: number,
    fn: () => Promise<{ task_run_id: string; status: string }>,
  ) {
    if (!serverId || !sessionId) {
      toast.error("No active session");
      return;
    }
    try {
      patchStep(idx, { status: "running", taskRunId: null });
      const res = await fn();
      patchStep(idx, { taskRunId: res.task_run_id });
    } catch (e) {
      patchStep(idx, { status: "failed", taskRunId: null });
      toast.error(e instanceof Error ? e.message : "Failed to start step");
    }
  }

  const runStep1 = () =>
    startStep(0, () =>
      api.lab.pipelineInitServer({ session_id: sessionId!, server_id: serverId! }),
    );

  const runStep2 = () =>
    startStep(1, () =>
      api.lab.pipelineInstallVllm({ session_id: sessionId!, server_id: serverId! }),
    );

  const runStep3 = () => {
    if (!selectedModel || !selectedQuant) {
      toast.error("Select a model and quantization first");
      return;
    }
    startStep(2, () =>
      api.lab.pipelineDownloadModel({
        session_id: sessionId!,
        server_id: serverId!,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
      }),
    );
  };

  const runStep4 = () => {
    if (!selectedModel || !selectedQuant) {
      toast.error("Select a model and quantization first");
      return;
    }
    setHealthOk(null);
    startStep(3, () =>
      api.lab.pipelineRunModel({
        session_id: sessionId!,
        server_id: serverId!,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
        flags,
      }),
    );
  };

  const stopModel = async () => {
    if (!serverId || !sessionId) return;
    try {
      await api.lab.pipelineStopModel({ session_id: sessionId, server_id: serverId });
      setHealthOk(null);
      patchStep(3, { status: "idle", taskRunId: null });
      toast.success("Stop requested");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stop failed");
    }
  };

  const checkHealth = async () => {
    if (!session) return;
    setCheckingHealth(true);
    try {
      const res = await api.lab.observe(session.id, {
        health_check_url: `http://127.0.0.1:${flags.remote_port}/v1/models`,
      });
      setHealthOk(res.health_ok ?? false);
    } catch {
      setHealthOk(false);
    } finally {
      setCheckingHealth(false);
    }
  };

  // Update flags when model changes (auto-fill parsers)
  useEffect(() => {
    if (!selectedModel) return;
    const family = (selectedModel.family ?? "").toLowerCase();
    setFlags((prev) => ({
      ...prev,
      tool_call_parser: selectedModel.supports_tools ? toolCallParserForFamily(family) : prev.tool_call_parser,
      reasoning_parser: selectedModel.is_reasoning ? reasoningParserForFamily(family) : prev.reasoning_parser,
      enable_tools: false,
      enable_thinking: false,
    }));
  }, [selectedModel]);

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Open a session first to use the deployment pipeline.
      </div>
    );
  }

  const statuses = steps.map((s) => s.status);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-background">
      <StepStrip current={currentStep} statuses={statuses} onGoTo={setCurrentStep} />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {currentStep === 1 && (
          <StepContent
            title="Initialize Server"
            description="Installs curl, uv, and creates a Python 3.12 venv at ~/.inferix/venvs/vllm-2. Idempotent — safe to run multiple times."
            step={steps[0]}
            actionLabel="Initialize Server"
            onAction={runStep1}
            onDone={(s) => handleStepDone(0, s)}
            disabled={steps[0].status === "running"}
          />
        )}

        {currentStep === 2 && (
          <StepContent
            title="Install vLLM"
            description="Probes your CUDA version via nvidia-smi and installs the matching vLLM into the managed venv."
            step={steps[1]}
            actionLabel="Install vLLM"
            onAction={runStep2}
            onDone={(s) => handleStepDone(1, s)}
            disabled={steps[1].status === "running"}
          />
        )}

        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Download Model</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Select a model and quantization, then download its weights to the remote server.
              </p>
            </div>

            <ModelPicker
              models={models}
              modelsLoading={modelsLoading}
              search={modelSearch}
              onSearchChange={setModelSearch}
              selectedModel={selectedModel}
              selectedQuant={selectedQuant}
              onSelectModel={(m) => { setSelectedModel(m); setSelectedQuant(null); setModelSearch(m?.name ?? ""); }}
              onSelectQuant={setSelectedQuant}
            />

            {steps[2].status !== "idle" && (
              <StepStatusArea
                step={steps[2]}
                onDone={(s) => handleStepDone(2, s)}
              />
            )}

            {steps[2].status === "idle" || steps[2].status === "failed" ? (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={runStep3}
                disabled={!selectedModel || !selectedQuant || steps[2].status === "running"}
              >
                <Play className="h-3.5 w-3.5" />
                Download Model
              </Button>
            ) : steps[2].status === "success" ? (
              <Button size="sm" className="gap-1.5" onClick={() => setCurrentStep(4)}>
                Next: Run &amp; Tweak <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Run &amp; Tweak</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure capabilities, then launch vLLM in a managed tmux session.
              </p>
            </div>

            <CapabilityToggles
              model={selectedModel}
              flags={flags}
              onFlagsChange={setFlags}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            />

            {steps[3].status !== "idle" && (
              <StepStatusArea
                step={steps[3]}
                onDone={(s) => handleStepDone(3, s)}
              />
            )}

            {steps[3].status === "success" && (
              <Card className="border-border p-3">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-medium">Endpoint</p>
                  <code className="ml-auto text-xs text-muted-foreground">
                    http://&lt;server&gt;:{flags.remote_port}/v1
                  </code>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {healthOk === true ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Model is healthy
                    </span>
                  ) : healthOk === false ? (
                    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> Not responding yet
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Health unknown</span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-6 gap-1 px-2 text-[11px]"
                    onClick={checkHealth}
                    disabled={checkingHealth}
                  >
                    {checkingHealth ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Check health
                  </Button>
                </div>
              </Card>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={runStep4}
                disabled={!selectedModel || !selectedQuant || steps[3].status === "running"}
              >
                {steps[3].status === "success" ? (
                  <><RefreshCw className="h-3.5 w-3.5" /> Restart</>
                ) : (
                  <><Play className="h-3.5 w-3.5" /> Launch vLLM</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={stopModel}
                disabled={steps[3].status === "running"}
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable step content wrapper ─────────────────────────────────────────────

function StepContent({
  title,
  description,
  step,
  actionLabel,
  onAction,
  onDone,
  disabled,
}: {
  title: string;
  description: string;
  step: StepState;
  actionLabel: string;
  onAction: () => void;
  onDone: (s: "SUCCESS" | "FAILED") => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <StepStatusArea step={step} onDone={onDone} />
      {(step.status === "idle" || step.status === "failed") && (
        <Button size="sm" className="gap-1.5" onClick={onAction} disabled={disabled}>
          <Play className="h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      )}
      {step.status === "success" && (
        <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          Done — proceed to the next step.
        </p>
      )}
    </div>
  );
}

function StepStatusArea({ step, onDone }: { step: StepState; onDone: (s: "SUCCESS" | "FAILED") => void }) {
  if (!step.taskRunId) return null;
  return (
    <div>
      {step.status === "running" && (
        <TaskRunLog taskRunId={step.taskRunId} onDone={onDone} />
      )}
      {step.status === "failed" && (
        <Card className="border-red-500/30 bg-red-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Step failed. Check logs and retry.
          </p>
          <TaskRunLog taskRunId={step.taskRunId} onDone={() => {}} />
        </Card>
      )}
    </div>
  );
}

// ── Model picker ──────────────────────────────────────────────────────────────

function ModelPicker({
  models,
  modelsLoading,
  search,
  onSearchChange,
  selectedModel,
  selectedQuant,
  onSelectModel,
  onSelectQuant,
}: {
  models: ModelEntry[];
  modelsLoading: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  selectedModel: ModelEntry | null;
  selectedQuant: ModelQuant | null;
  onSelectModel: (m: ModelEntry | null) => void;
  onSelectQuant: (q: ModelQuant | null) => void;
}) {
  const filtered = models
    .filter(
      (m) =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.model_key.toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 20);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Model</label>
        {modelsLoading ? (
          <p className="text-xs text-muted-foreground">Loading models...</p>
        ) : (
          <>
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => { onSearchChange(e.target.value); if (selectedModel) onSelectModel(null); }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {search && !selectedModel && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-background shadow-md">
                {filtered.map((m) => (
                  <button
                    key={m.id}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-muted/40"
                    onClick={() => onSelectModel(m)}
                  >
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 text-muted-foreground">{m.param_count_b}B</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No models found</p>
                )}
              </div>
            )}
            {selectedModel && (
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                {selectedModel.name} · {selectedModel.param_count_b}B
              </p>
            )}
          </>
        )}
      </div>

      {selectedModel && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Quantization</label>
          <div className="flex flex-wrap gap-1.5">
            {selectedModel.quants.map((q) => (
              <QuantChip
                key={q.id}
                quant={q}
                selected={selectedQuant?.id === q.id}
                onSelect={() => onSelectQuant(q)}
                showActions={false}
              />
            ))}
            {selectedModel.quants.length === 0 && (
              <p className="text-xs text-muted-foreground">No quants available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Capability toggles ────────────────────────────────────────────────────────

function CapabilityToggles({
  model,
  flags,
  onFlagsChange,
  showAdvanced,
  onToggleAdvanced,
}: {
  model: ModelEntry | null;
  flags: PipelineModelFlags;
  onFlagsChange: (f: PipelineModelFlags) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}) {
  const patch = (p: Partial<PipelineModelFlags>) => onFlagsChange({ ...flags, ...p });

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
      {/* Tools */}
      {model?.supports_tools && (
        <ToggleRow
          label="Tools"
          desc="Enable function calling / tool use"
          flag={showAdvanced ? "--enable-auto-tool-choice" : undefined}
          enabled={flags.enable_tools}
          onToggle={(v) => patch({ enable_tools: v })}
        />
      )}

      {/* Thinking */}
      {model?.is_reasoning && (
        <ToggleRow
          label="Thinking"
          desc="Emit chain-of-thought reasoning tokens"
          flag={showAdvanced && flags.reasoning_parser ? `--reasoning-parser ${flags.reasoning_parser}` : undefined}
          enabled={flags.enable_thinking}
          onToggle={(v) => patch({ enable_thinking: v })}
        />
      )}

      {/* Context length */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs font-medium">Context length</p>
          <p className="text-[11px] text-muted-foreground">Max tokens in prompt + output</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1024}
            max={131072}
            step={1024}
            value={flags.max_model_len ?? 8192}
            onChange={(e) => patch({ max_model_len: Number(e.target.value) })}
            className="w-24"
          />
          <span className="min-w-[4rem] text-right text-xs text-muted-foreground">
            {((flags.max_model_len ?? 8192) / 1000).toFixed(0)}K
          </span>
          {showAdvanced && (
            <code className="text-[10px] text-muted-foreground">--max-model-len</code>
          )}
        </div>
      </div>

      {/* GPU utilization */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs font-medium">GPU utilization</p>
          <p className="text-[11px] text-muted-foreground">Fraction of VRAM reserved for KV cache</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.5}
            max={0.95}
            step={0.05}
            value={flags.gpu_memory_utilization}
            onChange={(e) => patch({ gpu_memory_utilization: Number(e.target.value) })}
            className="w-24"
          />
          <span className="min-w-[3rem] text-right text-xs text-muted-foreground">
            {Math.round(flags.gpu_memory_utilization * 100)}%
          </span>
          {showAdvanced && (
            <code className="text-[10px] text-muted-foreground">--gpu-memory-utilization</code>
          )}
        </div>
      </div>

      {/* Precision */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs font-medium">Precision</p>
          <p className="text-[11px] text-muted-foreground">Weight dtype — auto lets vLLM decide</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={flags.dtype}
            onChange={(e) => patch({ dtype: e.target.value })}
            className="rounded border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="auto">auto</option>
            <option value="float16">float16</option>
            <option value="bfloat16">bfloat16</option>
          </select>
          {showAdvanced && <code className="text-[10px] text-muted-foreground">--dtype</code>}
        </div>
      </div>

      {/* Port */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs font-medium">Port</p>
          <p className="text-[11px] text-muted-foreground">Local port for the vLLM server</p>
        </div>
        <input
          type="number"
          min={1024}
          max={65535}
          value={flags.remote_port}
          onChange={(e) => patch({ remote_port: Number(e.target.value) })}
          className="w-20 rounded border border-input bg-background px-2 py-1 text-xs"
        />
      </div>

      {/* Advanced section */}
      <div className="border-t border-border pt-3">
        <button
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={onToggleAdvanced}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <ToggleRow
              label="Chunked prefill"
              desc="Better throughput with grouped query attention"
              flag="--enable-chunked-prefill"
              enabled={flags.enable_chunked_prefill}
              onToggle={(v) => patch({ enable_chunked_prefill: v })}
            />
            <ToggleRow
              label="Trust remote code"
              desc="Allow model-specific Python code from HF"
              flag="--trust-remote-code"
              enabled={flags.trust_remote_code}
              onToggle={(v) => patch({ trust_remote_code: v })}
            />
            {model?.tp_allowed_sizes && model.tp_allowed_sizes.length > 1 && (
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium">Tensor parallel GPUs</p>
                  <code className="text-[10px] text-muted-foreground">--tensor-parallel-size</code>
                </div>
                <select
                  value={flags.tensor_parallel_size}
                  onChange={(e) => patch({ tensor_parallel_size: Number(e.target.value) })}
                  className="rounded border border-input bg-background px-2 py-1 text-xs"
                >
                  {model.tp_allowed_sizes.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium">Extra flags</label>
              <input
                type="text"
                placeholder="--max-num-batched-tokens 4096 ..."
                value={flags.extra_flags}
                onChange={(e) => patch({ extra_flags: e.target.value })}
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  flag,
  enabled,
  onToggle,
}: {
  label: string;
  desc: string;
  flag?: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
        {flag && <code className="text-[10px] text-muted-foreground/70">{flag}</code>}
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={`relative h-5 w-9 rounded-full border transition-colors ${
          enabled ? "border-primary bg-primary" : "border-border bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
