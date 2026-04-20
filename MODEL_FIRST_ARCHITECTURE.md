# Model-First Rental & Deploy Architecture

Status: **PROPOSED (awaiting user approval)**
Date: 2026-04-18
Owner: single-operator
Supersedes / extends: `ARCHITECTURE.md`, `DEVELOPMENT.md` §3 (Phase 5+), §5 Future work

---

## 0. Goal

Invert the current flow. Today the operator picks a GPU offer first, then
rents, then picks a model. We want the operator to pick a **model** first —
the platform then:

1. Tells them which Clore offers will actually run it well (VRAM / CUDA /
   PCIe / historical throughput),
2. Lets them pick a runtime (vLLM, Ollama, LM Studio) and known-good
   playbook for that model,
3. Rents the server, deploys the model, and streams every step with
   timings, byte counts, and error detail into the GUI.

This document defines the target architecture, what exists, what needs
revision, what is new.

---

## 1. Current State Audit (what's implemented)

### Data model — already in DB (`backend/app/models/entities.py`)

| Table | What it stores | Covers our new flow? |
|---|---|---|
| `servers` | rented GPU boxes (hostname, SSH creds, gpu_model, vram_gb) | ✅ runtime infra |
| `playbooks` | git_repo + setup.sh + tags + requirements_json | ⚠️ too thin — no runtime/model link |
| `model_deployments` | server_id, model_name, quantization, remote_port, status | ⚠️ no runtime field, no progress events |
| `task_runs` | status + logs_path + error_summary + metadata_json | ✅ reusable as-is |
| `inference_benchmarks` | gpu_model × model_name × tokens/s + VRAM used | ✅ compatibility signal source |
| `sessions` / `session_commands` | PTY transcripts | ✅ — not in critical path |

### Pipelines / services

| Area | File | State |
|---|---|---|
| Clore adapter | `backend/app/services/clore_client.py` | solid; partial SDK bypass for `my_orders`/`create_order` per ADR-006 |
| Playbook runner | `backend/app/services/playbook_runner.py` | minimal: `git clone` + `setup.sh` + exit-code log |
| Celery tasks | `backend/app/workers/tasks.py` | provision, deploy_model (vLLM only, hardcoded), terminate, ssh_exec, run_playbook |
| SSE log stream | `GET /task-runs/{id}/logs/stream` | single-file text tailing (works, has B4 byte/char issue) |
| Frontend flow | `frontend/src/app/clore/page.tsx` + `/deployments/page.tsx` | offer-first. Model is a free-text string, runtime is implicit (always vLLM) |

### Gaps vs. what user asked for

| Ask | Today | Gap |
|---|---|---|
| Pick model → see compatible GPUs | no model catalog; user types `model_name` as free text | need `model_catalog` table + matcher |
| Runtime choice (vLLM / Ollama / LM Studio) | hardcoded vLLM in `deploy_model` Celery task | need runtime enum + per-runtime launcher |
| Historical "which playbooks worked for this model" | task_runs has `metadata_json.playbook_id` but no model linkage | need explicit `deploy_events` linking model × playbook × server × outcome |
| GUI step-by-step progress with ETA, bytes, speed | single log file tailed as text | need structured events (step, progress, bytes_done / bytes_total, rate), SSE JSON frames |
| "Why did it fail" error codes | free-text `error_summary` | need `error_code` enum on events |
| Model performance comparison across GPUs | `inference_benchmarks` has the raw data | need a GPU×model leaderboard view driven by it |

### Open bugs that collide with this work

- **B2** Critical — Deploy→Infer broken post-LiteLLM. This plan's **runtime layer** fixes it (each runtime adapter exposes an OpenAI-compatible URL).
- **B3** High — `provision_server` overwrites user gpu_model/vram. Fix inside Phase 2 below.
- **B4** Medium — SSE byte/char offset. Resolved by switching to **event-stream JSON frames** instead of raw-byte tail (Phase 4).
- **B6** Low — frontend "Run" button missing. Subsumed by new model-first deploy UI.

---

## 2. Target Architecture

### 2.1 New domain concepts

