# Playbooks

Playbooks are **shell scripts** executed over SSH via Paramiko. Despite the directory name (`ansible/`), the runner does not use Ansible — it uses SSH + shell.

## How it works

1. Register a playbook in the DB: name, git repo URL, script path (e.g. `setup.sh`), target branch.
2. `POST /playbooks/{id}/run` dispatches a Celery task that:
   - SSH-connects to the target server
   - `git clone` (or pull) the repo to a temp dir on the server
   - Executes the script via PTY
   - Streams stdout/stderr to a log file (`/var/log/aip/{task_run_id}/`)
   - Updates the `TaskRun` record with final status
3. Live output is available via `GET /task-runs/{id}/logs/stream` (SSE).

## Script convention

Each playbook repo should have a shell script at the configured path. The platform executes it as:
```bash
bash <script_path>
```

Recommended structure for a playbook repo:
```
my-playbook/
├── setup.sh         # main entry point
├── install_cuda.sh  # sourced by setup.sh
└── config/
    └── vllm.yaml
```

`setup.sh` should be idempotent — the platform may re-run it on retry.

## Exit codes

The platform captures the exit code. Non-zero → `TaskRun.status = FAILED`.

## Metadata (optional)

Playbooks can carry metadata in a `meta.yaml` at the repo root for future compatibility scoring (F5):
```yaml
name: vllm-deploy
supported_os: [ubuntu:22.04]
min_cuda_version: "11.8"
min_vram_gb: 16
model_families: [llama, mistral, qwen]
```

This metadata is not yet consumed by the platform but is reserved for the F5 compatibility scoring feature.
