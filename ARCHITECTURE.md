# Architecture

## 1. System overview

The platform orchestrates GPU inference infrastructure end-to-end:

1. Rent/track servers from provider APIs (Clore.ai first)
2. Connect to servers over SSH for interactive terminal sessions and command execution
3. Deploy AI runtime (vLLM) through SSH + Ansible playbooks
4. Route model traffic through LiteLLM Proxy with an OpenAI-compatible API
5. Store all session transcripts, command outputs, and deployment artifacts for replay and audit
 
## 2. Logical components

### Frontend (Next.js 14, React 18, TypeScript, Tailwind CSS)
- Operator-facing dashboard at `http://localhost:3000`
- Sidebar navigation with SVG icons and active state highlighting
- Pages implemented: Overview, Servers (list + detail), Deployments, Playbooks, Task Runs (list + detail)
- Pages planned: Sessions, Clore Marketplace, Settings, API Keys
- API client in `frontend/src/lib/api.ts` — typed fetch wrapper
- TypeScript types in `frontend/src/lib/types.ts`
- Component library: `StatusBadge` (animated dot), `Sidebar` (client component with `usePathname`)
- Runtime config endpoint at `/api/config` (returns `apiBaseUrl`, `litellmBaseUrl`)

### Backend API (FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2)
- Public control-plane API at `http://localhost:8000`
- Auto-generates Swagger at `/docs`
- Full CRUD for: servers, model_deployments, playbooks, provider_accounts, task_runs, api_keys
- SSH endpoints per server: connectivity test + async command dispatch
- Clore.ai marketplace + rental lifecycle at `/api/v1/clore/` (BUILT, NOT YET WIRED TO FRONTEND)
- Settings endpoint planned: `/api/v1/settings` (key-value store for secrets and config)
- Dispatches Celery tasks on server/deployment creation
- DB session via `get_db()` dependency injection pattern
- Settings via `pydantic-settings` from `.env` (Clore API key will migrate to DB settings table)

### Worker (Celery 5 + Redis 7)
- `servers.provision` — SSH into server, run `nvidia-smi`, extract GPU/VRAM/CUDA, update server status
- `deployments.deploy` — Launch vLLM via Docker on the target server
- `servers.terminate` — Cancel Clore.ai rental, mark server TERMINATED
- `ssh.execute_command` — Run an ad-hoc command, write stdout/stderr to log file, update TaskRun
- Every task creates a `TaskRun` record with full lifecycle timestamps and log file path

### PostgreSQL 16
- Source of truth for all infrastructure state and command history
- Schema managed by Alembic (migrations run automatically on container start)
- Migrations:
  - `20260411_0001` — initial schema (all core tables)
  - `20260412_0002` — add `ssh_password` to servers
  - `20260412_0003` — add `ssh_private_key` to servers
  - Planned `20260412_0004` — drop `users` table (single-user app)
  - Planned `20260412_0005` — add `platform_settings` table
  - Planned `20260412_0006` — add `sessions` and `session_commands` tables

### Redis 7
- Celery broker (db 0) and result backend (db 1)

### LiteLLM Proxy
- Stable OpenAI-compatible API at `http://localhost:4000`
- Config at `infra/litellm/config.yaml`
- Master key via `LITELLM_MASTER_KEY` env var
- Future: dynamically register model routes as deployments reach RUNNING status

### Clore.ai Client (`backend/app/services/clore_client.py`)
- Current: custom `httpx`-based client — has known AttributeError bug (`gpu.get()` fails when spec shape varies)
- Planned: replace with `pip install clore-ai` official SDK (awaiting SDK review)
- Endpoints used: GET /marketplace, GET /my_orders, POST /create_order, POST /cancel_order
- Auth header: `auth-token: <CLORE_API_KEY>`
- API key source: `.env` now → DB `platform_settings` table after Phase 3

### SSH Manager (`backend/app/services/ssh_manager.py`)
- Paramiko-based with password, RSA private key (path), and private key content auth
- Auth priority: `private_key_content` → `private_key_path` → `password`
- Supports RSA, Ed25519, ECDSA, DSS key types (auto-detected from PEM content)
- `connect()`, `execute(cmd)` → `(stdout, stderr, rc)`, `upload(local, remote)`, `download(remote, local)`
- Context manager: `with SSHManager(...) as ssh:`
- Planned: persistent shell channel for terminal sessions (`invoke_shell()` + sentinel detection)

### Playbook Runner (`backend/app/services/playbook_runner.py`)
- **Stub** — ansible-runner integration not yet implemented

## 3. Data model

All tables use UUID primary keys and `created_at` timestamps.

### Current tables

| Table | Key fields |
|---|---|
| `provider_accounts` | provider_name, account_label, metadata_json, is_active |
| `servers` | external_server_id, hostname, ssh_port, ssh_username, ssh_password (hashed), ssh_private_key, gpu_model, vram_gb, cuda_version, status |
| `playbooks` | name, git_repo, git_branch, git_commit, tags, requirements_json |
| `model_deployments` | server_id, playbook_id, model_name, model_alias, quantization, remote_port, litellm_route_name, status |
| `api_keys` | key_name, key_prefix, provider_name, is_revoked |
| `task_runs` | task_type, status, server_id, model_deployment_id, started_at, finished_at, duration_seconds, logs_path, error_summary, metadata_json |
| `audit_logs` | event_type, actor, entity_type, entity_id, payload |

### Tables to remove
| Table | Reason |
|---|---|
| `users` | Single-user application — unnecessary complexity |

### Tables to add (Phase 3)