```
ModelCatalog  ──► has many ──► ModelRuntimeProfile  ──► references ──► Playbook
     │                                │
     │                                └── runtime ∈ {vllm, ollama, lmstudio, tgi, custom}
     │
     └── minimum VRAM, recommended VRAM, family, quantizations available,
         HF repo, expected download size, context length, architecture

DeployPlan         = (model_catalog_id, runtime, playbook_id?, target_gpu_constraints)
DeployEvent        = structured step inside a TaskRun: {step, status, progress_pct,
                     bytes_done, bytes_total, rate_bps, eta_s, error_code, message, ts}
CompatibilityScore = f(model, gpu_offer, benchmark_history) → {fits, verified, predicted_tps}
```

### 2.2 New data model (DDL)

```python
# backend/app/models/entities.py — additions

class RuntimeKind(str, enum.Enum):
    VLLM = "VLLM"
    OLLAMA = "OLLAMA"
    LMSTUDIO = "LMSTUDIO"
    TGI = "TGI"
    CUSTOM = "CUSTOM"

class ModelCatalogEntry(Base):
    __tablename__ = "model_catalog"
    id: UUID (pk)
    name: str              # "meta-llama/Llama-3.1-8B-Instruct"
    display_name: str      # "Llama 3.1 8B Instruct"
    family: str            # "llama3", "qwen2.5", "mistral", "deepseek"
    architecture: str      # "LlamaForCausalLM"
    parameters_b: float    # 8.0, 70.0 (billions)
    hf_repo: str | None
    license: str | None
    context_length: int | None
    min_vram_gb: int       # FP16 unquantized floor
    recommended_vram_gb: int
    default_quantizations: JSON   # ["awq", "gptq-4bit", "fp8", "bnb-int4"]
    approx_download_gb: float | None   # for ETA
    tags: JSON              # ["chat", "code", "vision", "reasoning"]
    is_archived: bool = False
    created_at, updated_at

class ModelRuntimeProfile(Base):
    """Which runtimes can serve a given model + preferred playbook + knobs."""
    __tablename__ = "model_runtime_profiles"
    id: UUID (pk)
    model_catalog_id: FK(ModelCatalogEntry, CASCADE)
    runtime: RuntimeKind
    playbook_id: FK(Playbook, SET NULL, nullable)
    # Runtime-specific launch knobs (tensor-parallel size, kv cache, etc.)
    launch_args: JSON
    # Quick compatibility hints
    min_vram_gb: int | None       # override if quantization lowers it
    quantization: str | None      # pin for this profile
    is_default: bool               # one default per (model_id, runtime)
    notes: str | None

class DeployEvent(Base):
    """One structured step in a deployment lifecycle — streamed via SSE."""
    __tablename__ = "deploy_events"
    id: UUID (pk)
    task_run_id: FK(TaskRun, CASCADE)
    sequence_num: int              # monotonic within task_run
    step: str                      # "rent", "ssh_wait", "clone", "docker_pull",
                                    # "model_download", "runtime_start", "health_check"
    status: str                    # "running" | "success" | "failed" | "skipped"
    progress_pct: float | None     # 0..100 when known
    bytes_done: int | None
    bytes_total: int | None
    rate_bps: int | None
    eta_seconds: int | None
    error_code: str | None         # "HF_RATE_LIMIT", "CUDA_OOM", "SSH_AUTH_FAIL", ...
    message: str | None            # human-readable
    started_at, finished_at
    created_at

class PlaybookRunOutcome(Base):
    """Denormalized, queryable view: which playbooks succeeded for which (model, gpu) pairs."""
    __tablename__ = "playbook_run_outcomes"
    id: UUID (pk)
    task_run_id: FK(TaskRun, SET NULL, unique)
    playbook_id: FK(Playbook, SET NULL)
    model_catalog_id: FK(ModelCatalogEntry, SET NULL)
    runtime: RuntimeKind
    gpu_model: str                 # normalized ("NVIDIA GeForce RTX 4090")
    gpu_count: int
    vram_gb: int
    succeeded: bool
    duration_seconds: int | None
    first_token_ms: int | None
    tokens_per_second_avg: float | None
    created_at
    # index: (model_catalog_id, gpu_model, succeeded)
```

