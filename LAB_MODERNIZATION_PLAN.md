# Implementation Plan: Lab Page Modernization — Test Runs, Auto-Detection, Diagnostic Publication

> **Status:** Awaiting confirmation. Generated 2026-05-05 by `/plan` (planner agent).
> **Scope:** Upgrade `frontend/src/app/lab/page.tsx` and supporting backend services from a generic SSH terminal multiplexer into a first-class GPU model-testing surface with auto-detection, guided runs, outcome capture, and sanitized diagnostic publication.

---

## 1. Requirements Restatement

The user wants the Lab page to evolve from a generic SSH terminal multiplexer into a **first-class GPU model-testing surface** that captures the diverse-GPU knowledge ai-infra is supposed to be building. Concretely:

- **A. Auto-detect & summarize the machine.** When a session is opened (or activated on tab switch), the Lab should display a "Machine Card" surfacing the existing `HostCapabilitySnapshot` (driver, CUDA, GPU array, NVLink, Docker, NCT, homogeneous flag) plus a freshness indicator. Stale snapshots (>24h) get a one-click reprobe via `POST /servers/{id}/reprobe`.
- **B. Guided model-run workflow.** A "Run Model" panel where the operator picks a `Model` + `ModelQuant` from the existing knowledge base, and the platform recommends engine/container/TP defaults using the existing `feasibility.run_feasibility`, `selector.select_stack`, `parallel.recommend_parallel`, and `launchers/vllm.build_launch_cmd`. The 12-check feasibility report renders inline before launch. The launch command is either (i) injected into the active PTY for operator review, or (ii) dispatched via the existing `deployments.deploy` Celery task (which already does feasibility gate + health-poll + sets `inference_base_url`).
- **C. Successful-run capture.** A new `model_run_attempts` table tied to `server_id`, `model_id`, `quant_id`, `host_capability_snapshot_id`, the launch plan, an outcome (succeeded/failure_stage), and observed metrics (TTFT, TPS, VRAM, container_id). A "Did this work?" banner appears post-launch to capture outcome and operator notes.
- **D. Diagnostic publication.** A "Publish run report" button that exports a sanitized JSON report. Recommend a **hybrid** approach: local DB is source-of-truth; explicit publish writes to a GitHub repo (the user's `ai-infra-runs` or similar) via `gh` CLI / PyGithub. Sanitizer strips SSH credentials, hostnames, IPs, and Clore order ids. Future phases can add a public domain/import endpoint.
- **E. Models-page integration.** Each model/quant row gets a "recent runs" badge (count + success rate) and a "Try this on a server" CTA that deep-links to `/lab?model_id=…&quant_id=…&server_id=…`.
- **F. UX modernization.** Tabbed Lab with three sibling tabs: **Sessions** (current terminal multiplexer), **Test Runs** (history of `model_run_attempts` for this server), **Machine Info** (snapshot + feasibility playground). The `<main>` wrapper is already in `full` mode for `/lab` (verified — no `max-w-5xl` cap actually applies, but the inner Lab layout enforces its own constraints; B9 is mostly a non-issue for `/lab` itself but inner panels need a wider grid). NO navigation away from Lab — modals/drawers only.
- **G. Bugs to fix inline.** B5 (WebSocket DB-session lifetime), B8 (startup reconciliation for stuck-ACTIVE sessions), tab status drift vs. backend, and the reported `RangeError: Maximum call size exceeded — checkSupportDomain` (not present in current code; likely an xterm.js internals issue triggered by a specific input pattern — investigate via repro and pin xterm version).

---

## 2. Phased Implementation Plan

Ordered by dependency: backend primitives → API surface → frontend surfaces → publication → polish.

---

### Phase 1 — Backend foundations (Machine snapshot exposure + bug fixes)  *(3–4 h)*

**Goal:** Surface the existing `HostCapabilitySnapshot` to Lab without writing new logic, and clear the WebSocket / startup bugs that block trust in session state.

- **Modify** `backend/app/api/v1/endpoints/sessions.py`
  - `GET /sessions/{id}` — extend `SessionResponse` to include `latest_snapshot` (server's most recent `HostCapabilitySnapshot`, with `captured_at` + `is_stale` flag where stale = >24h).
  - `POST /sessions/{id}/refresh-snapshot` — new endpoint; runs `capture_env_snapshot` against the live PTY channel and merges into `Session.metadata_json["env"]`. Cheap, in-session, no Celery.
  - **B5 fix:** in `pty_websocket()` lines 184-303, replace the long-lived `db: Session = Depends(get_db)` injection with short-lived `SessionLocal()` blocks inside `_flush_to_db()` (open, commit, close per flush). Remove `db` from the function signature.
- **Modify** `backend/app/main.py` (or `app/lifespan.py`)
  - **B8 fix:** add a startup reconciliation task. On boot, query `SessionStatus.ACTIVE` rows; for each, check `session_store.get(...)`; if absent, mark `TERMINATED` with `terminated_at = now()` and `metadata_json.reconciled = true`. Idempotent.
- **Modify** `backend/app/schemas/sessions.py`
  - Add `MachineSnapshotPayload` (driver_version, cuda_runtime_host, gpu_count, gpus[], nvlink_topology, homogeneous, docker_present, nvidia_container_toolkit, captured_at, is_stale).
  - Extend `SessionResponse` with `latest_snapshot: MachineSnapshotPayload | None`.
- **DB migration:** none.
- **Risks:** B5 fix changes a hot path — must verify periodic flush, final flush, and disconnect path each open their own session.
- **Tests:** unit test the staleness threshold (`test_snapshot_is_stale_after_24h`); integration test `POST /sessions/{id}/refresh-snapshot` updates `metadata_json`; integration test that startup reconciler closes a stranded ACTIVE row.

---

### Phase 2 — `model_run_attempts` schema + write path  *(4–5 h)*

**Goal:** Canonical record for every launch attempt, success or failure, tied to the snapshot used to plan it.

- **Modify** `backend/app/models/entities.py` — new `ModelRunAttempt` model (see schema sketch in §3).
- **New file** `backend/alembic/versions/xxxx_add_model_run_attempts.py` — `op.create_table("model_run_attempts", ..., if_not_exists=True)` plus indexes on `(server_id, started_at desc)`, `(model_id, succeeded)`, `(quant_id, succeeded)`.
- **New file** `backend/app/schemas/model_runs.py` — Pydantic v2 schemas:
  - `ModelRunAttemptCreate` (server_id, session_id?, model_id, quant_id, engine, launch_plan_json, host_snapshot_id?)
  - `ModelRunAttemptUpdate` (succeeded, failure_stage, ttft_ms, tps, vram_used_gb, container_id, completed_at, operator_notes)
  - `ModelRunAttemptResponse`
  - `FailureStage` enum: `PLAN | IMAGE_PULL | OOM | CC_MISMATCH | CUDA_MISMATCH | TIMEOUT | HEALTH_CHECK | OTHER`
- **New file** `backend/app/api/v1/endpoints/model_runs.py`
  - `POST /api/v1/model-runs` — create (status PLANNED).
  - `PATCH /api/v1/model-runs/{id}` — update outcome / metrics / notes.
  - `GET /api/v1/model-runs?server_id=&model_id=&quant_id=&succeeded=&limit=` — list with filters.
  - `GET /api/v1/model-runs/{id}` — detail incl. resolved snapshot + plan + linked session.
  - `GET /api/v1/model-runs/aggregate?model_id=&quant_id=` — aggregated success rate + avg TPS for badging.
- **Modify** `backend/app/api/v1/api.py` — register router.
- **Modify** `backend/app/services/compat/feasibility.py` — add a `from_snapshot_and_model()` adapter that consumes a `Model` + `ModelQuant` (Phase 9 entities) and maps onto the existing `ModelVariant`-keyed `run_feasibility()`. Reason: `feasibility.py` is keyed off `ModelVariant`, but the user-facing knowledge base is `Model + ModelQuant`. Either (a) pass-through the relevant fields into a synthetic `ModelVariant` shape, or (b) refactor `run_feasibility` to accept a structural protocol. Choose (a) for minimal risk — keep `run_feasibility` untouched.
- **Risks:**
  - `feasibility.py` was marked **reference-only** in Phase 4; any call path through it needs verification. Validate the 12 checks still pass against current seed data before exposing to UI.
  - The `Model`/`ModelQuant` schema does not have `num_attention_heads` or `tp_allowed_sizes` at the **quant** level (they live on `Model` only) — confirm the adapter pulls them from the parent `Model`.
- **Tests:** CRUD round-trip, aggregate query returns expected count/avg, feasibility adapter produces matching verdict to a hand-built `ModelVariant`.

---

### Phase 3 — Recommendation API: machine + model -> launch plan  *(3–4 h)*

**Goal:** One endpoint that the Lab UI calls and gets back a full feasibility-checked, TP-planned, container-vs-venv launch command, ready to inject into the PTY or hand to `deployments.deploy`.

- **New file** `backend/app/services/lab_recommender.py`
  - `recommend_launch(server_id, model_id, quant_id, engine, db) -> LaunchRecommendation` with fields: `feasibility: FeasibilityReport`, `parallel: ParallelPlan`, `install_plan: InstallPlan`, `injectable_command: str`, `warnings: list[str]`, `force_required: bool`.
  - Internally: load latest snapshot (or fail with `requires_reprobe=true`), call adapter → feasibility → if not BLOCKED, call `selector.select_stack` (which delegates TP via `parallel.recommend_parallel`).
- **New file** `backend/app/api/v1/endpoints/lab.py`
  - `POST /api/v1/lab/recommend` — body `{server_id, model_id, quant_id, engine}`; returns `LaunchRecommendation`.
  - `POST /api/v1/lab/sessions/{session_id}/inject` — body `{command, dry_run: bool}`; writes the command into the live PTY channel via `session_store` (with newline). Marks `model_run_attempts.id` once provided. Operator still has to press Enter? No — appends `\n` so it executes immediately. Add a `dry_run: true` mode that instead returns the command for the operator to paste manually.
  - `POST /api/v1/lab/sessions/{session_id}/observe` — body `{model_run_id, container_id?}`; runs `nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits` and `curl -s {base_url}/health` over the existing PTY (via `execute_command`) to capture VRAM/health for outcome auto-fill.
- **Modify** `backend/app/api/v1/api.py` — register router.
- **Risks:**
  - `selector.select_stack` requires a `ModelVariant` not a `Model`; same adapter pattern as Phase 2.
  - `selector.py`/`launchers/vllm.py` were also marked reference-only; need a smoke-run on a real seeded `stack_matrix` to confirm `build_launch_cmd` produces a runnable string.
  - `inject` writing to a live PTY can race with operator typing. Mitigation: only allow when no input has been received for ≥500 ms (track in `session_store` `last_input_at`).
- **Tests:** recommendation against a known-good seed yields READY verdict + non-empty `injectable_command`; recommendation with snapshot >24h returns `requires_reprobe=true`.

---

### Phase 4 — Frontend: Lab restructure (tabs + Machine Card + Run Model panel)  *(5–6 h)*

**Goal:** Three sibling tabs and the recommendation surface, no nav-away.

- **Modify** `frontend/src/lib/types.ts` — add `ModelRunAttempt`, `MachineSnapshotPayload`, `LaunchRecommendation`, `FeasibilityCheck`, `FailureStage`.
- **Modify** `frontend/src/lib/api.ts` — add namespaces:
  - `api.modelRuns.{list, get, create, update, aggregate}`
  - `api.lab.{recommend, inject, observe, refreshSnapshot}`
  - `api.servers.snapshot(id)` (already exists — confirm).
- **Modify** `frontend/src/lib/queries.ts` — `useLatestSnapshot(serverId)`, `useLaunchRecommendation(input)`, `useModelRuns(filters)`, `useUpdateModelRun()`.
- **Refactor** `frontend/src/app/lab/page.tsx` — split into:
  - `frontend/src/app/lab/page.tsx` — top-level shell: tab strip + outlet (kept under 200 lines).
  - `frontend/src/components/lab/SessionsTab.tsx` — current terminal multiplexer logic (extract from existing page.tsx, including PTY parsing utilities).
  - `frontend/src/components/lab/MachineInfoTab.tsx` — Machine Card per active server with snapshot freshness, "Reprobe" button, GPU array detail, NVLink topology, NCT presence, Docker presence.
  - `frontend/src/components/lab/TestRunsTab.tsx` — list of `ModelRunAttempt` for current server, with filters (model, quant, succeeded), inline status pills (PLANNED/RUNNING/SUCCESS/FAILED), drill-down into a `RunDetailDrawer`.
  - `frontend/src/components/lab/RunModelPanel.tsx` — new bottom-anchored sliding panel (sibling to `SessionLogsModal`):
    1. Server picker (defaulted to active tab's server).
    2. Model dropdown (uses existing models KB).
    3. Quant dropdown (filtered to selected model).
    4. Engine radio (vLLM / SGLang).
    5. "Recommend" button → calls `POST /lab/recommend`.
    6. Result panel: 12 feasibility checks as PASS/FAIL/UNKNOWN chips; ParallelPlan summary; rendered launch command (read-only `<pre>`); buttons "Inject into terminal", "Copy", "Run via task" (calls `deployments.deploy`).
    7. On inject: creates `ModelRunAttempt(status=PLANNED)` and shows "Did this work?" banner with [Success] / [Failed] / [Notes…].
- **Modify** `frontend/src/components/lab/SessionsTab.tsx` (extracted) — add a "Machine summary" mini-strip above the terminal: GPU model · VRAM · driver · CUDA · NVLink/PCIe · Docker+NCT pills. Click → opens MachineInfoTab.
- **Tab status drift fix:** in `SessionsTab`, on a 30 s interval (using `useQuery` with `refetchInterval`), call `api.sessions.list({})` and reconcile each tab's status with the backend. If a tab is locally ACTIVE but backend says TERMINATED, transition the tab to TERMINATED.
- **Risks:**
  - The current page.tsx (665 lines) has live PTY parsing that must move with `SessionsTab` intact. Refactor in two commits: (1) move-only with no behavior change; (2) introduce tabs.
  - The `SessionLogsModal`'s slide-in must not collide with the new `RunModelPanel`. Use a single bottom drawer host with mode prop.
- **Tests:** Playwright happy-path: open session → switch to Machine Info tab → see snapshot fields → switch to Run Model panel → pick model → see feasibility checks render.

---

### Phase 5 — Frontend: outcome capture + Models page badges  *(3–4 h)*

**Goal:** Close the loop on every test run; surface success rates back to `/models`.

- **New** `frontend/src/components/lab/OutcomeBanner.tsx` — appears at top of the Sessions tab when an active `ModelRunAttempt` exists for the session. Buttons: "Mark success", "Mark failure" (opens dropdown of `FailureStage`), "Add notes". Uses `useUpdateModelRun()` mutation.
- **New** `frontend/src/components/lab/RunDetailDrawer.tsx` — opened from TestRunsTab; shows full `ModelRunAttempt` JSON, the snapshot used, the launch plan, and the "Publish report" button (delegates to Phase 6).
- **Modify** `frontend/src/app/models/page.tsx`
  - Add "recent runs" badge per quant row: small count + success-rate ring. Driven by a single `useQuery` to `/model-runs/aggregate?group_by=quant` (extend the API in Phase 2 to support `group_by`).
  - Add "Try on server" CTA per quant row: opens a small popover listing READY servers, click → `router.push('/lab?model_id=…&quant_id=…&server_id=…')` which the Lab page already understands via the `useEffect` that reads URL params (extend the existing handler to also auto-open the Run Model panel pre-filled).
- **Modify** `frontend/src/app/lab/page.tsx` — extend the URL-param handler to seed `RunModelPanel` state when `model_id` + `quant_id` are present.
- **Risks:**
  - Aggregate query at page load could be slow if `model_run_attempts` grows. Add an index on `(model_id, quant_id, succeeded)` (already in Phase 2 migration).
- **Tests:** clicking "Try on server" deep-links into Lab with the panel pre-filled; marking a run successful updates the badge on the Models page after invalidating queries.

---

### Phase 6 — Diagnostic publication (Hybrid: GitHub + sanitizer)  *(4–5 h)*

**Goal:** Operator clicks "Publish report" → sanitized JSON lands in a GitHub repo via PR or direct commit.

- **Modify** `backend/app/models/entities.py` — extend `PlatformSetting` keys (no schema change, just docs): `github_token`, `github_repo` (e.g. `thilak/ai-infra-runs`), `github_branch` (default `main`), `github_publish_mode` (`commit` | `pr`).
- **New file** `backend/app/services/run_report.py`
  - `build_report(run_id, db) -> dict` — assembles the report (see §3 schema).
  - `sanitize_report(report) -> dict` — strips: `server.hostname` (replace with `server-{shortuuid}`), `ssh_*` fields entirely, IPs in `nvlink_topology`/`raw_outputs`, Clore `external_server_id`, container names that include hostnames, file paths under `/root/`. Also drops `operator_notes` if it contains tokens that look like API keys (regex sweep for `sk-`, `hf_`, `ghp_`, etc.).
  - `publish_to_github(report, settings) -> {url, commit_sha}` — uses PyGithub. Path scheme: `runs/{model_family}/{model_key_slug}/{quant_name}/{gpu_model_slug}/{run_id}.json`. Commit message: `feat(run): {model_key} {quant} on {gpu_model} [{verdict}]`.
- **New** `backend/app/api/v1/endpoints/run_reports.py`
  - `GET /api/v1/run-reports/{run_id}/preview` — returns sanitized JSON (no side effects).
  - `POST /api/v1/run-reports/{run_id}/publish` — sanitize + push; stores `published_url` + `published_sha` on `ModelRunAttempt`.
- **Modify** `backend/app/models/entities.py` — add `published_url: str | None`, `published_sha: str | None` to `ModelRunAttempt`. Extend the migration in Phase 2 (or a new migration if Phase 2 already shipped).
- **New** `frontend/src/components/lab/PublishReportDialog.tsx` — shows the sanitized JSON in a syntax-highlighted `<pre>`, lets operator add a public comment, button "Publish to GitHub". On success, shows the resulting commit URL.
- **Modify** `frontend/src/app/settings/page.tsx` — add fields for `github_token`, `github_repo`, `github_publish_mode`.
- **Risks:**
  - **Sanitization gaps are CRITICAL.** Test fixture should include a deliberately poisoned report (with API key in notes, IP in topology) and assert the sanitizer scrubs all of it. Use `security-reviewer` agent before merging this phase.
  - GitHub rate limits on commits (~5000/h authenticated). Not a near-term issue for single-operator use but worth a note.
- **Tests:** unit test `sanitize_report` against a poisoned fixture; integration test `publish_to_github` against a private test repo (gated by `GITHUB_TEST_REPO` env).

---

### Phase 7 — Polish + RangeError investigation  *(2–3 h)*

**Goal:** Final UX polish and the reported runtime bug.

- **Investigate** `RangeError: Maximum call size exceeded — checkSupportDomain`
  - Not in `frontend/src/`. Likely from `xterm` or `xterm-addon-fit` internals. Reproduce by attaching a test session and pasting a known-problematic byte sequence (suspect: heavy ANSI / very long single-line OSC). Mitigations to try in order:
    1. Wrap the `terminal.write(bytes)` call in `PtyTerminal.tsx:75` with a chunker that splits writes >32KB into multiple `write` calls.
    2. Pin or upgrade `xterm` (`package.json`) — the `allowProposedApi: true` flag can trigger recursive support-domain checks in older versions; bump to `@xterm/xterm` (the new scope) which fixed several stack-overflow cases.
- **Modify** `frontend/src/components/PtyTerminal.tsx` — implement chunked `write` and add an error boundary so a write failure doesn't kill the tab.
- **Modify** `frontend/src/components/layouts/main-content.tsx` — already correct for `/lab` (uses `full` mode). Verify that internal Lab grid uses the full width; remove any `max-w-*` from inner Lab components.
- **Add** Playwright visual regression for Lab tabs at 1440 / 1920 widths.
- **Risks:** xterm upgrade could break theming; isolate to a dedicated commit.
- **Tests:** existing Playwright Lab smoke + new wide-viewport screenshots.

---

## 3. Schema Sketches

### `model_run_attempts` table

```python
class ModelRunAttempt(Base):
    __tablename__ = "model_run_attempts"

    id: UUID (pk, default=uuid4)
    server_id: FK("servers.id", ondelete="CASCADE", indexed)
    session_id: FK("sessions.id", ondelete="SET NULL", nullable=True, indexed)
    model_id: FK("models.id", ondelete="RESTRICT", indexed)
    quant_id: FK("model_quants.id", ondelete="RESTRICT", indexed)
    host_snapshot_id: FK("host_capability_snapshots.id", ondelete="SET NULL", nullable=True)
    task_run_id: FK("task_runs.id", ondelete="SET NULL", nullable=True)   # if launched via Celery

    engine: Enum(EngineKind)                # VLLM / SGLANG / OLLAMA
    engine_version: str | None               # e.g. "0.6.3"
    mode: str                                # "container" | "venv"
    container_image: str | None
    container_id: str | None                 # docker container id once running
    launch_command: Text                     # the actual command injected/run
    launch_plan_json: JSON                   # full InstallPlan + ParallelPlan + feasibility checks
    feasibility_verdict: str                 # READY / BLOCKED / UNKNOWN
    forced: bool = False                     # operator overrode a BLOCKED verdict

    status: Enum(RunStatus)                  # PLANNED / RUNNING / SUCCESS / FAILED / ABANDONED
    succeeded: bool | None                   # null until terminal state
    failure_stage: Enum(FailureStage) | None # PLAN/IMAGE_PULL/OOM/CC_MISMATCH/CUDA_MISMATCH/TIMEOUT/HEALTH_CHECK/OTHER
    failure_message: Text | None

    ttft_ms: float | None
    tps_steady: float | None
    vram_used_gb: float | None
    health_check_url: str | None             # e.g. http://host:8000/v1/models
    health_check_ok: bool | None

    operator_notes: Text | None
    started_at: DateTime
    completed_at: DateTime | None
    duration_seconds: int | None

    published_url: str | None                # GitHub commit URL after publish
    published_sha: str | None
    published_at: DateTime | None

    created_at, updated_at

    __table_args__ = (
        Index("ix_runs_server_started", "server_id", "started_at"),
        Index("ix_runs_model_quant_succeeded", "model_id", "quant_id", "succeeded"),
    )
```

### Published run report JSON shape

Stored at `runs/{family}/{model_slug}/{quant}/{gpu_slug}/{run_id}.json` in the GitHub repo. Top-level schema versioned for future readers/importers.

```json
{
  "schema": "ai-infra/run-report/v1",
  "run_id": "8b1f…",
  "published_at": "2026-05-05T14:30:00Z",
  "platform": {
    "version": "git-sha:b6bf672",
    "publisher": "ai-infra"
  },
  "model": {
    "key": "meta-llama/Llama-3.1-8B-Instruct",
    "family": "llama3",
    "param_count_b": 8.0,
    "quant_name": "AWQ-4bit",
    "bits_per_weight": 4.5,
    "hf_repo": "casperhansen/llama-3-8b-instruct-awq"
  },
  "host": {
    "gpu_model": "RTX 4090",
    "gpu_count": 1,
    "vram_gb_total": 24,
    "compute_capability": "8.9",
    "driver_version": "550.54.15",
    "cuda_runtime_host": "12.4",
    "nvlink": false,
    "interconnect": "single-GPU",
    "homogeneous": true,
    "docker_present": true,
    "nvidia_container_toolkit": true,
    "snapshot_captured_at": "2026-05-05T13:55:00Z"
  },
  "stack": {
    "engine": "vllm",
    "engine_version": "0.6.3",
    "mode": "container",
    "container_image": "vllm/vllm-openai:v0.6.3",
    "torch_version": "2.4.0",
    "tp_size": 1,
    "max_model_len": 8192,
    "extra_flags": ["--quantization awq", "--trust-remote-code"]
  },
  "feasibility": {
    "verdict": "READY",
    "mode": "verified",
    "checks": [
      {"id": "gpu_arch_known", "status": "PASS", "reason": "Matched profile 'rtx_4090'"},
      "..."
    ]
  },
  "outcome": {
    "succeeded": true,
    "failure_stage": null,
    "ttft_ms": 142.0,
    "tps_steady": 78.4,
    "vram_used_gb": 7.1,
    "health_check_ok": true,
    "duration_seconds": 47
  },
  "notes": "Stable for 30 min at concurrency=4. No OOM."
}
```

Sanitizer guarantees: no hostname, no IP address, no SSH credential, no Clore order id, no API key, no absolute path under `/root/` or `/home/{user}/`.

---

## 4. Decision Required From The User

**Where should published run reports live?**

| Option | Pros | Cons |
|---|---|---|
| (1) GitHub-only data store | Free, versioned, diffable, easy to read/share | Rate limits, slow to query, hard to dashboard |
| (2) Self-hosted backend at a domain | Queryable, fast, full control | Hosting + domain cost, ops burden, single point of failure |
| (3) **Hybrid (recommended)** | Local Postgres = source of truth (already paid for); GitHub = curated public publication path; Future `/run-reports/import` endpoint can pull community reports back | Two storage backends to reason about, but each has a clear single role |

**Recommendation: option 3.** Reasons:
- Local Postgres already holds every run via `model_run_attempts`. Querying, aggregation, and Models-page badges work entirely off local data — no GitHub round-trip.
- GitHub is used **only** for the explicit "Publish" button, when the operator has reviewed the sanitized report and wants to share it. This makes secrets-leakage near-impossible (operator-gated).
- A future Phase 8 could add `POST /run-reports/import` to pull peer-published reports back into the local KB to seed `gpu_profiles` / `stack_matrix` / model success-rate priors.
- No domain/hosting needed today. If the dataset grows enough to need queries across operators, that's the trigger to introduce option 2 — but only then.

**Open question for the user to confirm before Phase 6:**
- Repo name + visibility (suggest a private repo first; flip to public when sanitization is battle-tested).
- Publish via direct commit on `main`, or via PR into a `runs/` branch (PR adds review surface, costs more clicks).

---

## 5. Out Of Scope (deferred)

- Reviving the deploy / infer / playbook execution paths beyond what `deployments.deploy` already provides. This plan **uses** those paths but does not extend them.
- A `/run-reports/import` endpoint to pull peer-published reports back into the local KB (future Phase 8).
- B4 (SSE byte/char offset) — independent and not Lab-blocking; leave to its own follow-up.
- Multi-model concurrent launches on a single server (one active `ModelRunAttempt` per session at a time).
- Auto-benchmark trigger (running `benchmarks.run` automatically on success). Could be a one-line wire-up after Phase 5 but adds runtime per launch — leave opt-in.
- Cost tracking per run (Clore $/hour × duration).
- Multi-provider adapter beyond Clore.

---

## 6. Risks

- **CRITICAL — Sanitization correctness.** Phase 6 must not leak SSH keys, hostnames, or Clore IDs to a public repo. Use `security-reviewer` agent on `sanitize_report` before merging. Add a fixture-based negative test.
- **HIGH — `feasibility.py` / `selector.py` / `parallel.py` / `launchers/vllm.py` are reference-only.** They were built in Phase 4–6 but never exercised end-to-end. Smoke-test each one against the seeded `gpu_profiles` and `stack_matrix` rows during Phase 2 before exposing them to the UI. If any returns broken outputs, expect a 1–2 h fix budget.
- **HIGH — Schema mismatch between `Model`/`ModelQuant` (Phase 9) and `ModelVariant` (Phase 1).** The compat services key off `ModelVariant`. Adapter approach (synthesize a `ModelVariant`-shaped object from `Model + ModelQuant`) keeps the blast radius small. Long-term, a future phase should unify them.
- **MEDIUM — PTY injection race.** Writing to a live PTY can collide with operator typing. Mitigation: enforce 500 ms idle gate before injecting; fall back to "copy and paste manually" if not idle.
- **MEDIUM — HF rate limits** if the auto-parser fires during recommendation (it shouldn't — recommendation reads only local DB rows, not HF). Confirm `lab_recommender` makes no outbound HTTP.
- **MEDIUM — GitHub rate limits** (5000 req/h authenticated) — non-issue for single operator but flag in docs.
- **MEDIUM — RangeError repro.** No source in current codebase; root cause may be xterm-internal. If the chunked-write mitigation does not fix it, the fallback is the xterm version bump, which has its own risk surface.
- **LOW — Tab status reconciliation** at 30 s could thrash if many tabs are open. Cap reconciliation to the active tab + dirty tabs.
- **LOW — Migration ordering.** Phase 2 migration adds `model_run_attempts`; Phase 6 migration adds `published_*` columns. Simpler to fold both into Phase 2's migration if Phase 6 is in the same delivery window.

---

## 7. Estimated Complexity

| Phase | Hours |
|---|---|
| 1. Backend foundations + B5/B8 fixes | 3–4 |
| 2. `model_run_attempts` schema + write path | 4–5 |
| 3. Recommendation API | 3–4 |
| 4. Lab restructure + Run Model panel | 5–6 |
| 5. Outcome capture + Models page badges | 3–4 |
| 6. Diagnostic publication (GitHub + sanitizer) | 4–5 |
| 7. Polish + RangeError | 2–3 |
| **Total** | **24–31 hours** |

Each phase is independently mergeable and produces visible value: Phase 1 already gives the operator a Machine Card + clean session lifecycle; Phase 4 already gives the guided run UX even before publication is wired.

---

## 8. Relevant Files (existing — for the implementing agent)

- `frontend/src/app/lab/page.tsx`
- `frontend/src/components/SessionLogsModal.tsx`
- `frontend/src/components/PtyTerminal.tsx`
- `frontend/src/components/layouts/main-content.tsx`
- `frontend/src/app/models/page.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/queries.ts`
- `backend/app/api/v1/endpoints/sessions.py`
- `backend/app/api/v1/endpoints/model_deployments.py`
- `backend/app/services/session_runner.py`
- `backend/app/services/compat/probe.py`
- `backend/app/services/compat/feasibility.py`
- `backend/app/services/compat/selector.py`
- `backend/app/services/compat/parallel.py`
- `backend/app/services/compat/launchers/vllm.py`
- `backend/app/models/entities.py`
- `backend/app/workers/tasks.py`
- `ROADMAP.md`
- `DEVELOPMENT.md`
- `CLAUDE.md`

---

## 9. Pickup Notes For The Implementing Agent

- **Start with Phase 1.** It is independent, ships visible value (Machine Card + clean session lifecycle), and unblocks all later phases.
- **Before Phase 2, smoke-test `feasibility.py` / `selector.py` / `parallel.py` / `launchers/vllm.py`.** They are flagged reference-only; do not assume they work. Run a minimal repro against a seeded `gpu_profiles` + `stack_matrix` row and confirm verdict + launch command before exposing to the UI.
- **The user has not yet confirmed the GitHub vs domain decision.** If you reach Phase 6 and the user has not chosen, default to private GitHub repo + PR mode. Do not push to a public repo without explicit consent.
- **Sanitizer (Phase 6) must be reviewed by `security-reviewer` agent before merge.** Add a poisoned-fixture test (API key in notes, IP in topology, hostname in container name) and assert all are scrubbed.
- **Do NOT navigate away from the Lab page.** Per saved feedback memory: use modals/drawers only.
- **PTY injection has a race.** Enforce a 500 ms idle gate (`session_store.last_input_at`) before allowing inject; fall back to copy-paste otherwise.
- **B5 / B8 are inline with Phase 1.** Do not defer them — they corrupt session state and undermine the whole modernization.

**Status: WAITING FOR CONFIRMATION** — do not start implementation until user explicitly approves the plan or modifies it.
