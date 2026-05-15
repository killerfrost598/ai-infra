"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "./api"
import type { CloreOffersResponse, InferenceBenchmarkCreate, ListResponse, Playbook, RentRequest, Server, ServerCreate } from "./types"

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const keys = {
  servers: () => ["servers"] as const,
  server: (id: string) => ["servers", id] as const,
  rentals: () => ["clore", "rentals"] as const,
  cloreOffers: () => ["clore", "offers"] as const,
  cloreBalance: () => ["clore", "balance"] as const,
  taskRuns: (serverId?: string) => ["task-runs", serverId ?? ""] as const,
  deployments: () => ["deployments"] as const,
  playbooks: () => ["playbooks"] as const,
  sessions: (serverId?: string, status?: string) => ["sessions", serverId ?? "", status ?? ""] as const,
  benchmarks: (gpu?: string, model?: string) => ["benchmarks", gpu ?? "", model ?? ""] as const,
  settings: () => ["settings"] as const,
  modelSyncStatus: () => ["models", "sync-status"] as const,
  gpuProfiles: () => ["gpu-profiles"] as const,
  modelRuns: (serverId?: string) => ["model-runs", serverId ?? ""] as const,
  labSession: (id: string) => ["lab-session", id] as const,
  deploymentRun: (taskRunId?: string) => ["lab", "deployment-run", taskRunId ?? ""] as const,
  agentRun: (taskRunId?: string) => ["lab", "agent-run", taskRunId ?? ""] as const,
  inferenceRoutes: () => ["inference", "routes"] as const,
  inferenceMetrics: (serverId?: string) => ["inference", "metrics", serverId ?? ""] as const,
}

const GLOBAL_FILTER_SETTING_KEYS = new Set([
  "clore_min_pcie_gen",
  "clore_min_pcie_width",
  "clore_min_disk_gb",
  "clore_min_dl_mbps",
  "clore_min_ul_mbps",
  "clore_min_cuda",
  "clore_min_vram_gb",
  "clore_gpu_query",
  "clore_max_price_per_day",
  "excluded_quant_formats",
])

function invalidateSettingDependents(qc: ReturnType<typeof useQueryClient>, settingKey: string) {
  qc.invalidateQueries({ queryKey: keys.settings() })
  if (!GLOBAL_FILTER_SETTING_KEYS.has(settingKey)) return
  qc.invalidateQueries({ queryKey: keys.cloreOffers() })
  qc.invalidateQueries({ queryKey: ["models"] })
  qc.invalidateQueries({ queryKey: ["model-catalogue"] })
}

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export function useServers(skip = 0, limit = 50) {
  return useQuery({
    queryKey: keys.servers(),
    queryFn: () => api.servers.list(skip, limit),
  })
}

export function useServer(id: string) {
  return useQuery({
    queryKey: keys.server(id),
    queryFn: () => api.servers.get(id),
    enabled: !!id,
  })
}

export function useRentals() {
  return useQuery({
    queryKey: keys.rentals(),
    queryFn: () => api.clore.rentals(),
  })
}

export function useCloreOffers() {
  return useQuery({
    queryKey: keys.cloreOffers(),
    queryFn: () => api.clore.offers(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useRefreshCloreOffers() {
  const qc = useQueryClient()
  return useMutation<CloreOffersResponse>({
    mutationFn: () => api.clore.offers({ refresh: true }),
    onSuccess: (data) => qc.setQueryData(keys.cloreOffers(), data),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCloreBalance(enabled = true) {
  return useQuery({
    queryKey: keys.cloreBalance(),
    queryFn: () => api.clore.balance(),
    enabled,
  })
}

export function useTaskRuns(serverId?: string, limit = 20) {
  return useQuery({
    queryKey: keys.taskRuns(serverId),
    queryFn: () => api.taskRuns.list(0, limit, serverId),
    refetchInterval: 3000,
  })
}

export function useDeployments(skip = 0, limit = 50) {
  return useQuery({
    queryKey: keys.deployments(),
    queryFn: () => api.deployments.list(skip, limit),
  })
}

export function usePlaybooks(skip = 0, limit = 50) {
  return useQuery({
    queryKey: keys.playbooks(),
    queryFn: () => api.playbooks.list(skip, limit),
  })
}

export function useSessions(serverId?: string, status?: string, limit = 50) {
  return useQuery({
    queryKey: keys.sessions(serverId, status),
    queryFn: () => api.sessions.list(serverId, status, 0, limit),
  })
}

export function useBenchmarks(gpu?: string, model?: string, limit = 50) {
  return useQuery({
    queryKey: keys.benchmarks(gpu, model),
    queryFn: () => api.benchmarks.list(gpu || undefined, model || undefined, 0, limit),
  })
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings(),
    queryFn: () => api.settings.list(),
  })
}

export function useInferenceRoutes() {
  return useQuery({
    queryKey: keys.inferenceRoutes(),
    queryFn: () => api.inference.routes(),
    refetchInterval: 10_000,
  })
}

export function useInferenceMetrics(serverId?: string) {
  return useQuery({
    queryKey: keys.inferenceMetrics(serverId),
    queryFn: () => api.inference.metrics(serverId),
    refetchInterval: 10_000,
  })
}

// ─── Mutation Hooks ───────────────────────────────────────────────────────────

export function useCreateServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ServerCreate) => api.servers.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.servers() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.servers.delete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.servers() })
      const previous = qc.getQueryData<ListResponse<Server>>(keys.servers())
      if (previous) {
        qc.setQueryData<ListResponse<Server>>(keys.servers(), {
          ...previous,
          total: Math.max(0, previous.total - 1),
          items: previous.items.filter((server) => server.id !== id),
        })
      }
      return { previous }
    },
    onError: (e: Error, _id, context) => {
      if (context?.previous) qc.setQueryData(keys.servers(), context.previous)
      toast.error(e.message)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.servers() }),
  })
}