Additions to `model_deployments`:

```python
runtime:        RuntimeKind                  # replaces the implicit "always vLLM"
model_catalog_id: FK(ModelCatalogEntry, SET NULL, nullable)
runtime_profile_id: FK(ModelRuntimeProfile, SET NULL, nullable)
launch_args:    JSON                         # snapshot of what was actually used
inference_base_url: str | None               # "http://host:port/v1" — fixes B2
```

### 2.3 Runtime adapter layer (new)

```
backend/app/services/runtimes/
├── base.py            # RuntimeAdapter Protocol
├── vllm_runtime.py
├── ollama_runtime.py
├── lmstudio_runtime.py
└── tgi_runtime.py
```

Each adapter exposes:

```python
class RuntimeAdapter(Protocol):
    kind: RuntimeKind
    def build_deploy_steps(
        self, *, server: Server, model: ModelCatalogEntry,
        profile: ModelRuntimeProfile, deployment: ModelDeployment
    ) -> list[DeployStep]: ...
    def health_check(self, base_url: str) -> HealthResult: ...
    def stop(self, ssh: SSHManager, deployment: ModelDeployment) -> None: ...
```

Where `DeployStep` is an opaque unit the **orchestrator** runs, each step
emitting `DeployEvent` rows + pushing SSE frames.

Rough step graph:

```
rent_server (Clore)            ← Phase 2 (already exists, add event emission)
    └── ssh_ready_wait
        └── playbook.clone + setup.sh (if profile.playbook_id)
            └── runtime.pull_image           (parses docker pull lines → bytes/sec)
                └── runtime.model_download   (parses HF CLI / vLLM startup → bytes)
                    └── runtime.start
                        └── runtime.health   (OpenAI /v1/models probe)
                            └── tunnel.open  (SSH -L → inference_base_url)
```

### 2.4 Compatibility scoring

```python
def score_offer(model: ModelCatalogEntry, offer: CloreOffer,
                profile: ModelRuntimeProfile | None,
                bench_rows: list[InferenceBenchmark]) -> dict:
    # Hard fit
    required_vram = profile.min_vram_gb or model.min_vram_gb
    fits = (offer.vram_gb * offer.gpu_count) >= required_vram
    # Verified: have we actually run this model on this GPU?
    verified = any(b.gpu_model == offer.gpu_name and b.model_name == model.name
                   for b in bench_rows)
    predicted_tps = median(b.tokens_per_second_avg for b in bench_rows
                           if b.gpu_model == offer.gpu_name
                              and b.model_name == model.name)
    # Scoring
    return {
      "fits": fits,
      "verified": verified,
      "predicted_tps": predicted_tps,
      "headroom_gb": offer.vram_gb * offer.gpu_count - required_vram,
      "pcie_ok": (offer.pcie_version or "0") >= "3.0" and (offer.pcie_width or 0) >= 8,
      "price_per_1k_tokens": price_per_day_to_per_1k(offer.price_per_day, predicted_tps),
      "recommended": fits and offer.gpu_count >= 1 and offer.pcie_width >= 8,
    }
```

This becomes a backend endpoint:
`GET /model-catalog/{id}/compatible-offers?currency=...&budget=...`

---

## 3. API surface (new + revised)

### New

```
GET  /model-catalog                       list + filter (family, params_b range, tag)
POST /model-catalog                       register a model
PATCH/DELETE /model-catalog/{id}
GET  /model-catalog/{id}                  detail incl. runtime profiles + outcome rollup
GET  /model-catalog/{id}/compatible-offers?currency=&min_vram=&order_by=score
GET  /model-catalog/{id}/outcomes         historical playbook×gpu success matrix

POST /model-runtime-profiles
PATCH/DELETE /model-runtime-profiles/{id}
GET  /model-runtime-profiles?model_catalog_id=...

POST /deploy-plans                         body: {model_catalog_id, runtime, profile_id?, offer_id | existing_server_id, budget?, currency?}
     → returns {task_run_id, deploy_plan_id, steps_preview: [...]}

GET  /task-runs/{id}/events                list structured DeployEvents
GET  /task-runs/{id}/events/stream         SSE of JSON frames (replaces raw-tail for deploys)
```

