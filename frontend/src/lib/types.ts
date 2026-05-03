export type ServerStatus = "NEW" | "PROVISIONING" | "READY" | "FAILED" | "TERMINATED";
export type DeploymentStatus = "PENDING" | "DEPLOYING" | "RUNNING" | "FAILED" | "STOPPED";
export type TaskStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";

export interface Server {
  id: string;
  external_server_id: string;
  hostname: string;
  ssh_port: number;
  ssh_username: string;
  has_ssh_password: boolean;
  has_ssh_key: boolean;
  gpu_model: string | null;
  vram_gb: number | null;
  cuda_version: string | null;
  ram_gb: number | null;
  network_bandwidth_mbps: number | null;
  os_image: string | null;
  status: ServerStatus;
  created_at: string;
}

export interface ServerCreate {
  external_server_id: string;
  hostname: string;
  ssh_port: number;
  ssh_username: string;
  ssh_password?: string;
  ssh_private_key?: string;
  gpu_model?: string;
  vram_gb?: number;
  ram_gb?: number;
  os_image?: string;
}

export interface ModelDeployment {
  id: string;
  server_id: string;
  playbook_id: string | null;
  model_name: string;
  model_alias: string | null;
  quantization: string | null;
  tunnel_local_port: number | null;
  remote_port: number;
  status: DeploymentStatus;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface Playbook {
  id: string;
  name: string;
  git_repo: string;
  git_branch: string;
  git_commit: string | null;
  tags: Record<string, unknown> | null;
  requirements_json: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskRun {
  id: string;
  task_type: string;
  status: TaskStatus;
  server_id: string | null;
  model_deployment_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  logs_path: string | null;
  error_summary: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export interface SSHTestStep {
  step: string;
  success: boolean;
  message: string;
  elapsed_ms: number;
}

export interface SSHTestResult {
  success: boolean;
  message: string;
  steps: SSHTestStep[];
}

export interface ExecResult {
  task_run_id: string;
}

export type SessionStatus = "ACTIVE" | "TERMINATED";

export interface SessionCommand {
  id: string;
  session_id: string;
  sequence_num: number;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  executed_at: string;
  duration_ms: number | null;
  created_at: string;
}

export interface Session {
  id: string;
  server_id: string;
  label: string | null;
  status: SessionStatus;
  started_at: string;
  terminated_at: string | null;
  pty_log: string | null;
  created_at: string;
  commands: SessionCommand[];
}

export interface SessionListItem {
  id: string;
  server_id: string;
  server_hostname: string | null;
  label: string | null;
  status: SessionStatus;
  started_at: string;
  terminated_at: string | null;
  created_at: string;
  command_count: number;
  has_pty_log: boolean;
}

export interface CloreBalance {
  balances: Array<{ currency: string; amount: number }>;
}

export interface SessionCreate {
  server_id: string;
  label?: string;
}

export interface CommandRequest {
  command: string;
  timeout?: number;
}

export interface ParsedCommand {
  command: string;
  output: string;
  started_ms: number;
  completed_ms: number;
  duration_ms: number;
  exit_code: number;
}

export interface CommandsSummary {
  commands: ParsedCommand[];
  total: number;
}

export interface ToPlaybookResult {
  playbook_yaml: string;
  command_count: number;
}

export interface CloreOffer {
  id: string;
  gpu_name: string;
  gpu_count: number;
  vram_gb: number;
  cuda_version: string | null;
  price_per_day: number;
  upload_mbps: number | null;
  download_mbps: number | null;
  cpu_model: string | null;
  ram_gb: number | null;
  disk_gb: number | null;
  pcie_version: string | null;
  pcie_width: number | null;
  allowed_coins: string[];
}

export interface CloreRental {
  id: string;
  gpu_name: string;
  vram_gb: number;
  hostname: string;
  ssh_port: number;
  ssh_username: string;
  ssh_password: string | null;
  cuda_version: string | null;
  status: string;
}

export interface RentRequest {
  offer_id: string;
  image: string;
  order_type: "on-demand" | "spot";
  currency: string;
  ssh_password?: string;
  ssh_key?: string;
  ports?: Record<string, string>;
  env?: Record<string, string>;
  command?: string;
  jupyter_token?: string;
  spot_price?: number;
  required_price?: number;
}

export interface SettingEntry {
  key: string;
  is_configured: boolean;
  updated_at: string | null;
}

export interface SettingsResponse {
  settings: SettingEntry[];
}

export interface InferenceBenchmark {
  id: string;
  gpu_model: string;
  gpu_vram_gb: number | null;
  model_name: string;
  model_family: string | null;
  quantization: string | null;
  tokens_per_second_avg: number | null;
  tokens_per_second_p95: number | null;
  ttft_ms_p50: number | null;
  ttft_ms_p95: number | null;
  prefill_tokens_per_second: number | null;
  cold_start_seconds: number | null;
  concurrency_curve: Array<{ n: number; agg_tps: number; per_req_tps: number; p95_ttft_ms: number }> | null;
  knee_concurrency: number | null;
  max_parallel_connections: number | null;
  vram_used_gb: number | null;
  profile: string | null;
  deployment_id: string | null;
  task_run_id: string | null;
  model_variant_id: string | null;
  measured_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface InferenceBenchmarkCreate {
  gpu_model: string;
  gpu_vram_gb?: number | null;
  model_name: string;
  model_family?: string | null;
  quantization?: string | null;
  tokens_per_second_avg?: number | null;
  tokens_per_second_p95?: number | null;
  max_parallel_connections?: number | null;
  vram_used_gb?: number | null;
  measured_at?: string | null;
  notes?: string | null;
}

export interface LeaderboardRow {
  gpu_model: string;
  samples: number;
  tps_median: number;
  ttft_p95_median: number | null;
  knee_median: number | null;
  cost_per_million_tokens: number | null;
}

export interface BenchmarkRunResponse {
  task_run_id: string;
  profile: string;
}

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";
export type FeasibilitySource = "predicted" | "snapshot";
export type FeasibilityVerdict = "READY" | "BLOCKED" | "UNKNOWN";
export type FeasibilityMode = "predicted" | "verified";

export interface FeasibilityCheck {
  id: string;
  status: CheckStatus;
  reason: string;
  source: FeasibilitySource;
}

export interface FeasibilityReport {
  verdict: FeasibilityVerdict;
  mode: FeasibilityMode;
  gpu_profile_key: string | null;
  stack_matrix_id: number | null;
  checks: FeasibilityCheck[];
}

export interface FeasibilityRequest {
  server_id?: string;
  offer_id?: number;
  model_key: string;
  quant: string;
  engine: string;
  tp_size?: number;
}
