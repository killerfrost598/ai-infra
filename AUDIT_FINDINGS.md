# Inferix — Strategic Audit & Action Plan

> **Status:** Handoff doc for the implementing agent (Sonnet). Generated 2026-05-06 by Opus 4.7 audit of raw code, docs, schema, git history, and Opus compat-stack framework.
> **Local-only:** Do not commit. Per saved feedback memory: never commit `*_PLAN.md` or .md files / planning artifacts to git.

---

## 0. TL;DR — the one bug that blocks everything

**Feasibility is silently broken for every HF-seeded model.**

`backend/app/services/hf_seeder.py` writes to `models` + `model_quants` (the live KB).
`backend/app/services/compat/feasibility.py:136` and `backend/app/services/compat/selector.py` query `model_variants`.
`hf_seeder` never writes `model_variants`. Result: `/feasibility` returns UNKNOWN/422 for everything seeded after Phase 9.

This invalidates:
- The `/find` cards' feasibility chips for HF-seeded models
- The Opus checklist (items c/d/e)
- The premise of LAB_MODERNIZATION_PLAN Phases 2–5

**Fix first** before any further feature work. Two viable approaches:
- (a) Bridge: extend `seed_one_repo()` to also upsert a `ModelVariant` row per quant. Lower risk; keeps reference-only code paths runnable.
- (b) Refactor: migrate `feasibility.py` / `selector.py` / playbooks / deployments to read `ModelQuant`. Cleaner long-term; bigger blast radius.

Recommended: **(a) for this PR, (b) as a follow-up** once Lab plan is in flight.

---

## 1. Code quality — DRY / KISS

### 1.1 Backend (Python)

#### Duplications worth a 1–2h cleanup pass

| Pattern | Sites | Action |
|---|---|---|
| `_get_redis()` identical body | `backend/app/api/v1/endpoints/clore.py:26`, `feasibility.py:52`, `gpu_profiles.py:33`, `services/hf_seeder.py:127` | Single `app/core/cache.py::get_redis_client()` |
| `session = db.query(Session).first(); 404; 409 if terminated` | `sessions.py:146,165,190,229,318,376,394,433,460` | Two helpers: `_get_session_or_404`, `_get_active_or_409` |
| Server lookup boilerplate | `clore.py` + `servers.py` | Same helper pattern |

#### KISS — `services/hf_seeder.py` is 794 lines doing four jobs

Split into:

- `hf_constants.py` — lookup tables (lines 36–122): `STANDARD_AUTHORS`, `KNOWN_COMMUNITY_AUTHORS`, `GGUF_BPW`, `_TORCH_DTYPE_MAP`, `_FMT_QUALITY`, `_GGUF_BPW_QUALITY`
- `hf_fetcher.py` — Redis cache + `HfApi` calls (lines 127–277)
- `hf_parsers.py` — pure `_parse_*` / `_detect_*` / `_build_kv_cache` (lines 280–552; trivially testable once isolated)
- `hf_seeder.py` — keeps `seed_one_repo` + DB upsert (~240 lines)

The parsing functions are pure (no I/O, no DB) — they unit-test in isolation once split.

#### Other backend issues

- **`convert_to_playbook` (sessions.py:442–613, 170 lines)** — Phase-5 reference-only; lazy mid-function imports; mutable default arg `body: dict = {}`; references orphaned `ModelVariant`. Extract to its own router or delete until wired.
- **`ProviderAccount` SELECT-or-INSERT on every rental** (`clore.py:298–305`) — vestigial multi-provider stub for a single-operator app. Hardcode null FK or drop the table.
- **`feasibility.py` module-level `_profile_cache` with `threading.Lock`** (lines 16–43) — fork-unsafe under Gunicorn pre-fork. Replace with `functools.lru_cache(maxsize=1)`.
- **`pty_websocket()` holds DB session for terminal lifetime** (`sessions.py:184–303`, bug B5) — replace `Depends(get_db)` injection with `SessionLocal()` blocks inside `_flush_to_db()`.
- **`/debug-sdk` endpoint at `clore.py:33`** — temporary, no auth guard, in production routing. Tag or remove.

### 1.2 Frontend (TypeScript)

`tsc --noEmit` is clean. No `any`. Real issues:

