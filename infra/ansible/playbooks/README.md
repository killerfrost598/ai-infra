# Playbooks Directory

This directory is the default mounted location for Ansible playbooks used by workers.
Mounted into both `backend` and `worker` containers at `/ansible`.

## Collaboration model

Recommended approach:
1. Keep canonical playbooks in a dedicated Git repository
2. Sync/clone into this directory on startup or before execution
3. Track playbook commit hash in the `playbooks` DB table for reproducibility

## Directory structure (recommended)

```text
infra/ansible/
└── playbooks/
    ├── vllm-deploy/
    │   ├── site.yml              # main playbook
    │   ├── meta.yml              # compatibility metadata (see below)
    │   └── roles/
    │       ├── install-cuda/
    │       └── install-vllm/
    └── healthcheck/
        └── site.yml
```

## Metadata convention (`meta.yml`)

Each playbook should have a companion `meta.yml`:

```yaml
name: vllm-deploy
description: Installs and launches vLLM on a GPU server
supported_os:
  - ubuntu:22.04
  - ubuntu:20.04
min_cuda_version: "11.8"
min_vram_gb: 16
model_families:
  - llama
  - mistral
  - qwen
known_caveats:
  - Requires Docker to be pre-installed
  - Not compatible with A10 + CUDA 12.4 (known driver issue)
```

This metadata is intended to power the Phase 4 compatibility scoring feature.

## Integration status

- `backend/app/services/playbook_runner.py` is currently a **stub**
- Phase 3 task: implement `ansible-runner` execution pipeline that:
  1. Clones/pulls the playbook git repo
  2. Runs the playbook via `ansible_runner.run()`
  3. Streams stdout/stderr to a log file at `LOGS_BASE_PATH/{task_run_id}/`
  4. Updates the `TaskRun` record with `logs_path` and final status
  5. Records playbook commit hash on the `task_runs.metadata_json`
