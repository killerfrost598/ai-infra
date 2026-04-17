"""SSH-based playbook runner: clone a git repo on the remote server and run setup.sh."""

from __future__ import annotations

import logging
from typing import Callable

from app.services.ssh_manager import SSHManager

logger = logging.getLogger(__name__)


def run_playbook(server, playbook, log: Callable[[str], None]) -> bool:
    """Clone the playbook git repo on the remote server and execute setup.sh.

    Args:
        server: ``Server`` ORM object (hostname, ssh_port, credentials).
        playbook: ``Playbook`` ORM object (git_repo, git_branch, git_commit).
        log: Callable that accepts a string and writes it to the task log.

    Returns:
        True if setup.sh exits 0, False on any non-zero exit or SSH error.
    """
    work_dir = f"/tmp/aip_playbook_{playbook.id}"

    with SSHManager(
        hostname=server.hostname,
        port=server.ssh_port,
        username=server.ssh_username,
        password=server.ssh_password,
        private_key_content=server.ssh_private_key,
    ) as ssh:
        # Clean previous run if present
        _run_step(ssh, log, f"rm -rf {work_dir}", allow_failure=True)

        # Clone — shallow clone for speed
        clone_cmd = (
            f"git clone --branch {playbook.git_branch} --depth 1 "
            f"{playbook.git_repo} {work_dir}"
        )
        if not _run_step(ssh, log, clone_cmd):
            return False

        # Pin to a specific commit when requested
        if playbook.git_commit:
            if not _run_step(ssh, log, f"cd {work_dir} && git checkout {playbook.git_commit}"):
                return False

        # Execute setup.sh
        setup_cmd = f"chmod +x {work_dir}/setup.sh && {work_dir}/setup.sh"
        if not _run_step(ssh, log, setup_cmd):
            return False

    return True


def _run_step(ssh, log: Callable[[str], None], cmd: str, *, allow_failure: bool = False) -> bool:
    """Execute one SSH command, log its output, and return True on success."""
    log(f"$ {cmd}\n")
    try:
        stdout, stderr, rc = ssh.execute(cmd)
    except Exception as exc:
        log(f"ERROR: {exc}\n\n")
        return allow_failure

    if stdout:
        log(stdout)
    if stderr:
        log(f"--- stderr ---\n{stderr}\n")
    log(f"[exit: {rc}]\n\n")
    return allow_failure or rc == 0