| # | Issue | Site |
|---|---|---|
| 1 | Inline spinner JSX duplicated 10× across 6 files; one `Spinner` exists in `clore/page.tsx:656` (not exported), one `LoadingState` in `page-states.tsx:26` (unused by callers) | `servers/[id]/page.tsx:133,254,289,399`, `task-runs/[id]/page.tsx:103,192`, `settings/page.tsx:250,305` |
| 2 | Error banner JSX duplicated 10× | `clore/page.tsx:224,301,553`, others |
| 3 | `ModelEntry.kv_cache: Record<string, unknown>` forces unsafe casts; typed `KvCache` already exists in `lib/models/schema.ts:39` | `lib/types.ts:500,561`, `ModelCard.tsx:102`, `catalogue.ts:25` |
| 4 | **Functional bug:** `useCreateBenchmark` invalidates `["benchmarks"]` but `useBenchmarks` is keyed `["benchmarks", gpu, model]` — filtered lists never refresh | `lib/queries.ts:198,208` |
| 5 | `ModelCreate.quants: Omit<ModelQuant, ...>[]` instead of existing `ModelQuantCreate` — response-only fields can leak into create payload | `lib/types.ts:576` |
| 6 | `useQueryClient` cache pokes inside page components instead of in queries.ts hooks | `servers/page.tsx:39` |
| 7 | Inline `import("./types").X` inside `mutationFn` instead of top-of-file import | `lib/queries.ts:161,245` |
| 8 | `getValue() as string` casts in TanStack Table cells; fix by typing `ColumnDef<Row, string>` | `task-runs/page.tsx:27,52`, `benchmarks/page.tsx:92` |

#### File-size hotspots (split candidates, not toxic)

- `app/lab/page.tsx:664` — already in modernization plan
- `app/clore/page.tsx:663` — should be next
- `lib/types.ts:579` — kitchen sink

---

## 2. Database — what to scrap, what to keep

### 2.1 Drop in next migration

| Table | Reason |
|---|---|
| `provider_accounts` | Orphan stub; queried only as side-effect; single-operator app |
| `api_keys` | Orphan since LiteLLM removal (commit `ee4d694`, 2026-04-19) |

### 2.2 Migration-blocked (cannot drop yet)

| Table | Status | Action |
|---|---|---|
| `model_variants` | **Live in code, dead in data** — referenced by Playbook/PlaybookRunOutcome/ModelDeployment FKs, queried by feasibility/selector, but seeder never writes after Phase 9 | Either bridge or migrate compat to read `ModelQuant`. Cannot drop until FKs cut over. |

### 2.3 Reference-only — freeze, don't drop

`playbooks`, `playbook_run_outcomes`, `model_deployments` — all FKs point at `model_variants`. Revive together with execution paths (Lab plan), or formally retire.

### 2.4 Future refactor candidate

`Model` table has 49 columns. `recommended_engines`, `recommended_flags`, `kv_cache` are already JSON; the 12 `hf_*` and `author_*` fields could collapse into `hf_meta JSON` once you stop sorting/filtering on them. Not urgent.

---

## 3. .md files — scrap / rewrite / keep

### 3.1 Tracked files

| File | Verdict | Action |
|---|---|---|
| `README.md` | Solid, accurate | Keep |
| `DEVELOPMENT.md` | Good single source post-Phase-7 | Keep, but: drop the orphaned-tables row once `provider_accounts`/`api_keys` migrations land; add `models` + `model_quants` to the table list |
| `ROADMAP.md` | Stale "Upcoming phases" section (7–10 already shipped) | Trim — move to "Completed" or delete |
| `CLAUDE.md` | Accurate | Keep |
| `infra/ansible/playbooks/README.md` | Tied to reference-only execution paths | Verify still relevant |

### 3.2 Untracked artifacts (working dir)

| File | Action |
|---|---|
| `LAB_MODERNIZATION_PLAN.md` | Local-only planning doc (correct per memory rule). Delete after execution or move to `docs-private/` |
| `MODELS_PHASE10_PLAN.md` | Same — local-only, stale, delete or archive |
| `AUDIT_FINDINGS.md` (this file) | Same — local-only, do not commit |

### 3.3 Test artifacts under git

`frontend/test-results/.../error-context.md` — add `frontend/test-results/` to `.gitignore`, remove from tracking.

`backend/.pytest_cache/README.md` — auto-generated, gitignore.

---

## 4. In-app guides (`/docs/*`) — verdict

User concern: "guides have my chats with AI model".

