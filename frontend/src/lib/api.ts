import type {
  ApproveCandidate,
  AiAssistRequest,
  AiAssistResponse,
  BenchmarkRunResponse,
  CloreBalance,
  CloreOffer,
  CloreOffersResponse,
  CloreRental,
  ModelDeploymentCreate,
  CommandsSummary,
  ExecResult,
  FeasibilityReport,
  GpuProfileEntry,
  HostCapabilitySnapshot,
  ExecuteRecommendationRequest,
  ExecuteRecommendationResponse,
  DeploymentPlanRequest,
  DeploymentPlanResponse,
  FeasibilityRequest,
  InferenceBenchmark,
  InferenceBenchmarkCreate,
  LaunchRecommendation,
  LeaderboardRow,
  ListResponse,
  MachineSnapshotPayload,
  ModelDeployment,
  ModelEntry,
  ModelCreate,
  ModelQuant,
  ModelQuantCreate,
  ModelRunAggregate,
  ModelRunAttempt,
  ModelRunAttemptCreate,
  ModelRunAttemptUpdate,
  Playbook,
  RecommendRequest,
  RentRequest,
  ScrapeRun,
  SeedResponse,
  Server,
  ServerCreate,
  Session,
  SessionCommand,
  SessionCreate,
  SessionListItem,
  SettingEntry,
  SettingsResponse,
  SSHTestResult,
  SyncStatus,
  TaskRun,
  ToPlaybookResult,
  RecommendedPlaybook,
} from "./types";

// Empty string → relative URLs. The browser calls /api/v1/... on the same
// origin it loaded from (works from any host: localhost, Tailscale, etc.).
// Next.js rewrites forward those requests to the backend server-side.
const BASE_URL = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function apiFetchText(path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "text/plain", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.text();
}