export function useEndCloreRental() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.clore.terminate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.rentals() })
      qc.invalidateQueries({ queryKey: keys.servers() })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRentClore() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: RentRequest) => api.clore.rent(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rentals() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useTerminateRental() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.clore.terminate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.rentals() })
      qc.invalidateQueries({ queryKey: keys.servers() })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: import("./types").ModelDeploymentCreate) => api.deployments.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deployments() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deployments.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deployments() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreatePlaybook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Playbook>) => api.playbooks.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.playbooks() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeletePlaybook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.playbooks.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.playbooks() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateBenchmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: InferenceBenchmarkCreate) => api.benchmarks.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["benchmarks"] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteBenchmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.benchmarks.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["benchmarks"] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSeedDefaultModels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.models.seedDefaults(),
    onSuccess: (data) => {
      toast.success(`Seeding ${data.queued} model${data.queued === 1 ? "" : "s"} in background`)
      qc.invalidateQueries({ queryKey: keys.modelSyncStatus() })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSaveSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.settings.set(key, value),
    onSuccess: (_data, vars) => invalidateSettingDependents(qc, vars.key),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.settings.delete(key),
    onSuccess: (_data, key) => invalidateSettingDependents(qc, key),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: import("./types").SessionCreate) => api.sessions.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useModelSyncStatus(pollWhileRunning = false) {
  return useQuery({
    queryKey: keys.modelSyncStatus(),
    queryFn: () => api.models.syncStatus(),
    refetchInterval: pollWhileRunning ? 2000 : false,
  })
}

export function useRefreshAllModels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.models.refreshAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.modelSyncStatus() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useGpuProfiles() {
  return useQuery({
    queryKey: keys.gpuProfiles(),
    queryFn: () => api.gpuProfiles.list(),
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function useModelRuns(serverId?: string, limit = 20) {
  return useQuery({
    queryKey: keys.modelRuns(serverId),
    queryFn: () => api.modelRuns.list({ server_id: serverId, limit }),
    enabled: !!serverId,
  })
}

export function useCreateModelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: import("./types").ModelRunAttemptCreate) => api.modelRuns.create(data),
    onSuccess: (run) => qc.invalidateQueries({ queryKey: keys.modelRuns(run.server_id) }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateModelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: import("./types").ModelRunAttemptUpdate }) =>
      api.modelRuns.update(id, data),
    onSuccess: (run) => qc.invalidateQueries({ queryKey: keys.modelRuns(run.server_id) }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useModelRunsAggregate(enabled = true) {
  return useQuery({
    queryKey: ["model-runs", "aggregate"],
    queryFn: () => api.modelRuns.aggregate(),
    enabled,
    staleTime: 60_000,
  })
}

export function useActiveRuns(serverId?: string) {
  return useQuery({
    queryKey: ["model-runs", "active", serverId ?? ""],
    queryFn: () => api.modelRuns.list({ server_id: serverId, status: "RUNNING", limit: 3 }),
    enabled: !!serverId,
    refetchInterval: 10_000,
  })
}

export function useDeploymentRun(taskRunId?: string | null) {
  return useQuery({
    queryKey: keys.deploymentRun(taskRunId ?? undefined),
    queryFn: () => api.lab.deploymentRun(taskRunId as string),
    enabled: !!taskRunId,
    refetchInterval: (query) => {
      const data = query.state.data as import("./types").DeploymentRunStatusResponse | undefined
      const status = data?.status
      return status === "SUCCESS" || status === "FAILED" || status === "PARTIAL" ? false : 2000
    },
  })
}

export function useAgentRun(taskRunId?: string | null) {
  return useQuery({
    queryKey: keys.agentRun(taskRunId ?? undefined),
    queryFn: () => api.lab.agentRun(taskRunId as string),
    enabled: !!taskRunId,
    refetchInterval: (query) => {
      const data = query.state.data as import("./types").AgentRunStatusResponse | undefined
      const status = data?.status
      return status === "SUCCESS" || status === "FAILED" || status === "PARTIAL" ? false : 2000
    },
  })
}