**Audit contradicts the concern.** `/docs/engines`, `/docs/settings`, `/docs/vram-calculator` are well-structured reference docs with interactive demos, decision tables, and live calculators. The chat-style content was likely an older version pre-shadcn rewrite (commit `5bbbccd`).

### Real deficiencies

1. **No `<h1>` on any doc page.** `SectionHeading` renders `<h2>` directly. Screen readers / SEO see no page title.
2. **No `/docs/getting-started` page.** Missing canonical "how to use this platform" entrypoint: rent → SSH → seed model → find compatible GPU → benchmark.
3. **Sidebar doesn't link to `/docs/*`.** Discoverability gap.

### Action

- Add `<h1>` titles to all three doc pages
- New `/docs/getting-started/page.tsx` with the end-to-end flow
- Add Docs section to sidebar

Do **not** rewrite the existing guides — they're good.

---

## 5. Lab Modernization Plan — verdict & sequencing

The 7-phase plan is **well-structured and ready, but blocked on §0**.

The plan itself flags `feasibility.py` / `selector.py` / `parallel.py` / `launchers/vllm.py` as "reference-only — smoke-test before exposing to UI." The audit explains why: ModelVariant↔ModelQuant desync.

### Order to run it in

1. **PR #1: Bridge compat** (4–6h, prerequisite for everything) — pick `model_variants → model_quants` direction. Without this, Phases 2–5 of the plan render UI for a feasibility engine that always returns UNKNOWN.
2. **Lab Phase 1** — Machine Card + B5/B8 fixes. Independent, ships value.
3. **Lab Phases 2–5** — model_run_attempts + recommendation API + Lab tabs + outcome capture.
4. **Lab Phase 6** — publication. Sanitizer is highest-risk; gate behind `security-reviewer` agent + poisoned-fixture test.
5. **Lab Phase 7** — polish (xterm RangeError chunked-write fix at `PtyTerminal.tsx:75`).

### One missing piece in the plan

Models page already has runs-of-trust data via `inference_benchmarks` (separate from `model_run_attempts`). Decide: merge or keep both. Three success-rate sources (benchmarks, run attempts, playbook outcomes) is too many. Recommendation: `model_run_attempts` becomes the canonical surface; `inference_benchmarks` becomes a derived/aggregated view of successful runs.

---

## 6. Opus framework gap analysis

Against the user-supplied Opus "Compatibility Stack for vLLM/SGLang Deployment":

| Opus item | Status | Gap & landing site |
|---|---|---|
| (a) `gpu_profile` columns | Shipped | All 9 present at `entities.py:255–269` |
| (b) `stack_matrix` columns | Shipped | All present + container_image/pip_index_url at `entities.py:272–287` |
| (c) `model_profile` + variants[] | **Partial** | `Model` + `ModelQuant` cover the data flat (not nested); `ModelVariant` desync — see §0 |
| (d) `feasible(gpu_set, model)` returns ranked list | **Partial** | Single-tuple verdict only. Add `enumerate_feasible(gpu_set, model_key) -> list[FeasibilityReport]` in `services/compat/feasibility.py` |
| (e) Per-model launch checklist | **Partial** | 12 of ~17 checks. Missing: `context_fits` (KV-cache headroom vs `--max-model-len`), `tokenizer/HF_TOKEN_present` validation, `port_free`, `gpu_memory_utilization` tuning (hardcoded 0.90 in `selector.py:93`), `health_endpoint_within_120s` post-launch poll. Land in `feasibility.py` + new `services/compat/health_probe.py` |
| (f) Container vs bare-metal | Shipped | `selector.py:67` |
| (g) Engine choice heuristic (vLLM vs SGLang) | **Missing** | Engine is caller-supplied; SGLang launcher raises `NotImplementedError` at `selector.py:76`. New: `services/compat/engine_chooser.py` + `services/compat/launchers/sglang.py` |
| (h) Scheduled source pinning | **Partial** | `compat.scrape_versions` (`tasks.py:613–664`) hits PyPI for vLLM + SGLang only. Missing: NVIDIA driver matrix, CUDA runtime list, PyTorch version table, NGC tags. Also: only reports `is_newer`, never updates `stack_matrix`. Extend `tasks.py` + add admin-approval queue (already partly built — see `/compat/candidates/approve`) |

**Most load-bearing gap:** (c) — see §0.

---

## 7. HuggingFace retrieval — recommendation

