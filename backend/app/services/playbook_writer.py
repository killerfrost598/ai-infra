"""Write generated playbooks to a local git repo."""

from __future__ import annotations

import logging
import os
import re
import subprocess
import uuid

logger = logging.getLogger(__name__)

# Configurable base path for the local playbook repo.
# In Docker Compose the infra directory is mounted at /host/infra.
_DEFAULT_REPO = "/host/infra"


def write_playbook_to_local_repo(
    name: str,
    setup_sh: str,
    ansible_yaml: str,
    session_id: str | None = None,
) -> dict:
    """Write setup.sh + playbook.yml to infra/ansible/playbooks/<slug>/ and git commit.

    Returns:
        {"git_repo": str, "git_commit": str | None}
    """
    base_dir = os.environ.get("PLAYBOOK_REPO_PATH", _DEFAULT_REPO)
    slug = _slugify(name)
    playbook_dir = os.path.join(base_dir, "ansible", "playbooks", slug)
    os.makedirs(playbook_dir, exist_ok=True)

    setup_path = os.path.join(playbook_dir, "setup.sh")
    yaml_path = os.path.join(playbook_dir, "playbook.yml")

    with open(setup_path, "w") as f:
        f.write(setup_sh)
    os.chmod(setup_path, 0o755)

    with open(yaml_path, "w") as f:
        f.write(ansible_yaml)

    commit_msg = f"feat: playbook {slug}"
    if session_id:
        commit_msg += f" from session {session_id[:8]}"

    try:
        subprocess.run(
            ["git", "add", playbook_dir],
            cwd=base_dir,
            check=True,
            capture_output=True,
        )
        result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=base_dir,
            capture_output=True,
            text=True,
        )
        if result.returncode not in (0, 1):
            logger.warning("git commit non-zero: %s", result.stderr)

        sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=base_dir,
            capture_output=True,
            text=True,
        )
        git_commit = sha.stdout.strip() or None
    except Exception as exc:
        logger.warning("git operations failed: %s", exc)
        git_commit = None

    return {"git_repo": base_dir, "git_commit": git_commit}


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:64] or f"playbook-{uuid.uuid4().hex[:8]}"
