"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "./api"
import type { InferenceBenchmarkCreate, Playbook, RentRequest, ServerCreate } from "./types"

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const keys = {
  servers: () => ["servers"] as const,
  server: (id: string) => ["servers", id] as const,
  rentals: () => ["clore", "rentals"] as const,
  cloreOffers: (gpu?: string) => ["clore", "offers", gpu ?? ""] as const,
  cloreBalance: () => ["clore", "balance"] as const,
  taskRuns: (serverId?: string) => ["task-runs", serverId ?? ""] as const,
  deployments: () => ["deployments"] as const,
  playbooks: () => ["playbooks"] as const,
  sessions: (serverId?: string, status?: string) => ["sessions", serverId ?? "", status ?? ""] as const,
  benchmarks: (gpu?: string, model?: string) => ["benchmarks", gpu ?? "", model ?? ""] as const,
  settings: () => ["settings"] as const,
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

export function useCloreOffers(gpu?: string) {
  return useQuery({
    queryKey: keys.cloreOffers(gpu),
    queryFn: () => api.clore.offers(gpu || undefined),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.servers() }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rentals() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<import("./types").ModelDeployment>) => api.deployments.create(data),
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

export function useSaveSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.settings.set(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings() }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.settings.delete(key),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings() }),
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