export const api = {
  health: () => apiFetch<{ status: string; service: string }>("/health"),

  servers: {
    list: (skip = 0, limit = 20) =>
      apiFetch<ListResponse<Server>>(`/api/v1/servers?skip=${skip}&limit=${limit}`),
    get: (id: string) => apiFetch<Server>(`/api/v1/servers/${id}`),
    create: (data: ServerCreate) =>
      apiFetch<Server>("/api/v1/servers", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Server>) =>
      apiFetch<Server>(`/api/v1/servers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) =>
      fetch(`${BASE_URL}/api/v1/servers/${id}`, { method: "DELETE" }),

    reprobe: (id: string) =>
      apiFetch<{ task_run_id: string }>(`/api/v1/servers/${id}/reprobe`, { method: "POST" }),
    snapshot: (id: string) =>
      apiFetch<HostCapabilitySnapshot>(`/api/v1/servers/${id}/snapshot`),

    ssh: {
      test: (id: string, promoteIfReachable = true) =>
        apiFetch<SSHTestResult>(
          `/api/v1/servers/${id}/ssh/test${promoteIfReachable ? "" : "?promote_if_reachable=false"}`,
          { method: "POST" },
        ),
      exec: (id: string, command: string) =>
        apiFetch<ExecResult>(`/api/v1/servers/${id}/ssh/exec`, {
          method: "POST",
          body: JSON.stringify({ command }),
        }),
    },
  },

  deployments: {
    list: (skip = 0, limit = 20) =>
      apiFetch<ListResponse<ModelDeployment>>(`/api/v1/model-deployments?skip=${skip}&limit=${limit}`),
    get: (id: string) => apiFetch<ModelDeployment>(`/api/v1/model-deployments/${id}`),
    create: (data: ModelDeploymentCreate) =>
      apiFetch<ModelDeployment>("/api/v1/model-deployments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetch(`${BASE_URL}/api/v1/model-deployments/${id}`, { method: "DELETE" }),
  },

  playbooks: {
    list: (skip = 0, limit = 20) =>
      apiFetch<ListResponse<Playbook>>(`/api/v1/playbooks?skip=${skip}&limit=${limit}`),
    get: (id: string) => apiFetch<Playbook>(`/api/v1/playbooks/${id}`),
    create: (data: Partial<Playbook>) =>
      apiFetch<Playbook>("/api/v1/playbooks", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) =>
      fetch(`${BASE_URL}/api/v1/playbooks/${id}`, { method: "DELETE" }),
    run: (playbookId: string, serverId: string) =>
      apiFetch<{ task_id: string; status: string }>(
        `/api/v1/playbooks/${playbookId}/run?server_id=${serverId}`,
        { method: "POST" },
      ),
    recommended: (params: { model_key?: string; engine?: string; gpu_model?: string; min_runs?: number }) => {
      const p = new URLSearchParams();
      if (params.model_key) p.set("model_key", params.model_key);
      if (params.engine) p.set("engine", params.engine);
      if (params.gpu_model) p.set("gpu_model", params.gpu_model);
      if (params.min_runs != null) p.set("min_runs", String(params.min_runs));
      return apiFetch<RecommendedPlaybook[]>(`/api/v1/playbooks/recommended?${p}`);
    },
  },

  taskRuns: {
    list: (skip = 0, limit = 20, serverId?: string) => {
      const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
      if (serverId) params.set("server_id", serverId);
      return apiFetch<ListResponse<TaskRun>>(`/api/v1/task-runs?${params}`);
    },
    get: (id: string) => apiFetch<TaskRun>(`/api/v1/task-runs/${id}`),
    logs: (id: string) => apiFetchText(`/api/v1/task-runs/${id}/logs`),
  },

  settings: {
    list: () => apiFetch<SettingsResponse>("/api/v1/settings"),
    set: (key: string, value: string) =>
      apiFetch<SettingEntry>(`/api/v1/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }),
    delete: (key: string) =>
      fetch(`${BASE_URL}/api/v1/settings/${key}`, { method: "DELETE" }),
    generateKeypair: () =>
      apiFetch<{ public_key: string }>("/api/v1/settings/generate-ssh-keypair", { method: "POST" }),
    getPrivateKey: () =>
      apiFetch<{ private_key: string }>("/api/v1/settings/ssh-private-key"),
  },

  clore: {
    offers: (opts?: { refresh?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.refresh) params.set("refresh", "true");
      const q = params.toString();
      return apiFetch<CloreOffersResponse>(`/api/v1/clore/offers${q ? `?${q}` : ""}`);
    },
    rentals: () => apiFetch<{ rentals: CloreRental[] }>("/api/v1/clore/rentals"),
    rent: (req: RentRequest) =>
      apiFetch<Server>("/api/v1/clore/rentals", {
        method: "POST",
        body: JSON.stringify(req),
      }),
    terminate: (rentalId: string) =>
      fetch(`${BASE_URL}/api/v1/clore/rentals/${rentalId}`, { method: "DELETE" }),
    balance: () => apiFetch<CloreBalance>("/api/v1/clore/balance"),
  },

  benchmarks: {
    list: (gpuModel?: string, modelName?: string, skip = 0, limit = 50) => {
      const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
      if (gpuModel) params.set("gpu_model", gpuModel);
      if (modelName) params.set("model_name", modelName);
      return apiFetch<ListResponse<InferenceBenchmark>>(`/api/v1/benchmarks?${params}`);
    },
    forGpu: (gpuModel: string, modelName?: string) => {
      const params = new URLSearchParams();
      if (modelName) params.set("model_name", modelName);
      const q = params.toString();
      return apiFetch<ListResponse<InferenceBenchmark>>(
        `/api/v1/benchmarks/gpu/${encodeURIComponent(gpuModel)}${q ? `?${q}` : ""}`
      );
    },
    create: (data: InferenceBenchmarkCreate) =>
      apiFetch<InferenceBenchmark>("/api/v1/benchmarks", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetch(`${BASE_URL}/api/v1/benchmarks/${id}`, { method: "DELETE" }),
    run: (deploymentId: string, profile = "default") =>
      apiFetch<BenchmarkRunResponse>(
        `/api/v1/benchmarks/run/${deploymentId}?profile=${profile}`,
        { method: "POST" },
      ),
    leaderboard: (modelName?: string) => {
      const params = new URLSearchParams();
      if (modelName) params.set("model_name", modelName);
      const q = params.toString();
      return apiFetch<LeaderboardRow[]>(`/api/v1/benchmarks/leaderboard${q ? `?${q}` : ""}`);
    },
  },

  sessions: {
    list: (serverId?: string, status?: string, skip = 0, limit = 20) => {
      const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
      if (serverId) params.set("server_id", serverId);
      if (status) params.set("status", status);
      return apiFetch<ListResponse<SessionListItem>>(`/api/v1/sessions?${params}`);
    },
    get: (id: string) => apiFetch<Session>(`/api/v1/sessions/${id}`),
    create: (data: SessionCreate) =>
      apiFetch<Session>("/api/v1/sessions", { method: "POST", body: JSON.stringify(data) }),
    terminate: (id: string) =>
      fetch(`${BASE_URL}/api/v1/sessions/${id}`, { method: "DELETE" }),
    runCommand: (id: string, command: string, timeout = 30) =>
      apiFetch<SessionCommand>(`/api/v1/sessions/${id}/commands`, {
        method: "POST",
        body: JSON.stringify({ command, timeout }),
      }),
    queueCommand: (id: string, command: string, timeout = 1800) =>
      apiFetch<SessionCommand>(`/api/v1/sessions/${id}/commands/async`, {
        method: "POST",
        body: JSON.stringify({ command, timeout }),
      }),
    interrupt: (id: string) =>
      fetch(`${BASE_URL}/api/v1/sessions/${id}/interrupt`, { method: "POST" }),
    commandsSummary: (id: string) =>
      apiFetch<CommandsSummary>(`/api/v1/sessions/${id}/commands/summary`),
    toPlaybook: (
      id: string,
      body: { context?: string; keep_indices?: number[] },
      opts?: { save?: boolean; name?: string; engine?: string },
    ) => {
      const params = new URLSearchParams();
      if (opts?.save) params.set("save", "true");
      if (opts?.name) params.set("name", opts.name);
      if (opts?.engine) params.set("engine", opts.engine);
      const qs = params.toString();
      return apiFetch<ToPlaybookResult>(
        `/api/v1/sessions/${id}/to-playbook${qs ? `?${qs}` : ""}`,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
    downloadTranscriptUrl: (id: string) => `${BASE_URL}/api/v1/sessions/${id}/download`,
    downloadCommandUrl: (sessionId: string, cmdId: string) =>
      `${BASE_URL}/api/v1/sessions/${sessionId}/commands/${cmdId}/download`,
    refreshSnapshot: (id: string) =>
      apiFetch<MachineSnapshotPayload>(`/api/v1/sessions/${id}/refresh-snapshot`, { method: "POST" }),
  },

  feasibility: {
    check: (req: FeasibilityRequest) =>
      apiFetch<FeasibilityReport>("/api/v1/feasibility", {
        method: "POST",
        body: JSON.stringify(req),
      }),
  },

  compat: {
    scrapeRuns: (limit = 20) =>
      apiFetch<ScrapeRun[]>(`/api/v1/compat/scrape-runs?limit=${limit}`),
    triggerScrape: () =>
      apiFetch<{ task_id: string; status: string }>("/api/v1/compat/scrape-runs/trigger", {
        method: "POST",
      }),
    approve: (payload: ApproveCandidate) =>
      apiFetch<{ stack_matrix_id: number; status: string }>("/api/v1/compat/candidates/approve", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  },

  models: {
    list: (params?: {
      family?: string;
      search?: string;
      archived?: boolean;
      use_case?: string;
      tag?: string;
      param_min?: number;
      param_max?: number;
      gated?: string;
      quant_format?: string;
      sort?: string;
      is_reasoning?: boolean;
      is_code_model?: boolean;
      is_moe?: boolean;
    }) => {
      const q = new URLSearchParams();
      if (params?.family)       q.set("family", params.family);
      if (params?.search)       q.set("search", params.search);
      if (params?.archived)     q.set("archived", "true");
      if (params?.use_case)     q.set("use_case", params.use_case);
      if (params?.tag)          q.set("tag", params.tag);
      if (params?.param_min != null) q.set("param_min", String(params.param_min));
      if (params?.param_max != null) q.set("param_max", String(params.param_max));
      if (params?.gated)        q.set("gated", params.gated);
      if (params?.quant_format) q.set("quant_format", params.quant_format);
      if (params?.sort)         q.set("sort", params.sort);
      if (params?.is_reasoning) q.set("is_reasoning", "true");
      if (params?.is_code_model) q.set("is_code_model", "true");
      if (params?.is_moe)       q.set("is_moe", "true");
      return apiFetch<ModelEntry[]>(`/api/v1/models${q.toString() ? `?${q}` : ""}`);
    },
    families: () => apiFetch<string[]>("/api/v1/models/families"),
    get: (id: string) => apiFetch<ModelEntry>(`/api/v1/models/${id}`),
    create: (data: ModelCreate) =>
      apiFetch<ModelEntry>("/api/v1/models", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ModelCreate>) =>
      apiFetch<ModelEntry>(`/api/v1/models/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => fetch(`${BASE_URL}/api/v1/models/${id}`, { method: "DELETE" }),

    addQuant: (modelId: string, data: ModelQuantCreate) =>
      apiFetch<ModelQuant>(`/api/v1/models/${modelId}/quants`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateQuant: (modelId: string, quantId: string, data: Partial<ModelQuantCreate>) =>
      apiFetch<ModelQuant>(`/api/v1/models/${modelId}/quants/${quantId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteQuant: (modelId: string, quantId: string) =>
      fetch(`${BASE_URL}/api/v1/models/${modelId}/quants/${quantId}`, { method: "DELETE" }),

    seed: (repo_id: string) =>
      apiFetch<SeedResponse>("/api/v1/models/seed", {
        method: "POST",
        body: JSON.stringify({ repo_id }),
      }),
    refreshAll: () =>
      apiFetch<{ celery_task_id: string; queued: number }>("/api/v1/models/refresh-all", {
        method: "POST",
      }),
    seedDefaults: () =>
      apiFetch<{ queued: number; repo_ids: string[]; celery_task_ids: string[] }>(
        "/api/v1/models/seed-defaults",
        { method: "POST" }
      ),
    syncStatus: () => apiFetch<SyncStatus>("/api/v1/models/sync-status"),
    tagVocabulary: () => apiFetch<string[]>("/api/v1/models/tag-vocabulary"),
  },

  gpuProfiles: {
    list: () => apiFetch<GpuProfileEntry[]>("/api/v1/gpu-profiles"),
  },

  lab: {
    recommend: (data: RecommendRequest) =>
      apiFetch<LaunchRecommendation>("/api/v1/lab/recommend", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    assist: (data: AiAssistRequest) =>
      apiFetch<AiAssistResponse>("/api/v1/lab/assist", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    planDeployment: (data: DeploymentPlanRequest) =>
      apiFetch<DeploymentPlanResponse>("/api/v1/lab/deployments/plan", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    inject: (sessionId: string, data: { command: string; dry_run?: boolean; model_run_id?: string }) =>
      apiFetch<{ injected: boolean; command: string }>(`/api/v1/lab/sessions/${sessionId}/inject`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    executeRecommendation: (sessionId: string, data: ExecuteRecommendationRequest) =>
      apiFetch<ExecuteRecommendationResponse>(`/api/v1/lab/sessions/${sessionId}/execute-recommendation`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },

  runReports: {
    preview: (runId: string) =>
      apiFetch<Record<string, unknown>>(`/api/v1/run-reports/${runId}/preview`),
    publish: (runId: string) =>
      apiFetch<{ url: string; sha: string }>(`/api/v1/run-reports/${runId}/publish`, {
        method: "POST",
      }),
  },

  modelRuns: {
    list: (params?: {
      server_id?: string;
      model_id?: string;
      quant_id?: string;
      succeeded?: boolean;
      status?: string;
      limit?: number;
      skip?: number;
    }) => {
      const q = new URLSearchParams();
      if (params?.server_id) q.set("server_id", params.server_id);
      if (params?.model_id) q.set("model_id", params.model_id);
      if (params?.quant_id) q.set("quant_id", params.quant_id);
      if (params?.succeeded != null) q.set("succeeded", String(params.succeeded));
      if (params?.status) q.set("status", params.status);
      if (params?.limit) q.set("limit", String(params.limit));
      if (params?.skip) q.set("skip", String(params.skip));
      return apiFetch<ListResponse<ModelRunAttempt>>(`/api/v1/model-runs?${q}`);
    },
    create: (data: ModelRunAttemptCreate) =>
      apiFetch<ModelRunAttempt>("/api/v1/model-runs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: ModelRunAttemptUpdate) =>
      apiFetch<ModelRunAttempt>(`/api/v1/model-runs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    aggregate: (params?: { model_id?: string; quant_id?: string }) => {
      const q = new URLSearchParams();
      if (params?.model_id) q.set("model_id", params.model_id);
      if (params?.quant_id) q.set("quant_id", params.quant_id);
      const qs = q.toString();
      return apiFetch<ModelRunAggregate[]>(`/api/v1/model-runs/aggregate${qs ? `?${qs}` : ""}`);
    },
  },
};
