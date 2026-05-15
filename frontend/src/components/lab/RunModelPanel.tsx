"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Eye,
  Gauge,
  Loader2,
  MessageSquare,
  Play,
  Send,
  Square,
  Cpu,
  RefreshCw,
  Download,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, withInferixApiKey } from "@/lib/api";
import { QuantChip } from "@/components/models/QuantChip";
import { ModelDownloadModal } from "@/components/lab/ModelDownloadModal";
import type { LabState, ModelEntry, ModelQuant, PipelineModelFlags, Session } from "@/lib/types";

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

// Step 2 runs install-vllm and download-model in parallel
interface SetupSubState {
  installStatus: StepStatus;
  installTaskRunId: string | null;
  downloadStatus: StepStatus;
  downloadTaskRunId: string | null;
  downloadId: string | null;         // download_id for modal SSE stream
  downloadRepoId: string | null;     // repo label for modal header
  showModal: boolean;
}

function setupCombinedStatus(s: SetupSubState): StepStatus {
  if (s.installStatus === "failed" || s.downloadStatus === "failed") return "failed";
  if (s.installStatus === "success" && s.downloadStatus === "success") return "success";
  if (s.installStatus === "running" || s.downloadStatus === "running") return "running";
  return "idle";
}

const DEFAULT_FLAGS: PipelineModelFlags = {
  enable_tools: false,
  tool_call_parser: null,
  enable_thinking: false,
  reasoning_parser: null,
  max_model_len: 8192,
  gpu_memory_utilization: 0.9,
  dtype: "auto",
  tensor_parallel_size: 1,
  enable_chunked_prefill: false,
  trust_remote_code: false,
  extra_flags: "",
  remote_port: 8000,
};

function defaultFlagsForSession(session: Session | null): PipelineModelFlags {
  const gpus = session?.latest_snapshot?.gpus ?? [];
  const minVramGb = gpus.length ? Math.min(...gpus.map((gpu) => gpu.vram_gb)) : null;

  if (minVramGb !== null && minVramGb <= 12) {
    return {
      ...DEFAULT_FLAGS,
      max_model_len: 4096,
      gpu_memory_utilization: 0.75,
      enable_chunked_prefill: true,
      extra_flags: "--enforce-eager",
    };
  }

  if (minVramGb !== null && minVramGb <= 16) {
    return {
      ...DEFAULT_FLAGS,
      gpu_memory_utilization: 0.8,
      enable_chunked_prefill: true,
    };
  }

  return DEFAULT_FLAGS;
}

function toolCallParserForFamily(family: string): string {
  if (family.includes("llama")) return "llama3_json";
  if (family.includes("mistral")) return "mistral";
  return "hermes";
}

function reasoningParserForFamily(family: string): string {
  if (family.includes("deepseek")) return "deepseek_r1";
  return "qwen3";
}

// ── Inline log viewer ─────────────────────────────────────────────────────────

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
    const source = new EventSource(withInferixApiKey(`/api/v1/task-runs/${taskRunId}/logs/stream`));
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
      className="terminal mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed"
    >
      {lines.join("\n") || "Waiting for output..."}
    </pre>
  );
}

// ── Step header strip ─────────────────────────────────────────────────────────

const STEP_LABELS = ["Init Server", "Install & Download", "Run & Tweak"];
const STEP_ICONS = [Cpu, Download, Wrench];

