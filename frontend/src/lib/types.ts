import type { KvCache } from "./models/schema";

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
  cuda_version?: string;
}

export type EngineKind = "VLLM" | "SGLANG" | "OLLAMA";

export interface ModelDeploymentCreate {
  server_id: string;
  model_name: string;
  model_alias?: string;
  quantization?: string;
  remote_port?: number;
  engine?: EngineKind;
  model_variant_id?: string;
  tp_size?: number;
  playbook_id?: string;
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
  engine: EngineKind | null;
  model_variant_id: string | null;
  stack_matrix_id: number | null;
  inference_base_url: string | null;
}

export interface Playbook {
  id: string;
  name: string;
  git_repo: string;
  git_branch: string;
  git_commit: string | null;
  tags: Record<string, unknown> | null;
  requirements_json: Record<string, unknown> | null;
  model_variant_id: string | null;
  engine: EngineKind | null;
  source_session_id: string | null;
  created_at: string;
}

export interface RecommendedPlaybook {
  playbook_id: string;
  playbook_name: string;
  engine: EngineKind | null;
  total_runs: number;
  successful_runs: number;
  success_rate: number;
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

export interface PipelineModelFlags {
  enable_tools: boolean;
  tool_call_parser: string | null;
  enable_thinking: boolean;
  reasoning_parser: string | null;
  max_model_len: number | null;
  gpu_memory_utilization: number;
  dtype: string;
  tensor_parallel_size: number;
  enable_chunked_prefill: boolean;
  trust_remote_code: boolean;
  extra_flags: string;
  remote_port: number;
}

export interface PipelineStartResponse {
  task_run_id: string;
  status: string;
  download_id?: string | null;  // set for download-model step
  model_run_id?: string | null;
}

export interface LabKnownIssueMatch {
  issue_id: string;
  title: string;
  diagnosis: string;
  recommended_fix: string;
  remediation: string | null;
  safe_to_auto_apply: boolean;
  evidence: string;
}

export interface LabModelCache {
  id: string;
  server_id: string;
  model_id: string;
  quant_id: string;
  repo_id: string;
  cache_path: string | null;
  status: string;
  total_bytes: number | null;
  cached_bytes: number | null;
  last_download_task_id: string | null;
  last_checked_at: string | null;
  error: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LabActiveModel {
  model_id: string | null;
  quant_id: string | null;
  repo_id: string | null;
  port: number | null;
  endpoint: string | null;
  profile: Record<string, unknown> | null;
  health_ok: boolean | null;
  task_run_id: string | null;
  model_run_id: string | null;
  updated_at: string | null;
}

export interface LabState {
  server_id: string;
  initialized: boolean;
  initialized_at: string | null;
  vllm_installed: boolean;
  vllm_installed_at: string | null;
  vllm_version: string | null;
  vllm_help_flags: Record<string, unknown> | null;
  vllm_supported_flags: string[];
  downloaded_models: LabModelCache[];
  active_model: LabActiveModel | null;
  last_successful_profile: Record<string, unknown> | null;
  last_failed_profile: Record<string, unknown> | null;
  last_failure_kind: string | null;
  last_failure_reason: string | null;
  last_failure_diagnosis: LabKnownIssueMatch[];
  benchmarks: Array<Record<string, unknown>>;
  help_note: string;
  updated_at: string | null;
}

export interface LabChatRequest {
  session_id: string;
  server_id: string;
  model_id?: string | null;
  quant_id?: string | null;
  port?: number | null;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

export interface LabChatResponse {
  ok: boolean;
  model: string | null;
  content: string;
  raw: Record<string, unknown> | null;
  latency_ms: number;
  usage: Record<string, unknown> | null;
  error: string | null;
}

export interface LabBenchmarkActiveResponse {
  task_run_id: string;
  status: string;
}

// ── Model download types ────────────────────────────────────────────────────

export interface DownloadStartRequest {
  server_id: string;
  session_id: string;
  model_id: string;
  quant_id: string;
}

export interface DownloadFile {
  filename: string;
  size: number;
  size_mb: number;
  status: "cached" | "pending" | "downloading" | "completed" | "failed";
  downloaded: number;
  downloaded_mb: number;
  percent: number;
  error: string;
}

export interface DownloadStartResponse {
  download_id: string;
  task_run_id: string;
  repo_id: string;
  files: DownloadFile[];
  total_bytes: number;
  cached_bytes: number;
}

export interface DownloadSnapshot {
  event_type: string;
  download_id: string;
  repo_id: string;
  files: DownloadFile[];
  file_index: number;
  total_files: number;
  downloaded: number;
  downloaded_mb: number;
  total: number;
  total_mb: number;
  percent: number;
  avg_speed_mbps: number;
  elapsed: number;
  eta_seconds: number;
  finished: boolean;
  error: string;
}

export interface PipelineStepRequest {
  session_id: string;
  server_id: string;
}

export interface PipelineDownloadModelRequest extends PipelineStepRequest {
  model_id: string;
  quant_id: string;
}

export interface PipelineRunModelRequest extends PipelineStepRequest {
  model_id: string;
  quant_id: string;
  flags: PipelineModelFlags;
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

export interface GpuDetail {
  name: string;
  cc: string;
  vram_mb: number;
  vram_gb: number;
  driver_version: string | null;
  uuid: string | null;
  pcie_gen: number | null;
  pcie_width: number | null;
}

export interface HostCapabilitySnapshot {
  id: string;
  server_id: string;
  captured_at: string;
  driver_version: string | null;
  cuda_runtime_host: string | null;
  gpu_count: number;
  gpus: GpuDetail[] | null;
  nvlink_topology: string | null;
  homogeneous: boolean;
  docker_present: boolean;
  nvidia_container_toolkit: boolean;
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
  latest_snapshot: MachineSnapshotPayload | null;
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
  exit_code: number | null;
}

export interface CommandsSummary {
  commands: ParsedCommand[];
  total: number;
}

export interface ToPlaybookResult {
  playbook_yaml: string;
  command_count: number;
  playbook_id?: string;
}

export interface CloreOffer {
  id: string;
  gpu_name: string;
  gpu_count: number;
  gpu_array: string[];
  vram_gb: number;
  cuda_version: string | null;
  price_per_day: number;
  spot_price_per_day: number | null;
  upload_mbps: number | null;
  download_mbps: number | null;
  cpu_model: string | null;
  ram_gb: number | null;
  disk_gb: number | null;
  pcie_version: string | null;
  pcie_width: number | null;
  allowed_coins: string[];
  score: number | null;
  mrl: number | null;
  gpu_vendor: string | null;
  gpu_family: string | null;
  gpu_variant: string | null;
}

export interface CloreOfferGroup {
  key: string;
  vendor: string | null;
  family: string;
  variant: string | null;
  arch: string | null;
  display_name: string;
  offer_count: number;
  total_gpu_count: number;
  vram_min_gb: number;
  vram_max_gb: number;
  price_min_per_day: number;
  price_max_per_day: number;
  offer_ids: string[];
  sample_raw_names: string[];
}

export interface CloreOffersMeta {
  fetched_at: string;
  total_raw: number;
  total_filtered: number;
  applied_filters: Record<string, number | string | null>;
  from_cache: boolean;
}

export interface CloreOffersResponse {
  offers: CloreOffer[];
  groups: CloreOfferGroup[];
  meta: CloreOffersMeta;
}

export interface CloreRental {
  id: string;
  gpu_name: string;
  vram_gb: number;
  hostname: string;
  ssh_port: number;
  ssh_username: string;
  cuda_version: string | null;
  status: string;
  price_per_day: number | null;
  currency: string | null;
  creation_fee: number | null;
  spend: number | null;
  total_cost: number | null;
  rented_at: string | null;
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

export interface GpuProfileEntry {
  model_key: string;
  display_name: string;
  aliases: string[];
  arch: string;
  cc: string;
  vram_gb: number | null;
  fp8_native: boolean;
  bf16: boolean;
  marlin: boolean;
  fa2: boolean;
  fa3: boolean;
  is_full_profile: boolean;
  notes: string | null;
}

export interface SettingEntry {
  key: string;
  is_configured: boolean;
  updated_at: string | null;
  value?: string | null;
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

export interface CompatCandidate {
  engine: string;
  latest_version: string;
  current_version: string | null;
  is_newer: boolean;
  error?: string;
}

export interface ScrapeRun {
  task_run_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  candidates: CompatCandidate[] | null;
}

export interface ApproveCandidate {
  engine: string;
  version: string;
  cc_min: string;
  cc_max?: string;
  driver_min?: string;
  cuda_runtime?: string;
  torch?: string;
  container_image?: string;
  pip_index_url?: string;
  priority?: number;
}

// ── Model knowledge base ──────────────────────────────────────────────────────

export interface ModelQuant {
  id: string;
  model_id: string;
  name: string;
  hf_repo: string | null;
  hf_url: string | null;
  bits_per_weight: number;
  disk_size_gb: number;
  vram_weights_gb: number;
  quality_score: number;
  cc_min: string | null;
  arch_vllm: boolean;
  arch_sglang: boolean;
  notes: string | null;
  // Extended HF fields
  quant_format: string;
  quant_variant: string | null;
  safetensors_dtypes: Record<string, number> | null;
  tags: string[];
  library_name: string | null;
  gated: string | null;
  hf_downloads: number | null;
  hf_likes: number | null;
  author: string | null;
  author_class: "standard" | "community" | "private" | null;
  author_label: string | null;
  author_url: string | null;
  created_at: string;
}

export interface ModelEntry {
  id: string;
  model_key: string;
  name: string;
  family: string;
  param_count_b: number;
  hf_url: string | null;
  hf_repo: string | null;
  max_context_k: number;
  tags: string[];
  use_case: string;
  is_reasoning: boolean;
  supports_tools: boolean;
  is_code_model: boolean;
  is_moe: boolean;
  moe_active_params_b: number | null;
  num_attention_heads: number | null;
  tp_allowed_sizes: number[] | null;
  kv_cache: KvCache;
  recommended_engines: { engine: string; score: number; min_vram_gb: number }[];
  recommended_flags: Record<string, string[]>;
  source: string;
  hf_synced_at: string | null;
  is_archived: boolean;
  updated_at: string;
  created_at: string;
  quants: ModelQuant[];
  // Extended HF metadata
  org: string | null;
  architecture: string | null;
  pipeline_tag: string | null;
  library_name: string | null;
  license: string | null;
  languages: string[] | null;
  gated: string | null;
  base_model: string | null;
  hf_downloads: number | null;
  hf_likes: number | null;
  hf_trending_score: number | null;
  hf_last_modified: string | null;
  hf_created_at: string | null;
  author: string | null;
  author_class: "standard" | "community" | "private" | null;
  author_label: string | null;
  author_url: string | null;
}

export interface SyncStatus {
  task_type: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  error_summary: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SeedResponse {
  celery_task_id: string;
  repo_id: string;
}

export interface ModelCreate {
  model_key: string;
  name: string;
  family: string;
  param_count_b: number;
  hf_url?: string | null;
  hf_repo?: string | null;
  max_context_k: number;
  tags?: string[];
  use_case?: string;
  is_reasoning?: boolean;
  supports_tools?: boolean;
  is_code_model?: boolean;
  is_moe?: boolean;
  moe_active_params_b?: number | null;
  num_attention_heads?: number | null;
  tp_allowed_sizes?: number[] | null;
  kv_cache?: KvCache;
  recommended_engines?: { engine: string; score: number; min_vram_gb: number }[];
  recommended_flags?: Record<string, string[]>;
  quants?: ModelQuantCreate[];
}

export interface ModelQuantCreate {
  name: string;
  hf_repo?: string | null;
  hf_url?: string | null;
  bits_per_weight: number;
  disk_size_gb: number;
  vram_weights_gb: number;
  quality_score?: number;
  cc_min?: string | null;
  arch_vllm?: boolean;
  arch_sglang?: boolean;
  notes?: string | null;
}

export interface MachineSnapshotPayload {
  driver_version: string | null;
  cuda_runtime_host: string | null;
  gpu_count: number;
  gpus: Array<{ name: string; cc: string; vram_gb: number; driver_version?: string }>;
  nvlink_topology: string | null;
  homogeneous: boolean;
  docker_present: boolean;
  nvidia_container_toolkit: boolean;
  captured_at: string | null;
  is_stale: boolean;
}

export type RunStatus = "PLANNED" | "RUNNING" | "SUCCESS" | "FAILED" | "ABANDONED";
export type FailureStage = "PLAN" | "IMAGE_PULL" | "OOM" | "CC_MISMATCH" | "CUDA_MISMATCH" | "TIMEOUT" | "HEALTH_CHECK" | "OTHER";

export interface ModelRunAttempt {
  id: string;
  server_id: string;
  session_id: string | null;
  model_id: string;
  quant_id: string;
  host_snapshot_id: string | null;
  task_run_id: string | null;
  engine: EngineKind;
  engine_version: string | null;
  mode: string;
  container_image: string | null;
  container_id: string | null;
  launch_command: string;
  launch_plan_json: Record<string, unknown> | null;
  feasibility_verdict: string;
  forced: boolean;
  status: RunStatus;
  succeeded: boolean | null;
  failure_stage: FailureStage | null;
  failure_message: string | null;
  ttft_ms: number | null;
  tps_steady: number | null;
  vram_used_gb: number | null;
  health_check_url: string | null;
  health_check_ok: boolean | null;
  operator_notes: string | null;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  published_url: string | null;
  published_sha: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelRunAttemptCreate {
  server_id: string;
  session_id?: string;
  model_id: string;
  quant_id: string;
  engine: EngineKind;
  mode?: string;
  container_image?: string;
  launch_command?: string;
  feasibility_verdict?: string;
  forced?: boolean;
}

export interface ModelRunAttemptUpdate {
  status?: string;
  succeeded?: boolean;
  failure_stage?: string;
  failure_message?: string;
  operator_notes?: string;
  completed_at?: string;
  duration_seconds?: number;
}

export interface FeasibilityCheckOut {
  id: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  reason: string;
  source: string;
}

export interface FeasibilityReportOut {
  verdict: "READY" | "BLOCKED" | "UNKNOWN";
  mode: string;
  gpu_profile_key: string | null;
  stack_matrix_id: number | null;
  checks: FeasibilityCheckOut[];
}

export interface ParallelPlanOut {
  tp_size: number;
  blocked: boolean;
  block_reason: string | null;
  nvlink: boolean;
  interconnect_label: string;
}

export interface InstallPlanOut {
  stack_matrix_id: number;
  mode: string;
  container_image: string | null;
  pip_index_url: string | null;
  packages: string[];
  launch_cmd: string;
  tp_size: number;
  gpu_memory_utilization: number;
  env: Record<string, string>;
  remote_port: number;
}

export interface LaunchRecommendation {
  requires_reprobe: boolean;
  feasibility: FeasibilityReportOut | null;
  parallel: ParallelPlanOut | null;
  install_plan: InstallPlanOut | null;
  injectable_command: string;
  warnings: string[];
  force_required: boolean;
}

export interface RecommendRequest {
  server_id: string;
  model_id: string;
  quant_id: string;
  engine?: string;
  session_id?: string;
  remote_port?: number;
}

export interface ExecuteRecommendationRequest extends RecommendRequest {
  force?: boolean;
  command_timeout_seconds?: number;
  health_timeout_seconds?: number;
}

export interface ExecuteRecommendationResponse {
  run: ModelRunAttempt;
  recommendation: LaunchRecommendation;
  command_exit_code: number | null;
  command_stdout: string;
  command_stderr: string;
  health_ok: boolean | null;
  vram_used_gb: number | null;
}

export interface AiAssistRequest extends RecommendRequest {
  provider?: "auto" | "anthropic" | "openai" | "chatgpt";
  operator_goal?: string;
  include_prompt_context?: boolean;
}

export interface AiAssistResponse {
  provider: string;
  model: string;
  guidance: string;
  prompt_context: Record<string, unknown> | null;
}

export interface DeploymentPlanStep {
  id: string;
  title: string;
  stage: string;
  command: string | null;
  required: boolean;
  status: string;
  risk: string;
  auto_eligible: boolean;
  recommended: boolean;
  expected: string | null;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  stdout_tail: string;
  stderr_tail: string;
  error: string | null;
}

export interface DeploymentPlanRequest extends RecommendRequest {
  runtime_mode?: "auto" | "docker" | "uv_venv";
}

export interface DeploymentPlanResponse {
  runtime_mode: string;
  engine: string;
  remote_port: number;
  ready_to_run: boolean;
  blockers: string[];
  steps: DeploymentPlanStep[];
  recommendation: LaunchRecommendation;
}

export interface DeploymentRunRequest extends DeploymentPlanRequest {
  auto_setup_mode?: "recommend_only" | "auto_low_risk_setup";
  force?: boolean;
  health_timeout_seconds?: number;
  command_timeout_seconds?: number;
}

export interface DeploymentRunStartResponse {
  task_run_id: string;
  model_run_id: string;
  status: string;
}

export interface DeploymentRunStatusResponse {
  task_run_id: string;
  model_run_id: string | null;
  status: string;
  error_summary: string | null;
  runtime_mode: string | null;
  auto_setup_mode: string | null;
  cancel_requested: boolean;
  steps: DeploymentPlanStep[];
}

export interface AgentRunEvent {
  id: string;
  ts: string;
  type: string;
  summary: string;
  tool: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  status: string;
}

export interface AgentRunRequest extends RecommendRequest {
  runtime_mode?: "auto" | "docker" | "uv_venv";
  force?: boolean;
  max_iterations?: number;
  command_timeout_seconds?: number;
  health_timeout_seconds?: number;
}

export interface AgentRunStartResponse {
  task_run_id: string;
  model_run_id: string;
  status: string;
  tmux_session: string;
}

export interface AgentRunStatusResponse {
  task_run_id: string;
  model_run_id: string | null;
  status: string;
  error_summary: string | null;
  tmux_session: string | null;
  cancel_requested: boolean;
  current_launch_command: string | null;
  reasoning_summary: string | null;
  health: Record<string, unknown>;
  success_ready: boolean;
  playbook_id: string | null;
  tmux_output_tail: string;
  events: AgentRunEvent[];
  steps: DeploymentPlanStep[];
}

export interface PromotePlaybookResponse {
  playbook_id: string;
  git_repo: string;
  git_commit: string | null;
}

export interface ModelRunAggregate {
  model_id: string;
  quant_id: string;
  total: number;
  successful: number;
  success_rate: number;
  avg_tps: number | null;
}
