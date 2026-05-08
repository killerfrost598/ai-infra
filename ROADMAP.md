# AI-Infra Roadmap

## Status

| Phase | State |
|---|---|
| Phase 1 — Compat data + `/feasibility` | ✅ shipped |
| Phase 2 — Inference benchmarks + leaderboard | ✅ shipped |
| Phase 3 — `nvidia-smi` probe + B3 fix | ✅ shipped |
| Phase 4 — `select_stack()` + container-first deploy gate | ✅ shipped, now used by Lab recommendations for vLLM |
| Phase 5 — Lab → Playbook / model-run pipeline | ✅ shipped, operator-assisted |
| Phase 6 — Compat drift + multi-GPU TP | ✅ shipped |
| Phase 7 — Doc cleanup | ✅ shipped |
| Phase 8 — `/find` feasibility pagination | ✅ shipped |
| Phase 10 — Reusable `ServerInfoModal` | ✅ shipped |
| Phase 9 — Model knowledge base + CRUD + HF auto-import | ✅ shipped |
| Phase 11 — Lab operator-assisted deployment planning | ✅ shipped first slice |

> **Current scoping note (2026-05-08):** The platform is targeting **operator-assisted deployment first**. Lab is now the technical/tester surface for visible PTY execution, AI-assisted guidance, and deployment plans. Easy Deploy and plugin marketplace work should build on successful `model_run_attempts` and published working-system reports before becoming one-click.

---

## Completed phases (1–6)

### Phase 1 — Compat reference data + `/feasibility`

Added `gpu_profiles`, `stack_matrix`, `model_variants` tables with Alembic migrations and a startup seeder. `POST /api/v1/feasibility` runs a 12-check checklist in predicted mode (driver, VRAM, CC/quant, FP8, arch, TP sizes, stack). Frontend `/find` cards show per-check PASS/FAIL/UNKNOWN chips.

### Phase 2 — Inference benchmarks + leaderboard

Extended `inference_benchmarks` with TTFT, prefill TPS, concurrency curve, knee. `benchmark_tasks.run` Celery task drives warm-up → TTFT → throughput → concurrency sweep. `GET /benchmarks/leaderboard` aggregates. Server detail page has a Performance tab with SVG concurrency chart. `/find` cards show verified throughput chip.

### Phase 3 — `nvidia-smi` probe + B3 fix

`probe.py` runs `nvidia-smi`, topology, nvcc, Docker checks over SSH — each wrapped in try/except. `HostCapabilitySnapshot` stores per-GPU detail, NVLink topology, homogeneity, Docker/nvidia-ct status. `provision_server` rewritten: snapshot created on every provision, B3 fixed (gpu_model/vram_gb only updated when probe returns values). `POST /servers/{id}/reprobe` + `GET /servers/{id}/snapshot` added. Feasibility upgrades from predicted → verified when snapshot is < 24h old.

### Phase 4 — `select_stack()` + container-first deploy gate

`selector.py`: picks highest-priority active `stack_matrix` row for the host CC + engine, chooses container vs venv mode. `launchers/vllm.py`: builds `docker run` or `nohup vllm` command. `deploy_model` task: feasibility gate → `select_stack` → docker pull / pip install → launch → 120s health-poll → sets `inference_base_url` (closes B2). `POST /model-deployments` returns 422 on FAIL feasibility; `?force=true` overrides with audit log.

### Phase 5 — Lab → Playbook / model-run pipeline

Env snapshot captured at session open (nvidia-smi, nvcc, docker) and stored in `Session.metadata_json`. Per-command ★ keep toggle in `SessionLogsModal`; promote-to-playbook filters by kept indices before Haiku call, writes `setup.sh` + `playbook.yml` to local git repo, creates real `Playbook` row tagged with `model_variant_id` + `engine` + `source_session_id`. `PlaybookRunOutcome` table tracks success/failure per run. `GET /playbooks/recommended` ranks by success rate. `/find` cards show verified-playbook chip when ≥ 3 outcomes exist. B6 fixed: Run button added to `/playbooks` page.

### Phase 6 — Compat drift + multi-GPU TP