function StepStrip({
  current,
  statuses,
  onGoTo,
}: {
  current: number;
  statuses: StepStatus[];
  onGoTo: (n: number) => void;
}) {
  return (
    <div className="flex items-center border-b border-border bg-muted/20 px-4 py-3">
      {STEP_LABELS.map((label, i) => {
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
            {i < STEP_LABELS.length - 1 && (
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

  // Step 1: Init Server
  const [initStep, setInitStep] = useState<StepState>({ status: "idle", taskRunId: null });

  // Step 2: Install vLLM + Download Model (parallel)
  const [setup, setSetup] = useState<SetupSubState>({
    installStatus: "idle",
    installTaskRunId: null,
    downloadStatus: "idle",
    downloadTaskRunId: null,
    downloadId: null,
    downloadRepoId: null,
    showModal: false,
  });

  // Step 3: Run & Tweak
  const [runStep, setRunStep] = useState<StepState>({ status: "idle", taskRunId: null });

  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [selectedQuant, setSelectedQuant] = useState<ModelQuant | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [flags, setFlags] = useState<PipelineModelFlags>(() => defaultFlagsForSession(session));
  const [flagsTouched, setFlagsTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [labState, setLabState] = useState<LabState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);

  const serverId = session?.server_id ?? null;
  const sessionId = session?.id ?? null;

  // Derived step statuses for the strip
  const setupStatus = setupCombinedStatus(setup);
  const statuses: StepStatus[] = [initStep.status, setupStatus, runStep.status];

  useEffect(() => {
    if (!flagsTouched) setFlags(defaultFlagsForSession(session));
  }, [flagsTouched, session?.id, session?.latest_snapshot?.captured_at]);

  const loadLabState = async (refresh = false) => {
    if (!serverId) { setLabState(null); return; }
    setStateLoading(true);
    try {
      const state = await api.lab.state(serverId, { sessionId: sessionId ?? undefined, refresh });
      setLabState(state);
      if (state.initialized) setInitStep((prev) => prev.status === "running" ? prev : { ...prev, status: "success" });
      setSetup((prev) => ({
        ...prev,
        installStatus: state.vllm_installed && prev.installStatus !== "running" ? "success" : prev.installStatus,
        downloadStatus: state.downloaded_models.some((m) => m.status === "ready") && prev.downloadStatus !== "running" ? "success" : prev.downloadStatus,
      }));
      if (state.active_model?.health_ok) {
        setRunStep((prev) => prev.status === "running" ? prev : { ...prev, status: "success" });
        setHealthOk(true);
      }
    } catch {
      // State is advisory; the explicit task logs remain the source for in-flight work.
    } finally {
      setStateLoading(false);
    }
  };

  useEffect(() => {
    loadLabState(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, sessionId]);

  useEffect(() => {
    if (!labState || !models.length || selectedModel || selectedQuant) return;
    const ready = labState.downloaded_models.find((m) => m.status === "ready");
    if (!ready) return;
    const model = models.find((m) => m.id === ready.model_id);
    const quant = model?.quants.find((q) => q.id === ready.quant_id) ?? null;
    if (model && quant) {
      setSelectedModel(model);
      setSelectedQuant(quant);
      setModelSearch(model.name);
      if (labState.vllm_installed) setCurrentStep(3);
    }
  }, [labState, models, selectedModel, selectedQuant]);

  // Auto-fill parsers when model changes
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

  // When both parallel tasks succeed, advance to step 3
  useEffect(() => {
    if (setup.installStatus === "success" && setup.downloadStatus === "success") {
      setCurrentStep(3);
    }
  }, [setup.installStatus, setup.downloadStatus]);

  // ── Step 1 handlers ──────────────────────────────────────────────────────────

  const runInit = async () => {
    if (!serverId || !sessionId) { toast.error("No active session"); return; }
    try {
      setInitStep({ status: "running", taskRunId: null });
      const res = await api.lab.pipelineInitServer({ session_id: sessionId, server_id: serverId });
      setInitStep({ status: "running", taskRunId: res.task_run_id });
    } catch (e) {
      setInitStep({ status: "failed", taskRunId: null });
      toast.error(e instanceof Error ? e.message : "Failed to start init");
    }
  };

  const handleInitDone = (s: "SUCCESS" | "FAILED") => {
    const status: StepStatus = s === "SUCCESS" ? "success" : "failed";
    setInitStep((prev) => ({ ...prev, status }));
    if (s === "SUCCESS") { setCurrentStep(2); loadLabState(true); }
  };

  // ── Step 2 handlers ──────────────────────────────────────────────────────────

  const runSetup = async () => {
    if (!serverId || !sessionId) { toast.error("No active session"); return; }
    if (!selectedModel || !selectedQuant) { toast.error("Select a model and quantization first"); return; }

    // Reset sub-state
    setSetup({
      installStatus: "running",
      installTaskRunId: null,
      downloadStatus: "running",
      downloadTaskRunId: null,
      downloadId: null,
      downloadRepoId: null,
      showModal: false,
    });

    // Fire both in parallel
    try {
      const [installRes, downloadRes] = await Promise.all([
        api.lab.pipelineInstallVllm({ session_id: sessionId, server_id: serverId }),
        api.lab.pipelineDownloadModel({
          session_id: sessionId,
          server_id: serverId,
          model_id: selectedModel.id,
          quant_id: selectedQuant.id,
        }),
      ]);
      setSetup((prev) => ({
        ...prev,
        installTaskRunId: installRes.task_run_id,
        downloadTaskRunId: downloadRes.task_run_id,
        downloadId: downloadRes.download_id ?? null,
        downloadRepoId: selectedQuant.hf_repo || selectedModel.model_key,
        showModal: !!downloadRes.download_id,
      }));
    } catch (e) {
      setSetup({
        installStatus: "failed",
        installTaskRunId: null,
        downloadStatus: "failed",
        downloadTaskRunId: null,
        downloadId: null,
        downloadRepoId: null,
        showModal: false,
      });
      toast.error(e instanceof Error ? e.message : "Failed to start setup");
    }
  };

  const handleInstallDone = (s: "SUCCESS" | "FAILED") => {
    setSetup((prev) => ({ ...prev, installStatus: s === "SUCCESS" ? "success" : "failed" }));
    if (s === "SUCCESS") loadLabState(true);
  };

  const handleDownloadDone = (s: "SUCCESS" | "FAILED") => {
    setSetup((prev) => ({ ...prev, downloadStatus: s === "SUCCESS" ? "success" : "failed" }));
    if (s === "SUCCESS") loadLabState(false);
  };

  const handleDownloadModalComplete = (success: boolean) => {
    setSetup((prev) => ({ ...prev, downloadStatus: success ? "success" : "failed" }));
    loadLabState(false);
  };

  // ── Step 3 handlers ──────────────────────────────────────────────────────────

  const runModel = async () => {
    if (!serverId || !sessionId) { toast.error("No active session"); return; }
    if (!selectedModel || !selectedQuant) { toast.error("Select a model and quantization first"); return; }
    setHealthOk(null);
    try {
      setRunStep({ status: "running", taskRunId: null });
      const res = await api.lab.pipelineRunModel({
        session_id: sessionId,
        server_id: serverId,
        model_id: selectedModel.id,
        quant_id: selectedQuant.id,
        flags,
      });
      setRunStep({ status: "running", taskRunId: res.task_run_id });
    } catch (e) {
      setRunStep({ status: "failed", taskRunId: null });
      toast.error(e instanceof Error ? e.message : "Failed to launch model");
    }
  };

  const handleRunDone = (s: "SUCCESS" | "FAILED") => {
    setRunStep((prev) => ({ ...prev, status: s === "SUCCESS" ? "success" : "failed" }));
    loadLabState(true);
  };

  const stopModel = async () => {
    if (!serverId || !sessionId) return;
    try {
      await api.lab.pipelineStopModel({ session_id: sessionId, server_id: serverId });
      setHealthOk(null);
      setRunStep({ status: "idle", taskRunId: null });
      loadLabState(false);
      toast.success("Stop requested");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stop failed");
    }
  };

  const checkHealth = async () => {
    if (!session) return;
    setCheckingHealth(true);
    try {
      const port = labState?.active_model?.port ?? flags.remote_port;
      const res = await api.lab.observe(session.id, {
        health_check_url: `http://127.0.0.1:${port}/v1/models`,
      });
      setHealthOk(res.health_ok ?? false);
      loadLabState(true);
    } catch {
      setHealthOk(false);
    } finally {
      setCheckingHealth(false);
    }
  };

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Open a session first to use the deployment pipeline.
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-background">
      <StepStrip current={currentStep} statuses={statuses} onGoTo={setCurrentStep} />

      {/* Download modal — rendered outside the scroll container so it overlays correctly */}
      {setup.showModal && setup.downloadId && (
        <ModelDownloadModal
          downloadId={setup.downloadId}
          repoId={setup.downloadRepoId ?? setup.downloadId}
          onClose={() => setSetup((prev) => ({ ...prev, showModal: false }))}
          onComplete={handleDownloadModalComplete}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <LabReadinessBar state={labState} loading={stateLoading} onRefresh={() => loadLabState(true)} />

        {/* ── Step 1: Init Server ─────────────────────────────────────────── */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Initialize Server</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Installs curl, uv, and creates a Python 3.12 venv at ~/.inferix/venvs/vllm-2. Idempotent — safe to run again.
              </p>
            </div>

            {initStep.taskRunId && (
              <SubTaskLog
                label="Server init"
                status={initStep.status}
                taskRunId={initStep.taskRunId}
                onDone={handleInitDone}
              />
            )}

            {(initStep.status === "idle" || initStep.status === "failed") && (
              <Button size="sm" className="gap-1.5" onClick={runInit}>
                <Play className="h-3.5 w-3.5" />
                Initialize Server
              </Button>
            )}
            {initStep.status === "success" && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Done — proceed to step 2.
              </p>
            )}
          </div>
        )}

        {/* ── Step 2: Install & Download (parallel) ───────────────────────── */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Install &amp; Download</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a model, then install vLLM and download model weights simultaneously.
              </p>
            </div>

            {/* Model picker — always visible in this step */}
            <ModelPicker
              models={models}
              modelsLoading={modelsLoading}
              search={modelSearch}
              onSearchChange={setModelSearch}
              selectedModel={selectedModel}
              selectedQuant={selectedQuant}
              onSelectModel={(m) => { setSelectedModel(m); setSelectedQuant(null); setModelSearch(m?.name ?? ""); }}
              onSelectQuant={setSelectedQuant}
              disabled={setupStatus === "running"}
            />

            <ReadyModelsPanel
              state={labState}
              models={models}
              onSelect={(model, quant) => {
                setSelectedModel(model);
                setSelectedQuant(quant);
                setModelSearch(model.name);
                setCurrentStep(labState?.vllm_installed ? 3 : 2);
              }}
            />

            {/* Parallel task logs */}
            {setup.installTaskRunId && (
              <SubTaskLog
                label="Installing vLLM"
                status={setup.installStatus}
                taskRunId={setup.installTaskRunId}
                onDone={handleInstallDone}
              />
            )}

            {/* Download status panel — modal handles actual progress */}
            {setup.downloadId && (
              <div className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex items-center gap-2">
                  {setup.downloadStatus === "running" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  )}
                  {setup.downloadStatus === "success" && (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  )}
                  {setup.downloadStatus === "failed" && (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span className="text-xs font-medium">Downloading model weights</span>
                  <span className="ml-auto text-[10px] text-muted-foreground capitalize">
                    {setup.downloadStatus}
                  </span>
                  {(setup.downloadStatus === "running" || setup.downloadStatus === "success" || setup.downloadStatus === "failed") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[10px]"
                      onClick={() => setSetup((prev) => ({ ...prev, showModal: true }))}
                    >
                      <Eye className="h-3 w-3" />
                      View download
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Show partial failure message */}
            {setupStatus === "failed" && (
              <Card className="border-red-500/30 bg-red-500/10 p-3">
                <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  One or more tasks failed. Fix the issue and retry.
                </p>
              </Card>
            )}

            {(setupStatus === "idle" || setupStatus === "failed") && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={runSetup}
                disabled={!selectedModel || !selectedQuant}
              >
                <Play className="h-3.5 w-3.5" />
                {setupStatus === "failed" ? "Retry" : "Start"}
              </Button>
            )}

            {setupStatus === "success" && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Both tasks complete — proceed to Run &amp; Tweak.
              </p>
            )}
          </div>
        )}

        {/* ── Step 3: Run & Tweak ─────────────────────────────────────────── */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Run &amp; Tweak</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure capabilities and launch vLLM in a managed tmux session.
              </p>
            </div>

            {/* Show selected model as read-only context */}
            {selectedModel && selectedQuant && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                <span className="text-xs font-medium">{selectedModel.name}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{selectedQuant.name}</span>
              </div>
            )}

            <CapabilityToggles
              model={selectedModel}
              flags={flags}
              onFlagsChange={(next) => {
                setFlagsTouched(true);
                setFlags(next);
              }}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            />

            {runStep.taskRunId && (
              <SubTaskLog
                label="vLLM launch"
                status={runStep.status}
                taskRunId={runStep.taskRunId}
                onDone={handleRunDone}
              />
            )}

            {(runStep.status === "success" || labState?.active_model) && (
              <RunningModelPanel
                session={session}
                state={labState}
                selectedModel={selectedModel}
                selectedQuant={selectedQuant}
                fallbackPort={flags.remote_port}
                healthOk={healthOk}
                checkingHealth={checkingHealth}
                onCheckHealth={checkHealth}
                onBenchmarkStarted={() => loadLabState(false)}
              />
            )}

            {labState?.last_failure_diagnosis?.length ? (
              <FailureDiagnosisPanel state={labState} />
            ) : null}

            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={runModel}
                disabled={runStep.status === "running"}
              >
                {runStep.status === "success" ? (
                  <><RefreshCw className="h-3.5 w-3.5" /> Restart</>
                ) : (
                  <><Play className="h-3.5 w-3.5" /> Launch with auto-retry</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={stopModel}
                disabled={runStep.status === "running"}
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

function LabReadinessBar({
  state,
  loading,
  onRefresh,
}: {
  state: LabState | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (!state) return null;
  const readyDownloads = state.downloaded_models.filter((m) => m.status === "ready").length;
  const items = [
    { label: "Server", ok: state.initialized, value: state.initialized ? "initialized" : "needs init" },
    { label: "vLLM", ok: state.vllm_installed, value: state.vllm_version ?? (state.vllm_installed ? "installed" : "not installed") },
    { label: "Models", ok: readyDownloads > 0, value: `${readyDownloads} ready` },
    { label: "Endpoint", ok: state.active_model?.health_ok === true, value: state.active_model?.port ? `:${state.active_model.port}` : "none" },
  ];
  return (
    <div className="mb-4 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <span key={item.label} className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]">
            {item.ok ? <Check className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
            <span className="font-medium">{item.label}</span>
            <span className="text-muted-foreground">{item.value}</span>
          </span>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>
      {state.help_note && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{state.help_note}</p>
      )}
    </div>
  );
}

function ReadyModelsPanel({
  state,
  models,
  onSelect,
}: {
  state: LabState | null;
  models: ModelEntry[];
  onSelect: (model: ModelEntry, quant: ModelQuant) => void;
}) {
  const ready = state?.downloaded_models.filter((m) => m.status === "ready") ?? [];
  if (!ready.length) return null;
  return (
    <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Check className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-xs font-medium">Ready to launch</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {ready.map((cache) => {
          const model = models.find((m) => m.id === cache.model_id);
          const quant = model?.quants.find((q) => q.id === cache.quant_id);
          const label = model && quant ? `${model.name} · ${quant.name}` : cache.repo_id;
          return (
            <button
              key={cache.id}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted/40"
              onClick={() => model && quant && onSelect(model, quant)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FailureDiagnosisPanel({ state }: { state: LabState }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/10 p-3">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <p className="text-xs font-medium">Startup diagnosis</p>
      </div>
      <div className="space-y-2">
        {state.last_failure_diagnosis.map((match) => (
          <div key={match.issue_id} className="text-xs">
            <p className="font-medium">{match.title}</p>
            <p className="text-muted-foreground">{match.diagnosis}</p>
            <p className="mt-0.5 text-muted-foreground">Fix: {match.recommended_fix}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RunningModelPanel({
  session,
  state,
  selectedModel,
  selectedQuant,
  fallbackPort,
  healthOk,
  checkingHealth,
  onCheckHealth,
  onBenchmarkStarted,
}: {
  session: Session;
  state: LabState | null;
  selectedModel: ModelEntry | null;
  selectedQuant: ModelQuant | null;
  fallbackPort: number;
  healthOk: boolean | null;
  checkingHealth: boolean;
  onCheckHealth: () => void;
  onBenchmarkStarted: () => void;
}) {
  const active = state?.active_model;
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [reply, setReply] = useState("");
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [benchmarkTaskId, setBenchmarkTaskId] = useState<string | null>(null);
  const [benchmarkStatus, setBenchmarkStatus] = useState<StepStatus>("idle");

  const port = active?.port ?? fallbackPort;
  const modelLabel = active?.repo_id ?? selectedQuant?.hf_repo ?? selectedModel?.hf_repo ?? selectedModel?.model_key ?? "active model";
  const profile = active?.profile ?? {};
  const maxLen = typeof profile.max_model_len === "number" ? profile.max_model_len : null;

  const sendChat = async () => {
    if (!prompt.trim()) return;
    setSending(true);
    setReply("");
    setUsage(null);
    setLatency(null);
    try {
      const res = await api.lab.chat({
        session_id: session.id,
        server_id: session.server_id,
        model_id: selectedModel?.id ?? active?.model_id ?? null,
        quant_id: selectedQuant?.id ?? active?.quant_id ?? null,
        port,
        messages: [{ role: "user", content: prompt.trim() }],
        max_tokens: 160,
        temperature: 0.2,
      });
      setLatency(res.latency_ms);
      setUsage(res.usage);
      if (!res.ok) throw new Error(res.error ?? "Chat request failed");
      setReply(res.content);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chat request failed");
    } finally {
      setSending(false);
    }
  };

  const runBenchmark = async () => {
    setBenchmarkStatus("running");
    try {
      const res = await api.lab.benchmarkActive({ session_id: session.id, server_id: session.server_id, profile: "quick" });
      setBenchmarkTaskId(res.task_run_id);
      onBenchmarkStarted();
    } catch (e) {
      setBenchmarkStatus("failed");
      toast.error(e instanceof Error ? e.message : "Benchmark failed to start");
    }
  };

  return (
    <Card className="border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs font-medium">{modelLabel}</p>
        {maxLen && <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{maxLen} ctx</span>}
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">port {port}</span>
        <span className={`ml-auto flex items-center gap-1 text-xs ${
          (active?.health_ok ?? healthOk) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
        }`}>
          {(active?.health_ok ?? healthOk) ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {(active?.health_ok ?? healthOk) ? "healthy" : "health unknown"}
        </span>
        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={onCheckHealth} disabled={checkingHealth}>
          {checkingHealth ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Check
        </Button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs font-medium">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            Chat test
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={sendChat} disabled={sending}>
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send
            </Button>
            {latency !== null && <span className="text-[11px] text-muted-foreground">{latency} ms</span>}
            {usage && <span className="text-[11px] text-muted-foreground">tokens {String(usage.total_tokens ?? "n/a")}</span>}
          </div>
          {reply && <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">{reply}</div>}
        </div>

        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-medium">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
            Benchmark
          </div>
          <Button size="sm" variant="outline" className="h-7 w-full gap-1.5 text-xs" onClick={runBenchmark} disabled={benchmarkStatus === "running"}>
            {benchmarkStatus === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run quick benchmark
          </Button>
          {benchmarkTaskId && (
            <SubTaskLog
              label="Benchmark"
              status={benchmarkStatus}
              taskRunId={benchmarkTaskId}
              onDone={(s) => {
                setBenchmarkStatus(s === "SUCCESS" ? "success" : "failed");
                onBenchmarkStarted();
              }}
            />
          )}
          {state?.benchmarks?.length ? (
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {state.benchmarks.slice(0, 2).map((b) => (
                <div key={String(b.id)} className="flex justify-between gap-2">
                  <span>{String(b.profile ?? "benchmark")}</span>
                  <span>{typeof b.tokens_per_second_avg === "number" ? `${b.tokens_per_second_avg.toFixed(1)} tok/s` : "pending"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ── Sub-task log with status header ──────────────────────────────────────────

function SubTaskLog({
  label,
  status,
  taskRunId,
  onDone,
}: {
  label: string;
  status: StepStatus;
  taskRunId: string;
  onDone: (s: "SUCCESS" | "FAILED") => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/10 p-3">
      <div className="flex items-center gap-2">
        {status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        {status === "success" && <Check className="h-3.5 w-3.5 text-emerald-500" />}
        {status === "failed" && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
        <span className="text-xs font-medium">{label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground capitalize">{status}</span>
      </div>
      {(status === "running" || status === "failed") && (
        <TaskRunLog taskRunId={taskRunId} onDone={onDone} />
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
  disabled,
}: {
  models: ModelEntry[];
  modelsLoading: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  selectedModel: ModelEntry | null;
  selectedQuant: ModelQuant | null;
  onSelectModel: (m: ModelEntry | null) => void;
  onSelectQuant: (q: ModelQuant | null) => void;
  disabled?: boolean;
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
              disabled={disabled}
              onChange={(e) => { onSearchChange(e.target.value); if (selectedModel) onSelectModel(null); }}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
                onSelect={() => !disabled && onSelectQuant(q)}
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
      {model?.supports_tools && (
        <ToggleRow
          label="Tools"
          desc="Enable function calling / tool use"
          flag={showAdvanced ? "--enable-auto-tool-choice" : undefined}
          enabled={flags.enable_tools}
          onToggle={(v) => patch({ enable_tools: v })}
        />
      )}

      {model?.is_reasoning && (
        <ToggleRow
          label="Thinking"
          desc="Emit chain-of-thought reasoning tokens"
          flag={showAdvanced && flags.reasoning_parser ? `--reasoning-parser ${flags.reasoning_parser}` : undefined}
          enabled={flags.enable_thinking}
          onToggle={(v) => patch({ enable_thinking: v })}
        />
      )}

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
          {showAdvanced && <code className="text-[10px] text-muted-foreground">--max-model-len</code>}
        </div>
      </div>

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
          {showAdvanced && <code className="text-[10px] text-muted-foreground">--gpu-memory-utilization</code>}
        </div>
      </div>

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
