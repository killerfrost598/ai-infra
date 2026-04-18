# Architecture

Single-operator control plane for GPU server rental (Clore.ai), interactive SSH sessions, vLLM model deployment, and AI inference benchmarking.

> Detailed data model, roadmap, conventions, and known issues → `DEVELOPMENT.md`

---

## Components

| Component | Technology | Responsibility |
|---|---|---|
| **Frontend** | Next.js 14, React 18, TypeScript, Tailwind | Operator dashboard at `:3000` |
| **Backend API** | FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 | Control-plane REST + WebSocket at `:8000` |
| **Worker** | Celery 5 + Redis 7 | Async tasks: provision, deploy, terminate, playbook run |
| **Database** | PostgreSQL 16 | Source of truth for all infrastructure state |
| **Cache** | Redis 7 (db=2) | Clore marketplace offers (60s TTL), Celery broker/result (db=0/1) |
| **Clore.ai Client** | `clore-ai` SDK + raw httpx | GPU marketplace adapter; SDK used for marketplace/wallets, raw HTTP for my_orders/create_order (SDK model bugs) |
| **SSH Manager** | Paramiko | PTY shells, key auth (RSA/Ed25519/ECDSA/DSS), password auth |

---

## Key Design Decisions (ADRs)

| # | Decision | Reason |
|---|---|---|
| ADR-001 | Single-user app — no auth | Internal ops tool; operator == user |
| ADR-002 | Celery for provision/deploy/terminate; sync for SSH sessions | Long tasks need queuing; sessions need low latency |
| ADR-003 | Sentinel pattern for SSH command output capture | Reliable output demarcation without PTY heuristics |
| ADR-004 | Clore API key stored in DB `platform_settings` | Runtime config without container restart |
| ADR-005 | No `users` table | Single-user assumption eliminates complexity |
| ADR-006 | Partial `clore-ai` SDK — bypass for `my_orders` + `create_order` | SDK v0.1.1 `Order` model has 4 fields wrong vs real API; those calls use raw httpx |
| ADR-007 | LiteLLM removed | Was broken (registered routes at localhost not GPU); vLLM speaks OpenAI natively; saved ~400MB RAM |
| ADR-008 | Frontend production build in Docker | Dev mode (`npm run dev`) recompiled every request; production build serves pre-compiled bundles |
| ADR-009 | Redis cache for Clore marketplace offers | SDK marketplace() call takes 2–5s (fetches all ~2,285 servers); 60s TTL cache serves all filtered views from one upstream fetch |

---

## Data Flow

```
Browser → FastAPI (port 8000)
    ├── DB read/write   (SQLAlchemy → PostgreSQL)
    ├── Cache read/write (redis db=2, Clore offers)
    ├── Task dispatch   (.delay()) → Celery Worker → Clore.ai API / Paramiko SSH
    └── WebSocket PTY   (/sessions/{id}/pty) → Paramiko channel ↔ xterm.js
```

Clore.ai API calls:
```
CloreClient
    ├── sdk.marketplace()  → SDK (works correctly)
    ├── sdk.wallets()      → SDK (works correctly)
    ├── sdk.cancel_order() → SDK (works correctly)
    ├── POST /create_order → raw httpx (SDK ValidationError on success response)
    └── GET  /my_orders    → raw httpx (SDK Order model fields wrong)
```

---

## Docker Compose Topology

```
┌──────────────── Docker network: platform ─────────────────┐
│                                                            │
│  frontend ──(healthy)──► backend ──► postgres             │
│                              │           ▲                 │
│                              └──────► redis               │
│                                          ▲                 │
│                                      worker ──┘            │
│                                                            │
│  backend CMD: alembic upgrade head && uvicorn ...         │
└────────────────────────────────────────────────────────────┘
```

Healthcheck chain: `postgres` → `redis` → `backend` → `frontend` + `worker`

Bind mounts (data persistence across restarts):
- `./data/postgres` → `/var/lib/postgresql/data`
- `./data/redis` → `/data`

---

## Security Baseline (v1)

- Single-user, no auth gateway
- Clore API key stored in DB `platform_settings`; other secrets via `.env` + container env vars
- `ssh_password` / `ssh_private_key` stored as plaintext — encrypt at rest for production
- SSH private keys never returned through API (only `has_ssh_key` bool exposed)
- `GET /settings` returns presence flags only — never returns secret values

---

## Environment Variables

Root `.env` (Compose-level):
```
POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_PORT
REDIS_PORT
BACKEND_PORT    (default 8000)
FRONTEND_PORT   (default 3000)
CLORE_API_KEY   (optional fallback — preferred path is Settings page → DB)
```

Frontend build arg (baked at image build time):
```
BACKEND_INTERNAL_URL=http://backend:8000   (Next.js proxy target inside Docker)
```

---

## Clore.ai SDK known issues (v0.1.1)

The SDK's `Order` model doesn't match the real API response. Verified 2026-04-18:

| Field | SDK model | Real API | Example |
|---|---|---|---|
| `pub_cluster` | `Optional[str]` | `List[str]` | `["n1.msk.cloreai.ru"]` |
| `tcp_ports` | `Optional[Dict[str, int]]` | `List[str]` | `["22:1277"]` |
| `server_id` | alias `"renting_server"` | field `"si"` in response | `55493` |
| `create_order` response | expects `result["order"]` | returns `{"code": 0}` only | always ValidationError |

`CloreClient` in `clore_client.py` handles this by using raw httpx for those two operations. Do not revert to `sdk.my_orders()` or `sdk.create_order()` without verifying the SDK has been updated.