### Revised

```
POST /model-deployments                   now takes {runtime, model_catalog_id, runtime_profile_id?}
GET  /model-deployments/{id}              now exposes {inference_base_url, runtime, launch_args}
POST /playbooks                           add optional {runtime, model_catalog_id}  (legacy still allowed)
GET  /playbooks/recommended?model_catalog_id=&runtime=
                                          surfaces profile + historical success rate
GET  /benchmarks/leaderboard?model_name=  GPU leaderboard with (median tps, p95 tps, samples)
```

Deprecations: `litellm_route_name` column becomes `DEPRECATED / unused`.
Don't drop the column — just stop writing. Removal can happen in a later migration.

---

## 4. SSE event stream contract (GUI-critical)

Replace/augment `GET /task-runs/{id}/logs/stream` (raw tail) with
`GET /task-runs/{id}/events/stream` emitting:

```json
{"type":"event","seq":7,"step":"model_download","status":"running",
 "bytes_done":3221225472,"bytes_total":15032385536,
 "rate_bps":104857600,"eta_seconds":112,"progress_pct":21.4,
 "message":"Downloading model-00002-of-00004.safetensors","ts":"2026-04-18T12:35:40Z"}

{"type":"event","seq":8,"step":"runtime_start","status":"failed",
 "error_code":"CUDA_OOM","message":"torch.cuda.OutOfMemoryError: ...",
 "ts":"..."}

{"type":"done","final_status":"FAILED","task_run_id":"..."}
```

Emit path:
- Celery worker calls `emit_event(task_run_id, step, ...)` → `INSERT deploy_events` +
  Redis `PUBLISH task:{id}` (Redis db=2 already wired).
- FastAPI SSE handler subscribes → fan out JSON frames.

Log parsers per step (to derive progress without modifying upstream tooling):

| Source | Regex hook |
|---|---|
| `docker pull` | `^([a-f0-9]{12}): Downloading\s+\[=+>?\s*\]\s+(\d+\.\d+)([KMG]B)/(\d+\.\d+)([KMG]B)` |
| `huggingface-cli download` / `snapshot_download` | `(\d+)%\|[▍█ ]+\| (\d+\.?\d*)([KMG]?B)/(\d+\.?\d*)([KMG]?B) \[.*?(\d+\.\d+)([KMG]?B)/s` |
| `vllm` start | `Engine\s+process\s+started`, `Starting\s+vLLM\s+API\s+server`, `OutOfMemoryError` |
| `ollama pull` | `pulling\s+([a-f0-9]+)... (\d+)%` |

Parsers live in `backend/app/services/log_parsers/` — one function per
runtime/source, each returns either `None` (ignore) or a partial
`DeployEvent` dict.

---

## 5. Frontend (new GUI)

### Pages

- `/models` — catalog grid: family / size / architecture filter, "Deploy" CTA.
- `/models/[id]` — model detail: tabs {Overview, Compatible GPUs, Playbook History, Runtime Profiles, Benchmarks}. "Deploy this model" launches **Deploy Wizard**.
- `/deploy/[taskRunId]` — live progress view (see 5.1).
- Revise `/deployments` — show `runtime`, `inference_base_url`, a "Test inference" button that hits the OpenAI-compat URL.
- Revise `/benchmarks` — add leaderboard tab grouped by model.

### 5.1 Deploy Wizard UX

```
Step 1  Pick model            ← from /models
Step 2  Pick runtime          ← chips for vLLM / Ollama / LM Studio / TGI
                                (disabled if no compatible profile)
Step 3  Pick playbook         ← pre-filtered by (model × runtime) outcomes,
                                shows success rate + avg duration
Step 4  Pick GPU              ← compatible-offers endpoint, sorted by score
                                badges: FITS / VERIFIED / $/1k-tok / predicted tps
Step 5  Confirm + estimate    ← Σ(playbook history avg duration) + model download ETA
Step 6  Launch                ← POST /deploy-plans, redirect to /deploy/[taskRunId]
```

### 5.2 Live Progress view

