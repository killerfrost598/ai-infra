import { z } from "zod"

export const deploymentSchema = z.object({
  server_id: z.string().min(1, "Server is required"),
  model_name: z.string().min(1, "Model name is required"),
  model_alias: z.string().optional(),
  quantization: z.string().optional(),
  remote_port: z.number().int().min(1).max(65535),
})

export type DeploymentFormValues = z.infer<typeof deploymentSchema>

export const benchmarkSchema = z.object({
  gpu_model: z.string().min(1, "GPU model is required"),
  gpu_vram_gb: z.coerce.number().nullable().optional(),
  model_name: z.string().min(1, "Model name is required"),
  model_family: z.string().nullable().optional(),
  quantization: z.string().nullable().optional(),
  tokens_per_second_avg: z.coerce.number().nullable().optional(),
  tokens_per_second_p95: z.coerce.number().nullable().optional(),
  max_parallel_connections: z.coerce.number().int().nullable().optional(),
  vram_used_gb: z.coerce.number().nullable().optional(),
  measured_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type BenchmarkFormValues = z.infer<typeof benchmarkSchema>

export const playbookSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  steps_json: z.string().min(2, "Steps are required"),
})

export type PlaybookFormValues = z.infer<typeof playbookSchema>

export const serverSchema = z.object({
  hostname: z.string().min(1, "Hostname is required"),
  ssh_username: z.string().min(1, "SSH username is required"),
  ssh_port: z.number().int().min(1).max(65535),
  ssh_password: z.string().optional(),
  gpu_model: z.string().optional(),
  vram_gb: z.number().positive().optional(),
  notes: z.string().optional(),
})

export type ServerFormValues = z.infer<typeof serverSchema>
