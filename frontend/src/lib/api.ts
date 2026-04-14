import type {
  ApiKey,
  CloreOffer,
  CloreRental,
  ExecResult,
  ListResponse,
  ModelDeployment,
  Playbook,
  Server,
  ServerCreate,
  Session,
  SessionCommand,
  SessionCreate,
  SessionListItem,
  SettingEntry,
  SettingsResponse,
  SSHTestResult,
  TaskRun,
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

    ssh: {
      test: (id: string) =>
        apiFetch<SSHTestResult>(`/api/v1/servers/${id}/ssh/test`, { method: "POST" }),
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
    create: (data: Partial<ModelDeployment>) =>
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
  },

  clore: {
    offers: (gpuName?: string) => {
      const params = new URLSearchParams();
      if (gpuName) params.set("gpu_name", gpuName);
      const q = params.toString();
      return apiFetch<{ offers: CloreOffer[] }>(`/api/v1/clore/offers${q ? `?${q}` : ""}`);
    },
    rentals: () => apiFetch<{ rentals: CloreRental[] }>("/api/v1/clore/rentals"),
    rent: (offerId: string, image: string, sshPassword?: string) => {
      const params = new URLSearchParams({ offer_id: offerId, image });
      if (sshPassword) params.set("ssh_password", sshPassword);
      return apiFetch<Server>(`/api/v1/clore/rentals?${params}`, { method: "POST" });
    },
    terminate: (rentalId: string) =>
      fetch(`${BASE_URL}/api/v1/clore/rentals/${rentalId}`, { method: "DELETE" }),
  },

  apiKeys: {
    list: () => apiFetch<ListResponse<ApiKey>>("/api/v1/api-keys"),
    create: (keyName: string, keyPrefix: string, providerName?: string) =>
      apiFetch<ApiKey>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ key_name: keyName, key_prefix: keyPrefix, provider_name: providerName ?? null }),
      }),
    revoke: (id: string) =>
      fetch(`${BASE_URL}/api/v1/api-keys/${id}`, { method: "DELETE" }),
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
    interrupt: (id: string) =>
      fetch(`${BASE_URL}/api/v1/sessions/${id}/interrupt`, { method: "POST" }),
    downloadTranscriptUrl: (id: string) => `${BASE_URL}/api/v1/sessions/${id}/download`,
    downloadCommandUrl: (sessionId: string, cmdId: string) =>
      `${BASE_URL}/api/v1/sessions/${sessionId}/commands/${cmdId}/download`,
  },
};