```
┌ Rent server ──────────── 0:00:04 ✔ $0.42/day · CLORE-Blockchain
├ SSH ready ─────────────── 0:00:12 ✔
├ Playbook clone + setup ── 0:03:47 ✔ llama-awq-4bit @ 3a8f2c1
├ Docker pull ──────────── ██████████▒▒▒▒▒ 68%   (2.1 / 3.1 GB · 84 MB/s · ETA 12s)
├ Model download ──────── ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  3%   (0.4 / 15.0 GB · 104 MB/s · ETA 2m20s)
├ Runtime start ──────────
├ Health check ───────────
└ Tunnel ─────────────────
```

- Sticky bottom bar: cumulative elapsed, total ETA (sum of expected step
  durations minus done).
- Failures expand: `error_code`, last 30 lines of raw log, "Retry from
  step N" button (re-queues task with `skip_until=step`).
- Reduced-motion fallback: no spinners, just text status.

### 5.3 Comparison view

On `/models/[id]` → Compatible GPUs tab:

| Offer | GPU | VRAM | Predicted tokens/s | $/1k tok | PCIe | Verified |
|---|---|---|---|---|---|---|
| 55493 | RTX 4090 | 24 GB | **62 / 41 (avg/p95)** | $0.009 | 4.0 x16 | ✅ |
| 55201 | A100-40G | 40 GB | (no data) | — | 4.0 x16 | — |

---

## 6. What is revised vs. what is new

| Area | Status | Note |
|---|---|---|
| `servers` schema | keep | no changes |
| `playbooks` schema | add optional `runtime` + `model_catalog_id` | nullable — backward compatible |
| `model_deployments` schema | revise: add `runtime`, `model_catalog_id`, `runtime_profile_id`, `launch_args`, `inference_base_url` | |
| `model_catalog`, `model_runtime_profiles`, `deploy_events`, `playbook_run_outcomes` | **NEW** tables | |
| `CloreClient` | keep as-is | partial SDK bypass holds |
| `deploy_model` Celery task | **revise → orchestrator** that runs a step list from the chosen runtime adapter; emits DeployEvents | |
| `run_playbook` Celery task | keep; extend to emit DeployEvents for each step (`clone`, `setup`) | |
| SSH log tail SSE | keep endpoint; add new `events/stream` SSE for structured progress | resolves B4 |
| LiteLLM references | finish removal (ADR-007); `inference_base_url` replaces `litellm_route_name` | resolves B2 |
| Frontend `/clore` | keep as "offer-first" escape hatch | |
| Frontend deploy flow | **NEW** model-first wizard at `/models` | |
| `provision_server` task | fix B3 — only overwrite gpu_model/vram if `nvidia-smi` returned a non-empty value | |

---

## 7. Phased roadmap

Each phase is independently shippable.

### Phase A — Foundations (backend-only, no UI yet)
- Alembic migration: `model_catalog`, `model_runtime_profiles`, `deploy_events`, `playbook_run_outcomes`.
- Add columns to `model_deployments`: `runtime`, `model_catalog_id`, `runtime_profile_id`, `launch_args`, `inference_base_url`.
- CRUD endpoints for `model_catalog` + `model_runtime_profiles`.
- Seed script: 8–10 popular models (Llama 3.1 8B/70B, Qwen2.5 7B/32B, Mistral 7B, DeepSeek-R1-Distill, Gemma-2 9B).
- Fix B3 (`provision_server` preserving user values).
- Tests: pytest units for compatibility scoring + catalog CRUD.

### Phase B — Runtime adapter layer
- `RuntimeAdapter` protocol + vLLM adapter (matches current behavior).
- Ollama adapter (`ollama pull <model>` + `ollama serve`).
- LM Studio adapter (`lms` CLI or REST).
- Event emitter utility: `emit_event(task_run_id, step, **fields)` → DB + Redis pub.
- Rewrite `deploy_model` Celery task as orchestrator that drives the adapter step list.
- `inference_base_url` is set at end of `health_check` step — **closes B2**.
- Tests: adapter unit tests with a fake SSH channel; parser unit tests for docker/HF/vllm log lines.

### Phase C — Structured event streaming
- `GET /task-runs/{id}/events` (list from DB).
- `GET /task-runs/{id}/events/stream` (SSE subscribing to Redis).
- Log parsers wired into ssh command output: each line → parser → event emit.
- Tests: replay canned log files → assert event sequence.