| Table | Key fields | Notes |
|---|---|---|
| `platform_settings` | `key VARCHAR(128) PK`, `value TEXT`, `updated_at` | Key-value store for API keys and app config |
| `sessions` | server_id, label, status (ACTIVE/TERMINATED), started_at, terminated_at | SSH terminal session lifecycle |
| `session_commands` | session_id, sequence_num, command, stdout, stderr, exit_code, executed_at, duration_ms | Per-command audit log, immutable after session terminates |

## 4. SSH terminal session design

The terminal session model replaces the ad-hoc `ssh.execute_command` Celery task pattern for interactive use cases.

### Session lifecycle
```text
POST /sessions  →  status=ACTIVE
    │
    ├── POST /sessions/{id}/commands  →  executes + logs → session_command row
    ├── POST /sessions/{id}/commands  →  ...
    │
DELETE /sessions/{id}  →  status=TERMINATED
    │
    └── All session_commands become immutable (read-only)
        Download available: single command or full transcript
```

### Shell state persistence
- Backend opens a persistent PTY-based shell channel (`invoke_shell()`) per session
- Commands are sent through the shell's stdin; output is read with a sentinel marker pattern
- Sentinel: each command is followed by `echo __CMD_DONE_<uuid>__`; backend reads until sentinel appears
- Captures real shell state: `cd`, env vars, and command history carry over between commands
- Shell channel is stored in the Celery worker process (in-memory, tied to session lifetime)
- Sessions are tied to one backend/worker node (stateful)

### Download formats
- **Single command**: `GET /sessions/{id}/commands/{cmd_id}/download` → `{seq}_{cmd_slug}.txt` with command + output
- **Full transcript**: `GET /sessions/{id}/download` → `{session_label}_{date}.txt` with all commands in order

## 5. Interaction flow

```text
User/UI action
   │
   ▼
FastAPI receives command
   │
   ├─ writes intent + state transition to DB
   └─ dispatches Celery task (.delay()) OR executes synchronously (SSH sessions)
         │
         ▼
   Worker executes orchestration:
     - Clore.ai API calls (rent/terminate)
     - SSH validation + nvidia-smi (provision)
     - vLLM Docker launch (deploy)
     - SSH session commands (interactive)
     - TaskRun / SessionCommand record updated throughout
```

## 6. Docker Compose topology

```text
┌──────────────────────────── Docker Network: platform ──────────────────────────┐
│                                                                                 │
│  frontend ──(service_healthy)──► backend ──► postgres (healthcheck)            │
│                                      │                                         │
│                                      └──────────► redis (healthcheck)          │
│                                                       ▲                        │
│                                               worker ─┘                        │
│                                                                                 │
│  litellm (standalone, port 4000)                                               │
│                                                                                 │
│  backend CMD: alembic upgrade head && uvicorn ...  (auto-migration on start)   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Healthcheck chain
1. `postgres` → `pg_isready` every 5s, 10 retries
2. `redis` → `redis-cli ping` every 5s, 10 retries
3. `backend` waits for postgres+redis → runs migrations → starts uvicorn → `curl /health`
4. `frontend` + `worker` wait for backend healthy

## 7. Environment variables

Root `.env` (Compose-level):
```
POSTGRES_DB=ai_inference
POSTGRES_USER=ai_user
POSTGRES_PASSWORD=ai_password
POSTGRES_PORT=5432
REDIS_PORT=6379
BACKEND_PORT=8000
FRONTEND_PORT=3000
LITELLM_PORT=4000
LITELLM_MASTER_KEY=sk-litellm-change-me
CLORE_API_KEY=replace_me        ← moving to DB settings table in Phase 3
```

After Phase 3, `CLORE_API_KEY` will be optional in `.env` (fallback only). Primary source will be the `platform_settings` DB table managed through the Settings page.

## 8. Security baseline (v1)

- Single-user by default, no auth gateway
- Secret material via `.env` and container env vars (Clore key moving to DB)
- `ssh_password` stored as plaintext in DB — production use should encrypt at rest
- `ssh_private_key` stored as plaintext PEM in DB — same encryption caveat
- SSH private keys NOT shared across API responses (`has_ssh_key` bool instead)
- API keys tracked with `is_revoked` flag
- CORS configured via `backend_cors_origins` setting

## 9. Known issues and technical debt

| Issue | Location | Priority |
|---|---|---|
| `gpu.get()` AttributeError when Clore API returns non-dict spec | `clore_client.py:68` | High — crashes endpoint |
| Clore API 401 — likely `auth-token` header format or key value issue | `clore_client.py` | High — all Clore endpoints broken |
| Custom Clore client to be replaced with `clore-ai` SDK | `clore_client.py` | Medium |
| `users` table exists in a single-user application | `entities.py`, migration | Medium |
| `playbook_runner.py` is a 1-line stub | `services/playbook_runner.py` | Low (Phase 3) |
| SSH `ssh.execute_command` task has no shell state (reconnects per command) | `tasks.py` | Superseded by sessions |
| LiteLLM not updated when deployment → RUNNING | `tasks.py` | Low (Phase 4) |
| No encryption for `ssh_password` / `ssh_private_key` in DB | `entities.py` | Medium |

## 10. Open extension points (Phase 3+)

- `playbook_runner.py` — ansible-runner integration (stub)
- SSH terminal sessions with persistent shell channel and command log
- Settings page and `platform_settings` DB table for API key management
- Clore-ai SDK migration
- LiteLLM dynamic route registration (when deployment RUNNING)
- Websocket or SSE for live task run output streaming
- Multi-provider adapter system (beyond Clore)
- Cost tracking and budget controls
- Retry policies and fallback deployment strategies