`parallel.py`: `recommend_parallel(variant, snapshot)` → `ParallelPlan` — blocks heterogeneous GPU hosts, prefers highest TP on NVLink, lowest TP > 1 on PCIe. `selector.py` delegates tp_size to recommender for multi-GPU hosts. `feasibility.py` adds `tp_plan_valid` check (#11). `compat.scrape_versions` Celery beat task (weekly, Mondays 02:00 UTC) hits PyPI for vLLM/SGLang, stores candidates in `TaskRun.metadata_json` — never auto-inserts. `/compat/scrape-runs` + `/compat/candidates/approve` endpoints let operator promote a candidate to a new `stack_matrix` row. `/find` multi-GPU cards show TP chip (sky = OK, red = blocked). `/compat/candidates` page lists scrape history with inline approve form.

### Phase 11 — Lab operator-assisted deployment planning

Lab now restores workspace state across navigation, starts from available server cards, captures host snapshots automatically on session start, and exposes Run Model as a side panel. Model selection comes from the model knowledge base; quant selection reuses the same mini `QuantChip` view as `/models`.

`/lab/recommend` remains deterministic and DB/rules based. `/lab/deployments/plan` returns explicit vLLM deployment steps covering preflight, runtime setup, model download, launch, health check, smoke test, and evidence capture. `/lab/assist` optionally calls Anthropic or OpenAI using platform context for operator guidance. Plan/AI command Run buttons inject into the visible PTY so output and prompts are live and interruptible.

The first slice is still operator-assisted, not unattended. First-class step execution, streaming events, resumability, and Easy Deploy remain future work.

---

## Historical plan notes (7–10)

These notes are retained as implementation history. They are not the current next-work queue.

### Phase 7 — Doc cleanup *(1–2 h, no risk)*

**Goal:** collapse stale documentation into one canonical `DEVELOPMENT.md`.

- Delete `MODEL_FIRST_ARCHITECTURE.md` (superseded — phases 1–6 implemented its functional equivalent under different naming).
- Merge live content from `ARCHITECTURE.md` (system topology, current DB tables, Celery task list, public API surface) into `DEVELOPMENT.md` under a new "System architecture" heading; delete `ARCHITECTURE.md`.
- Trim `DEVELOPMENT.md`:
  - Drop the "Session 2026-04-19 — UI cleanup + LiteLLM removal", "Frontend rewrite", "Performance" diary blocks (now covered by git log + ROADMAP).
  - Collapse ADRs (001–011) into one ADR table.
  - Verify B2 and B6 are fixed in code; remove from bug list if so.
- Commit `ROADMAP.md` (currently untracked).
- Update `README.md` link from `ARCHITECTURE.md` → `DEVELOPMENT.md`.
- Update `CLAUDE.md` "Key files" section to point at the single doc.

**Net change:** ~1100 lines stale .md → ~400 lines live docs.

### Phase 8 — `/find` feasibility pagination *(2–3 h)*

**Problem:** `GpuFinderResult` fires a per-row `useQuery` against `/feasibility` for every visible offer. With ~900 offers this is a stampede on the backend.

**Fix (8a — frontend pagination only):**
- `GpuFinderPanel`: render only the first **N=20** ranked offers; "Load more" button at the bottom.
- Wrap each `GpuFinderResult` in an IntersectionObserver; the `useQuery` for `/feasibility` is `enabled` only when the card is in the viewport.
- Same treatment for the unfit/OOM section (already collapsed by default — keep, but add the same gating).
- `staleTime: 60_000` retained so paging back-and-forth doesn't re-fire requests.

**Out of scope for now (8b deferred):** server-side `POST /feasibility/batch` — revisit if 8a doesn't go far enough.

### Phase 10 — Reusable `ServerInfoModal` *(4–6 h)*

**Goal:** a single modal that shows every Clore field for an offer / rental / rented server. Used from `/find`, `/clore`, and `/servers/[id]`.

- New `<ServerInfoModal source={offer | rental | server} open onOpenChange/>` (shadcn `Dialog`).
- Fields surfaced (per `dev/clore/clore_findings.md`):
  - **Identity:** server id, hostname, gpu_model, gpu_count, gpu_array (mixed-rig detail), country/region, datacenter, motherboard, score
  - **GPU:** vram total, cuda_version, oc_value, NVLink topology (when snapshot exists)
  - **Host:** cpu, ssd disk (parsed from raw string), ram_gb, pcie_rev, pcie_width, net up/down
  - **Pricing:** price USD/CLORE/BTC (on-demand + spot), allowed_coins, mrl (hours), allowed_running_time, prepay_options
  - **Snapshot data (when rented):** driver_version, cuda_runtime_host, docker_present, nvidia_container_toolkit, captured_at
- Backend: extend `CloreOffer` schema in `clore.py` to expose missing fields (`gpu_array`, `country`, `datacenter`, `motherboard`, `score`, `oc_value`, `mrl`, `allowed_running_time`, `prepay_options`). Most are already in the SDK response — just thread them through.
- Trigger sources:
  1. "Details" button on `OfferCard` (clore page Marketplace tab + GPU Groups tab).
  2. "Details" button on `GpuFinderResult` (find page).
  3. New "Hardware" tab on `/servers/[id]` (rented servers detail page).
- Reuse copy: each row shows label + value + tooltip with the raw field name (helps debugging).

### Phase 9 — Model knowledge base + CRUD + HF auto-import *(8–12 h backend, 6–8 h frontend)*

**Goal:** replace the static `frontend/public/data/models.json` with a queryable, editable database that operators can curate. Add a HuggingFace auto-parser to seed entries from a single URL.

#### 9.1 Schema — new tables (independent of existing `model_variants`)

> **Why a fresh table set:** existing `model_variants` is referenced by `playbooks`, `model_deployments`, `inference_benchmarks`, and `playbook_run_outcomes` — but those code paths are reference-only right now. Keeping `model_variants` untouched avoids any FK migration; the new `models` + `model_quants` tables become the canonical knowledge base. We can later wire the deploy stack to read from `model_quants` instead of `model_variants` (or merge them) once execution paths are revived.

```python
# backend/app/models/entities.py — additions

class Model(Base):
    __tablename__ = "models"
    id: UUID (pk)
    model_key: str (unique, indexed)         # "meta-llama/Llama-3.1-8B-Instruct"
    display_name: str
    family: str (indexed)                     # "llama3", "qwen2.5", "mistral", "deepseek"
    param_count_b: float
    hf_url: str | None                        # https://huggingface.co/{repo_id}
    hf_repo: str | None                       # repo_id for API calls
    max_context_k: int
    tags: JSON                                # ["chat", "code", ...]
    use_case: str
    is_reasoning: bool = False
    supports_tools: bool = False
    is_code_model: bool = False
    is_moe: bool = False
    moe_active_params_b: float | None
    num_attention_heads: int | None
    tp_allowed_sizes: JSON | None             # [1, 2, 4, 8]
    kv_cache: JSON                            # {num_layers, num_kv_heads, head_dim, kv_dtype_default}
    recommended_engines: JSON                 # [{engine, score, min_vram_gb}]
    recommended_flags: JSON                   # {vllm: ["--enable-chunked-prefill"], ...}
    source: str = "manual"                    # "manual" | "hf_auto" | "imported"
    hf_synced_at: datetime | None
    is_archived: bool = False
    created_at, updated_at

class ModelQuant(Base):
    __tablename__ = "model_quants"
    id: UUID (pk)
    model_id: FK(Model, ondelete="CASCADE", indexed)
    name: str                                 # "FP16", "AWQ-4bit", "GPTQ-4bit", "GGUF-Q4_K_M"
    hf_repo: str | None                       # specific repo for this quant (may differ from parent)
    hf_url: str | None
    bits_per_weight: float
    disk_size_gb: float
    vram_weights_gb: float
    quality_score: float                      # 0..1, operator-curated
    cc_min: str | None                        # "6.0", "7.5", "8.0"
    arch_vllm: bool = True
    arch_sglang: bool = True
    notes: str | None
    created_at, updated_at
    __table_args__ = (UniqueConstraint("model_id", "name"),)
```

Alembic migration creates both tables. No FK changes anywhere else.

#### 9.2 Data migration — seed from `models.json`

One-time Alembic data migration:
1. Read `frontend/public/data/models.json`.
2. Insert one `Model` row per entry, one `ModelQuant` row per `quants[]` element.
3. Set `source = "imported"`.
4. Don't delete `models.json` yet — keep until the new endpoints are wired and the frontend has switched.

#### 9.3 API surface

```
GET    /api/v1/models                       list (filter: family, tag, search, archived)
POST   /api/v1/models                       create
GET    /api/v1/models/{id}                  detail (incl. quants)
PATCH  /api/v1/models/{id}                  update
DELETE /api/v1/models/{id}                  delete (cascades to quants)

GET    /api/v1/models/{id}/quants           list
POST   /api/v1/models/{id}/quants           add
PATCH  /api/v1/models/{id}/quants/{qid}     update
DELETE /api/v1/models/{id}/quants/{qid}     delete

GET    /api/v1/models/families              distinct families list (for tree view)

POST   /api/v1/models/import-from-hf        body: {hf_url}
                                            returns: parsed Model + suggested quants (no save)
POST   /api/v1/models/{id}/sync-from-hf     re-fetch + merge fields; touches `hf_synced_at`
```

All endpoints follow the existing FastAPI pattern (`Depends(get_db)`, Pydantic v2 schemas in `app/schemas/models.py`).

#### 9.4 HuggingFace auto-parser

`backend/app/services/hf_parser.py`:

| Source | What we extract |
|---|---|
| `GET https://huggingface.co/api/models/{repo_id}` | `library_name`, `tags`, `pipeline_tag`, `downloads`, `likes`, `siblings[]` (file list), `cardData` (license, base_model, etc.) |
| `GET https://huggingface.co/{repo_id}/raw/main/config.json` | `model_type` → architecture, `num_hidden_layers`, `num_attention_heads`, `num_key_value_heads`, `hidden_size` (→ head_dim = hidden_size/num_attention_heads when `head_dim` absent), `max_position_embeddings`, `torch_dtype` (→ kv_dtype_default), `vocab_size` |
| `GET https://huggingface.co/{repo_id}/raw/main/README.md` (best-effort) | YAML frontmatter `tags:`, `license:` |
| `siblings[]` filename heuristics | detect available quants in same repo (e.g. `*-AWQ`, `*-GPTQ`, `*.gguf`); flag related repos by org/`-AWQ` suffix convention |

Returns a `ParsedModel` dict with confidence flags per field. Frontend shows the parsed values pre-filled in the create dialog; operator confirms or edits before save.

**Rate limiting:** unauthenticated HF API allows ~1k requests/h. Cache config.json for 24h in Redis (key `hf:config:{repo_id}`). Optional `HF_TOKEN` setting to raise the limit.

**Quant inference is best-effort.** README badges (`AWQ`, `GPTQ`, `4bit`) and filename suffixes are noisy. The auto-parser proposes; the operator confirms.

#### 9.5 Frontend `/models` page

Tree-style layout:

```
┌─ Family: llama3 ──────────────────────────────── [+ Add model]
│  ├─ Llama-3.1-8B-Instruct                          (8.0 B params, 128k ctx)  [hf↗] [edit] [delete]
│  │   ├─ FP16        bpw=16  disk=15 GB   vram=15 GB  q=1.00  [hf↗] [edit] [delete]
│  │   ├─ AWQ-4bit    bpw=4.5 disk=5.7 GB  vram=5.4 GB q=0.92  [hf↗] [edit] [delete]
│  │   └─ GPTQ-4bit   bpw=4.5 disk=5.7 GB  vram=5.4 GB q=0.90  [hf↗] [edit] [delete]
│  ├─ Llama-3.1-70B-Instruct
│  └─ + Add quant…
├─ Family: qwen2.5
│  └─ ...
└─ Family: mistral
```

- Top bar: search box + family dropdown + tag filter + "Add model" / "Import from HuggingFace" buttons.
- "Import from HuggingFace" → dialog: paste URL → calls `/import-from-hf` → previews parsed fields → operator can edit → save.
- Click a model → edit dialog with two tabs:
  - **Model fields tab:** name, family, params, hf_url, max_context_k, tags (multi-select), use_case, flags (is_reasoning, etc.), kv_cache, recommended_engines, recommended_flags.
  - **Quants tab:** list of quants with inline add/edit/delete.
- Click a quant → quant edit dialog (subset of the model dialog).
- HF link badges open in a new tab.

Frontend file changes:
- New `frontend/src/app/models/page.tsx` (the tree view).
- New `frontend/src/components/models/{ModelTree,ModelEditDialog,QuantEditDialog,HfImportDialog}.tsx`.
- New `frontend/src/lib/api.ts` namespace `models` (CRUD + import).
- New `frontend/src/lib/queries.ts` hooks (`useModels`, `useModel`, `useImportFromHf`, mutations).
- Update `frontend/src/lib/models/catalogue.ts`: switch `loadCatalogue()` from `fetch("/data/models.json")` to `api.models.list({ include: "quants" })`. Keep the existing zod `Model` shape so finder math (`gpu-finder.ts`, `vram.ts`) keeps working — map DB rows to that shape.
- Sidebar: add "Models" entry.

#### 9.6 Cleanup (last step of phase 9)

- Delete `frontend/public/data/models.json` once `useCatalogue()` reads from the API in dev + prod.
- Delete the static-file fallback in `catalogue.ts`.

---

## Out of scope (revisit later)

- Fully unattended one-click deployment.
- First-class deployment step executor with SSE events, cancellation, retries, and persisted step status.
- Server-side feasibility batch endpoint (8b).
- Auto-benchmark trigger after deploy.
- B4 (SSE byte/char offset) and B5 (WebSocket PTY DB session) fixes.
- Multi-provider adapter system beyond Clore.
- Cost tracking and budget controls.

---

## Decision log

- 2026-05-04: Deploy/infer/playbooks de-prioritized; focus shifts to GPU + model knowledge base.
- 2026-05-04: Doc consolidation — single `DEVELOPMENT.md`; `MODEL_FIRST_ARCHITECTURE.md` deleted; `ARCHITECTURE.md` merged in.
- 2026-05-04: Models knowledge base = new `models` + `model_quants` tables (independent of `model_variants`); HF auto-parser; tree-style `/models` page.
- 2026-05-04: `/find` feasibility load = frontend pagination only (8a); server-side batch (8b) deferred.