### Phase D — Compatibility endpoint + leaderboard
- `GET /model-catalog/{id}/compatible-offers`.
- `GET /benchmarks/leaderboard`.
- `GET /playbooks/recommended`.
- Celery task `benchmarks.run` — optional: auto-populate `inference_benchmarks` at the end of a successful deploy by hammering the endpoint and recording tokens/s.

### Phase E — Frontend model-first flow
- `/models` page: catalog grid.
- `/models/[id]` detail w/ tabs.
- Deploy Wizard (`/models/[id]/deploy`) — 6 steps per §5.1.
- `/deploy/[taskRunId]` live progress w/ SSE events.
- Revise `/deployments` to show runtime + inference URL + "Test" button.
- Fix B6: playbook "Run" button.

### Phase F — Cleanup + docs
- Mark `litellm_route_name` deprecated in code + schema note (keep column one migration cycle).
- Update `ARCHITECTURE.md` + `DEVELOPMENT.md` with the new ADRs:
  - ADR-010: Model-first flow, runtimes as plugins.
  - ADR-011: Structured DeployEvent SSE replaces raw log tail for deploy progress.
  - ADR-012: `inference_base_url` as the canonical deployment endpoint (LiteLLM gone).

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| HF / Ollama / vendor progress format drift breaks parsers | MEDIUM | Parsers return `None` on miss; last-resort fallback is raw log frame → UI still shows text |
| Orchestrator becomes a huge monolithic task; retries hard | HIGH | Step-level idempotency keys + `resume_from_step` param on the task; each step writes its own DeployEvent |
| Compatibility score misleads when benchmarks are sparse | MEDIUM | Show "VERIFIED" badge only when ≥ 1 benchmark exists; otherwise mark `predicted_tps: null` |
| Multi-GPU tensor-parallel launches need per-runtime knobs | MEDIUM | `launch_args` is free-form JSON on the profile; runtime adapter translates |
| `model_deployments` migration on existing rows | LOW | new columns nullable; no backfill required |
| Ollama / LM Studio don't speak OpenAI at the same path | MEDIUM | Runtime adapter normalizes via `inference_base_url` — each adapter knows its own `/v1` prefix |
| Users don't want to pre-register every model | MEDIUM | Keep "ad-hoc model" path in `/deployments` (current flow) as fallback |

---

## 9. Open questions for operator

1. **Runtimes scope**: confirm we want all four (vLLM, Ollama, LM Studio, TGI) in the first pass, or just vLLM + Ollama?
2. **Model seed list**: curate 8–10 models, or scrape HF API on first boot?
3. **Offer refresh during wizard**: show live Clore prices on Step 4, or snapshot once per wizard session? (live = nicer UX, 1 extra API call per view)
4. **Auto-benchmark after deploy**: yes/no? If yes, what prompt + how many parallel requests?
5. **Retry/resume**: is per-step resume enough, or do we also need "keep the server, re-try only the model download"?

---

## 10. Estimated complexity

| Phase | Backend | Frontend | Tests | Migration | Notes |
|---|---|---|---|---|---|
| A | 6–8h | — | 2h | 1h | pure schema + CRUD |
| B | 10–14h | — | 4h | — | adapter layer, step orchestrator |
| C | 5–7h | — | 3h | — | SSE + parsers |
| D | 3–5h | — | 2h | — | scoring endpoints |
| E | — | 14–20h | 3h (Playwright) | — | full wizard + live progress |
| F | 2h | 2h | — | 1h | docs + cleanup |
| **Total** | **26–36h** | **16–22h** | **14h** | **2h** | ≈ 1.5–2 weeks of focused work |

---

## 11. Decision points before starting Phase A

- [ ] Approve new table shapes in §2.2
- [ ] Confirm runtime set (§9 Q1)
- [ ] Approve DeployEvent JSON contract in §4 (frontend will lock onto this)
- [ ] Approve endpoint names in §3
- [ ] Greenlight seed model list (§9 Q2)

**WAITING FOR CONFIRMATION.** Nothing in this document is implemented yet.
