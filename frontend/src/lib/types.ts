export type ServerStatus = "NEW" | "PROVISIONING" | "READY" | "FAILED" | "TERMINATED";
export type DeploymentStatus = "PENDING" | "DEPLOYING" | "RUNNING" | "FAILED" | "STOPPED";
export type TaskStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";

export interface Server {
  id: string;
  provider_account_id: string | null;
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
  litellm_route_name: string | null;
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

export interface SSHTestResult {
  success: boolean;
  message: string;
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
}

export interface SessionCreate {
  server_id: string;
  label?: string;
}

export interface CommandRequest {
  command: string;
  timeout?: number; // seconds, default 30, max 300
}

export interface CloreOffer {
  id: string;
  gpu_name: string;
  gpu_count: number;
  vram_gb: number;
  cuda_version: string | null;
  price_per_hour: number;
  // Network
  upload_mbps: number | null;
  download_mbps: number | null;
  // Hardware
  cpu_model: string | null;
  ram_gb: number | null;
  disk_gb: number | null;
  // PCIe
  pcie_version: string | null;
  pcie_width: number | null;
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

export interface ApiKey {
  id: string;
  key_name: string;
  key_prefix: string;
  provider_name: string | null;
  is_revoked: boolean;
  created_at: string;
}

export interface SettingEntry {
  key: string;
  is_configured: boolean;
  updated_at: string | null;
}

export interface SettingsResponse {
  settings: SettingEntry[];
}