User hypothesis: "store all the data in github... currently lot of the information is missing bcoz it's just a parser."

**Half right.** `hf_seeder.py` does discovery + dynamic stats well. It cannot do curation by design.

### What `hf_seeder` does well

- Discovery (`HfApi.list_models(filter=base_model:quantized:...)`)
- Dynamic stats (downloads, likes, trending)
- GGUF shard math
- Safetensors dtype detection
- Capability heuristics (MoE detection, KV cache calc, attention head extraction)

### What it cannot do

- Skips README body entirely (only frontmatter); loses chat templates, sampling defaults, recommended `--max-model-len`
- Doesn't follow `base_model` chains beyond one hop
- Hardcoded `_FMT_QUALITY` / `_GGUF_BPW_QUALITY` tables are guesses, not measurements
- Forces `arch_vllm=False` for GGUF (wrong — vLLM has experimental GGUF support)
- Returns `quant_format="unknown"` when tags don't match, silently producing low-quality rows
- Quant deduplication keeps first by name (download-sorted), drops legitimate alternates from different repos

### Recommended architecture: curated overlay, not replacement

```
HF parser (discovery, stats, GGUF) → ModelQuant rows
                                          ↓
                                     merge at read
                                          ↑
GitHub raw JSON (chat templates, engine flags,
known-bad combos, base_model chains)
```

#### Concrete plan

1. New public repo: `inferix-models` (MIT license)
2. Schema: `{model_key: {chat_template, recommended_flags, engine_overrides, broken_combinations, base_model_chain, notes, quality_overrides}}`
3. Fetch via `https://raw.githubusercontent.com/<you>/inferix-models/main/curation.json`
4. Cache in Redis 1h
5. Merge inside `seed_one_repo` or new `services/model_curation.py::apply_overlay()`
6. Keep stats live from HF — downloads/trending change daily, wrong place to version-control

This gives a free, diffable, PR-reviewable layer for what the parser cannot infer, without re-implementing discovery.

---

## 8. Strategic recommendations

1. **Pick a direction on reference-only code.** Phases 4–6 (deploy / playbook execute / multi-GPU TP) shipped as "reference-only." That's 1.5k+ lines accumulating drift. Either revive with the Lab plan, or freeze + tag and stop letting them be load-bearing for new feature feasibility.
2. **Phase numbering is exhausted.** Phase 11 of /models alongside Phase 1 of Lab is confusing. Switch fully to feature-tagged commits (`feat(lab):`, `feat(models):`) — recent commits already do this. Drop the global phase counter from ROADMAP.
3. **Single doc rule.** README → DEVELOPMENT.md → ROADMAP.md is the right shape. Enforce: no `*_PLAN.md` files committed (memory rule already in place). Move planning to plan mode / TodoWrite / external Notion.
4. **Tests are thin.** `backend/tests/` has 4 files (Phase 5 commit). No frontend test runner config visible at root. Adding Playwright smoke for `/models`, `/find`, `/lab` would catch the ModelVariant→ModelQuant kind of bug at PR time.
5. **Pin xterm version.** `RangeError: checkSupportDomain` on long OSC sequences is a known stack-overflow. Chunked-write at `PtyTerminal.tsx:75` is the fix.

---

## 9. Suggested PR order for Sonnet

### PR 1 — `fix(compat): bridge ModelQuant ↔ feasibility / selector` *(prerequisite)* ✅ DONE

**Goal:** Unblock Lab plan, Opus items (c)+(d), `/find` correctness for HF-seeded models.

**Implemented:**
- Added `_upsert_model_variant(db, model, mq)` helper in `hf_seeder.py`
- Wired call inside `seed_one_repo()` after quants are committed (before final `db.commit()`)
- Field mappings: `vram_min_gb=ceil(vram_weights_gb)`, `cc_min=cc_min or "7.5"`, arch flags, attention heads, tp_allowed_sizes, context_default
- Idempotent: updates existing rows, creates new ones — safe on re-seed
- Added 7 unit tests in `backend/tests/test_hf_seeder.py` covering: create, update, cc_min default, vram=0 default, context=0 default, name truncation to 32 chars, vram ceil

**Files:** `backend/app/services/hf_seeder.py`, `backend/tests/test_hf_seeder.py`.

### PR 2 — `chore: drop provider_accounts + api_keys; consolidate redis client` ✅ DONE

**Goal:** Schema cleanup + the simplest DRY win.

