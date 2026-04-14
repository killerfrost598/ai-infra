# Architecture

One control plane for GPU server rental (Clore.ai), interactive SSH terminal sessions, vLLM model deployment, and unified OpenAI-compatible routing through LiteLLM Proxy.

> Detailed data model, migration history, phase roadmap, and known issues → see `DEVELOPMENT.md`

---

## Components

| Component | Technology | Responsibility |
|---|---|---|
| **Frontend** | Next.js 14, React 18, TypeScript, Tailwind | Operator dashboard at `:3000` |
| **Backend API** | FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 | Control-plane REST + WebSocket at `:8000` |
| **Worker** | Celery 5 + Redis 7 | Async tasks: provision, deploy, terminate |
| **Database** | PostgreSQL 16 | Source of truth for all infrastructure state |
| **Clore.ai Client** | `clore-ai` SDK (ADR-006) | GPU marketplace adapter |
| **SSH Manager** | Paramiko | PTY shells, key auth (RSA/Ed25519/ECDSA/DSS), password auth |
| **LiteLLM Proxy** | LiteLLM | OpenAI-compatible gateway at `:4000` |

---

## Key Design Decisions (ADRs)

| # | Decision | Reason |
|---|---|---|
| ADR-001 | Single-user app — no auth | Internal ops tool; operator == user |
| ADR-002 | Celery for provision/deploy, sync for SSH sessions | Long tasks need queuing; sessions need low latency |
| ADR-003 | Sentinel pattern for SSH command output capture | Reliable output demarcation without PTY heuristics |
| ADR-004 | Clore API key stored in DB `platform_settings` | Runtime config without container restart |
| ADR-005 | No `users` table | Single-user assumption eliminates complexity |
| ADR-006 | Use `clore-ai` SDK instead of custom httpx client | SDK handles API shape changes; custom client had bugs |

---

## Data Flow

```text
Browser → FastAPI
    ├── DB read/write (SQLAlchemy)
    ├── Celery task dispatch (.delay()) → Worker → Clore.ai / SSH / vLLM
    └── WebSocket PTY (/sessions/{id}/pty) → Paramiko channel ↔ Browser (xterm.js)
```

---

## Docker Compose Topology

```text
┌──────────────── Docker network: platform ────────────────┐
│                                                           │
│  frontend ──(healthy)──► backend ──► postgres            │
│                              │           ▲               │
│                              └──────► redis              │
│                                          ▲               │
│                                      worker ─┘           │
│                                                           │
│  litellm (port 4000, standalone)                         │
│                                                           │
│  backend CMD: alembic upgrade head && uvicorn ...        │
└───────────────────────────────────────────────────────────┘
```

Healthcheck chain: `postgres` → `redis` → `backend` → `frontend` + `worker`

---

## Security Baseline (v1)

- Single-user, no auth gateway
- Secrets via `.env` + container env vars; Clore key in DB `platform_settings`
- `ssh_password` / `ssh_private_key` stored as plaintext — encrypt at rest for production
- SSH private keys never returned through API (only `has_ssh_key` bool exposed)
- CORS configured via `backend_cors_origins` setting

---

## Environment Variables

Root `.env` (Compose-level):
```
POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_PORT
REDIS_PORT
BACKEND_PORT   (default 8000)
FRONTEND_PORT  (default 3000)
LITELLM_PORT   (default 4000)
LITELLM_MASTER_KEY
CLORE_API_KEY  (optional fallback — preferred path is Settings page → DB)
```
