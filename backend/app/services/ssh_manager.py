"""SSH manager for Paramiko-based server connectivity and file transfer."""

from __future__ import annotations

import io
import logging
from typing import Optional

import paramiko

from app.core.config import settings

logger = logging.getLogger(__name__)

_KEY_CLASSES = tuple(
    cls
    for cls in (
        getattr(paramiko, "RSAKey", None),
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        getattr(paramiko, "DSSKey", None),
    )
    if cls is not None
)


def _load_pkey_from_content(key_content: str) -> paramiko.PKey:
    """Try each Paramiko key type until one successfully loads the PEM content."""
    for cls in _KEY_CLASSES:
        try:
            return cls.from_private_key(io.StringIO(key_content))
        except (paramiko.SSHException, ValueError):
            continue
    raise ValueError(
        "Unsupported or invalid private key format. "
        "Supported types: RSA, Ed25519, ECDSA, DSS."
    )


def configure_host_key_policy(client: paramiko.SSHClient) -> None:
    """Load known hosts and reject unknown hosts unless explicitly allowed."""
    client.load_system_host_keys()
    if settings.ssh_trust_unknown_hosts:
        logger.warning("SSH unknown-host trust is enabled; this is unsafe for production")
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())


class SSHManager:
    """Manages SSH connections and remote command execution via Paramiko.

    Auth priority (first non-None wins): private_key_content → private_key_path → password.
    """

    def __init__(
        self,
        hostname: str,
        port: int = 22,
        username: str = "root",
        password: Optional[str] = None,
        private_key_path: Optional[str] = None,
        private_key_content: Optional[str] = None,
        timeout: int = 30,
    ) -> None:
        self.hostname = hostname
        self.port = port
        self.username = username
        self.password = password
        self.private_key_path = private_key_path
        self.private_key_content = private_key_content
        self.timeout = timeout
        self._client: Optional[paramiko.SSHClient] = None

    def connect(self) -> None:
        """Establish an SSH connection."""
        self._client = paramiko.SSHClient()
        configure_host_key_policy(self._client)
        connect_kwargs: dict = {
            "hostname": self.hostname,
            "port": self.port,
            "username": self.username,
            "timeout": self.timeout,
        }
        if self.private_key_content:
            connect_kwargs["pkey"] = _load_pkey_from_content(self.private_key_content)
        elif self.private_key_path:
            connect_kwargs["pkey"] = paramiko.RSAKey.from_private_key_file(self.private_key_path)
        elif self.password:
            connect_kwargs["password"] = self.password
        try:
            self._client.connect(**connect_kwargs)
            logger.info("SSH connected to %s:%d as %s", self.hostname, self.port, self.username)
        except paramiko.AuthenticationException as exc:
            raise RuntimeError(f"SSH authentication failed for {self.hostname}: {exc}") from exc
        except paramiko.SSHException as exc:
            raise RuntimeError(f"SSH connection error to {self.hostname}: {exc}") from exc

    def execute(self, command: str) -> tuple[str, str, int]:
        """Run a command on the remote host.

        Returns:
            (stdout, stderr, return_code)
        """
        if self._client is None:
            raise RuntimeError("Not connected — call connect() first")
        try:
            _, stdout, stderr = self._client.exec_command(command, timeout=self.timeout)
            out = stdout.read().decode(errors="replace")
            err = stderr.read().decode(errors="replace")
            rc = stdout.channel.recv_exit_status()
            logger.debug("CMD [rc=%d] %s", rc, command)
            return out, err, rc
        except paramiko.SSHException as exc:
            raise RuntimeError(f"Command execution failed: {exc}") from exc

    def upload(self, local_path: str, remote_path: str) -> None:
        """Upload a local file to the remote host via SFTP."""
        if self._client is None:
            raise RuntimeError("Not connected — call connect() first")
        sftp = self._client.open_sftp()
        try:
            sftp.put(local_path, remote_path)
            logger.info("Uploaded %s → %s:%s", local_path, self.hostname, remote_path)
        finally:
            sftp.close()

    def download(self, remote_path: str, local_path: str) -> None:
        """Download a remote file to the local host via SFTP."""
        if self._client is None:
            raise RuntimeError("Not connected — call connect() first")
        sftp = self._client.open_sftp()
        try:
            sftp.get(remote_path, local_path)
            logger.info("Downloaded %s:%s → %s", self.hostname, remote_path, local_path)
        finally:
            sftp.close()

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            logger.info("SSH disconnected from %s", self.hostname)

    def __enter__(self) -> SSHManager:
        self.connect()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