**Implemented:**
- New `backend/app/core/cache.py` with `get_redis_client()` — single source for the Redis connection
- Replaced 5 copies of identical Redis connection code: `clore.py`, `endpoints/feasibility.py`, `gpu_profiles.py`, `hf_seeder.py`, `services/compat/feasibility.py`
- Removed `ProviderAccount` class from `entities.py` and all 3 call sites in `clore.py`; `provider_account_id` set to `None` on Server creation
- Removed `provider_account_id` from `ServerCreate` and `ServerResponse` schemas; dropped stale `UUID` import
- Migration `20260506_0021_drop_provider_accounts.py`: drops FK constraint, drops column, drops table (reversible downgrade included)
- Note: `api_keys` was already dropped in migration 0009 — no duplicate action needed

**Files:** `app/core/cache.py` (new), `clore.py`, `endpoints/feasibility.py`, `gpu_profiles.py`, `hf_seeder.py`, `services/compat/feasibility.py`, `entities.py`, `schemas/servers.py`, `alembic/versions/20260506_0021_drop_provider_accounts.py`.

### PR 3 — `refactor(hf_seeder): split into constants/fetcher/parsers + curated overlay` ✅ DONE

**Goal:** Foundation for the GitHub-overlay model knowledge base.

**Implemented:**
- `hf_constants.py` (119 lines) — all lookup tables + `classify_author`
- `hf_fetcher.py` (168 lines) — Redis cache + HF API I/O only
- `hf_parsers.py` (437 lines) — all pure parse/detect/build functions; trivially unit-testable in isolation
- `hf_seeder.py` (152 lines, was 838) — thin orchestrator: imports from the three modules above, `_upsert_model_variant`, `seed_one_repo`
- `model_curation.py` (65 lines) — `apply_overlay(model_key)` fetches from `inferix-ai/inferix-models/curation.json`, caches 1h in Redis, returns `{}` on any error (no-op until repo created)
- Overlay wired into `seed_one_repo`: merges `recommended_flags` and `base_model` overrides before DB write
- Updated `test_hf_seeder.py` imports to pull from `hf_constants` and `hf_seeder` directly
- `tasks.py` unaffected — it only imports `seed_one_repo` which stays in `hf_seeder`

**Files:** 4 new `backend/app/services/hf_*.py` + `model_curation.py`, rewritten `hf_seeder.py`, updated `tests/test_hf_seeder.py`.

### PR 4 — `fix(frontend): shared Spinner + ErrorBanner + benchmark cache key`

**Goal:** DRY frontend cleanup + the one functional bug.

- New `components/ui/spinner.tsx` (export the existing inline one); replace 10 sites
- New `components/ui/error-banner.tsx`; replace 10 sites
- Fix `lib/queries.ts:198,208` cache invalidation keys to match `useBenchmarks` shape
- Type `ModelEntry.kv_cache` to `KvCache` from `lib/models/schema.ts`
- `ModelCreate.quants: ModelQuantCreate[]` instead of `Omit<...>`

**Files:** 2 new components + ~15 file touches.

### After PR 1–4 land

Lab Modernization Plan Phase 1 onwards, in order.

---

## 10. Out of scope for this audit pass

- Multi-provider beyond Clore (RunPod, Vast.ai, etc.)
- Cost tracking per run (Clore $/hr × duration)
- Auth / multi-user (single-operator by design — see ADR-001, ADR-005)
- B4 (SSE byte/char offset)
- Mobile-responsive layouts
- i18n

---

## 11. Pickup notes for Sonnet

- **Start with PR 1.** Without it, every other compat-related change is built on a broken foundation.
- **Do not commit this file.** Per memory rule: no `*_PLAN.md` / `*_FINDINGS.md` in git.
- **For each PR, run the existing test suite** (`docker compose exec backend pytest`) before opening. It's thin but real.
- **No navigation away from pages** — always modal/drawer (saved feedback memory).
- **shadcn/ui + TanStack Query + react-hook-form + zod** is the established stack; don't introduce alternatives.
- **`docker compose up --build`** for verification — frontend is production-mode in Docker (slow rebuild but accurate).
- When in doubt about a reference-only path, **don't extend it** — flag it in the PR description and wait for the user to decide revive vs retire.

---

**Generated:** 2026-05-06 by Opus 4.7 audit
**Implementing agent:** Sonnet 4.6
**Status:** Ready for execution; PR 1 is the first move.
