# AI Inference Server Management Platform

One control plane to rent GPU servers (Clore.ai), connect via SSH terminal, run playbooks, deploy AI models with vLLM, and track inference benchmarks.

## Why this exists

Running inference workloads on rented GPU infrastructure is usually fragmented — renting, SSH access, deployment, and API exposure are all separate workflows. This platform consolidates them and builds a long-term knowledge base from session logs, deployment history, and inference benchmarks.

---

## Core stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Backend API | FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 |
| Task Queue | Celery 5, Redis 7 |
| Database | PostgreSQL 16 |
| SSH | Paramiko (PTY sessions + key/password auth) |
| GPU Marketplace | Clore.ai (`clore-ai` SDK + raw httpx) |
| Infrastructure | Docker Compose |

---

## Quick start

**Prerequisites:** Docker Desktop (Linux containers), Git

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD at minimum
# CLORE_API_KEY is optional here; set it from the Settings page after startup

# 2. Start (keeps DB data between restarts)
docker compose up --build

# Full reset (wipes all data):
docker compose down -v && docker compose up --build
```

DB migrations run automatically on backend startup (`alembic upgrade head`).

**Service endpoints:**

| Service | URL |
|---|---|
| Frontend dashboard | http://localhost:3000 |
| Backend API + Swagger | http://localhost:8000/docs |

---

## Features

- **Clore.ai marketplace** — browse ~2,300 GPU servers, filter by GPU model, VRAM, PCIe, price; rent with SSH key or password; currency auto-filtered to what each server accepts
- **GPU Finder** — pick a model + quantization + engine, see ranked servers with VRAM fit, compat chips, and predicted throughput
- **Interactive SSH terminal** — xterm.js PTY sessions with command history, exit codes, duration tracking, and persistent Lab workspace restoration
- **Lab page** — technical operator surface with server cards, auto machine snapshot on session start, model/quant selection from the model KB, AI-assisted deployment guidance, executable deployment plans, parsed command history, and "convert session to playbook"
- **Model knowledge base** — editable models/quants, Hugging Face metadata sync, quant color coding, and Lab/Finder integration
- **Playbooks** — register a git repo + script, run it on any server via SSH, stream live logs
- **Task runs** — all async operations logged with SSE live streaming
- **Inference benchmarks** — tokens/s leaderboard by GPU model, integrated into marketplace offer cards
- **Compat drift control** — weekly PyPI scrape for vLLM/SGLang updates; operator approves before stack_matrix update
- **Multi-GPU TP planning** — NVLink-aware tensor-parallel recommendations for multi-GPU hosts

---

## API surface (`/api/v1/`)

| Prefix | Operations |
|---|---|
| `GET /health` | health check |
| `/servers` | CRUD + SSH test + reprobe + snapshot |
| `/model-deployments` | CRUD |
| `/playbooks` | CRUD + `POST /{id}/run` + `GET /recommended` |
| `/task-runs` | list + get + SSE log stream |
| `/settings` | get (presence flags only) + upsert |
| `/clore/offers` | list with filters + Redis cache |
| `/clore/rentals` | list + create (rent+register) + terminate + dry-run |
| `/clore/balance` | wallet balances |
| `/sessions` | list + create + get + terminate |
| `WS /sessions/{id}/pty` | interactive PTY terminal |
| `/sessions/{id}/commands` | recorded command execution |
| `/sessions/{id}/commands/async` | noninteractive background command execution |
| `/sessions/{id}/commands/summary` | parsed command history |
| `/sessions/{id}/to-playbook` | convert session to playbook via Claude Haiku |
| `/lab/recommend` | feasibility-checked model launch recommendation |
| `/lab/deployments/plan` | deployment plan steps for operator-assisted vLLM setup |
| `/lab/assist` | optional Anthropic/OpenAI deployment guidance using platform context |
| `/model-runs` | model run attempt records and aggregate success metrics |
| `/benchmarks` | CRUD + `GET /gpu/{model}` + `GET /leaderboard` |
| `POST /feasibility` | 12-check compat report (predicted or verified) |
| `/compat/candidates` | list scrape runs + approve candidate |

---

## Monorepo layout

```
ai-infra/
├── docker-compose.yml
├── .env.example
├── DEVELOPMENT.md      # ADRs, architecture, conventions, bugs, SDK notes
├── ROADMAP.md          # completed phases + upcoming work
├── README.md
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # servers, sessions, clore, benchmarks, settings, …
│   │   ├── services/           # clore_client, ssh_manager, session_runner, …
│   │   ├── models/entities.py
│   │   ├── schemas/
│   │   └── workers/            # celery_app, tasks
│   └── alembic/versions/
├── frontend/
│   └── src/
│       ├── app/        # pages: servers, sessions, clore, lab, benchmarks, …
│       ├── components/ # PtyTerminal, Sidebar, StatusBadge
│       └── lib/        # api.ts, types.ts
├── infra/
│   └── ansible/playbooks/   # playbook scripts (setup.sh convention)
└── data/               # bind-mounted DB + Redis data (survives restarts)
```

---

## SSH authentication

| Method | How |
|---|---|
| Password | Enter in the rent/register form |
| Private key | Paste full PEM block (RSA, Ed25519, ECDSA, DSS) |

Credentials are stored in the DB. The API never returns raw credentials — only `has_ssh_password` / `has_ssh_key` booleans are exposed.

---

## Data persistence

`docker compose up --build` keeps volume data intact. To fully reset:
```bash
docker compose down -v
```

Bind mounts (`./data/postgres`, `./data/redis`) also survive `down -v` — they persist on the host.
