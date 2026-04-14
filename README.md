# AI Inference Server Management Platform

One control plane to rent GPU servers (Clore.ai), connect via SSH terminal, deploy AI models with vLLM, and route all traffic through a unified OpenAI-compatible API (LiteLLM Proxy).

## Why this exists

Running inference workloads on rented GPU infrastructure is usually fragmented:
- renting/provisioning is one workflow
- SSH access and command execution are another
- deployment and troubleshooting are a third
- API exposure and routing are a fourth

This platform consolidates all four and builds a long-term knowledge base from session logs, deployment history, and inference benchmarks.

## Core stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Backend API | FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 |
| Task Queue | Celery 5, Redis 7 |
| Database | PostgreSQL 16 |
| SSH | Paramiko (PTY sessions + key/password auth) |
| Clore.ai | `clore-ai` SDK |
| Model Gateway | LiteLLM Proxy |
| Infrastructure | Docker Compose |

## Quick start

### Prerequisites
- Docker Desktop (with Linux containers)
- Git

### Configure environment
```bash
cp .env.example .env
# CLORE_API_KEY is optional here — set it from the Settings page after startup
# Set LITELLM_MASTER_KEY for the model gateway
```

### Run
```bash
# Full reset (fresh DB):
docker compose down -v && docker compose up --build

# Normal restart (keeps DB data):
docker compose up --build
```

DB migrations run automatically on backend startup (`alembic upgrade head`).

### Service endpoints

| Service | URL |
|---|---|
| Frontend dashboard | http://localhost:3000 |
| Backend API + Swagger | http://localhost:8000/docs |
| LiteLLM Proxy | http://localhost:4000 |

## API surface (`/api/v1/`)

| Prefix | Operations | Frontend |
|---|---|---|
| `GET /health` | health check | — |
| `/servers` | CRUD + auto-provision on create | ✅ |
| `/servers/{id}/ssh/test` | connectivity test | ✅ |
| `/model-deployments` | CRUD + auto-deploy on create | ✅ |
| `/playbooks` | CRUD | ✅ |
| `/provider-accounts` | CRUD | — (auto-managed) |
| `/task-runs` | list + get + logs | ✅ |
| `/api-keys` | list + create + revoke | ✅ |
| `/settings` | get keys (presence only) + upsert | ✅ |
| `/clore/offers` | list GPU marketplace offers | ✅ with filters |
| `/clore/rentals` | list + create (rent+register) + terminate | ✅ |
| `/sessions` | list + create + get + terminate | ✅ |
| `WS /sessions/{id}/pty` | interactive PTY terminal | ✅ xterm.js |
| `/sessions/{id}/commands` | scripted command execution | API only |
| `/sessions/{id}/download` | transcript download | ✅ |

## SSH authentication

| Method | How |
|---|---|
| Password | Enter in the server registration form |
| Private key | Paste full PEM block (RSA, Ed25519, ECDSA, DSS) |

Credentials are stored in the DB and never returned through the API (only `has_ssh_password` / `has_ssh_key` booleans are exposed).

## Monorepo layout

```
ai-infra/
├── docker-compose.yml
├── .env.example
├── ARCHITECTURE.md        # System design, components, ADRs
├── DEVELOPMENT.md         # Data model, roadmap, phase plans, conventions
├── README.md
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/  # servers, sessions, clore, settings, …
│   │   ├── services/          # ssh_manager, session_runner, clore_client, …
│   │   ├── models/entities.py
│   │   ├── schemas/
│   │   └── workers/           # celery_app, tasks
│   └── alembic/versions/
├── frontend/
│   └── src/
│       ├── app/               # pages: servers, sessions, clore, deployments, …
│       ├── components/        # PtyTerminal, Sidebar, StatusBadge
│       └── lib/               # api.ts, types.ts
└── infra/
    ├── litellm/config.yaml
    └── nginx/
```

## Docker volume note

`docker compose down` keeps volumes (DB data intact). To fully reset:
```bash
docker compose down -v
```
