"""PTY-based SSH session runner using the sentinel pattern."""

from __future__ import annotations

import logging
import re
import time
import uuid

import paramiko

from app.models.entities import Server
from app.services.session_store import SessionHandle
from app.services.ssh_manager import _load_pkey_from_content

logger = logging.getLogger(__name__)

# Comprehensive ANSI/VT100 escape sequence stripper.
# Handles:
#   CSI  — ESC [ params final         (colours, cursor, erase, …)
#   OSC  — ESC ] text BEL|ST          (title setting, colour schemes)
#   DCS  — ESC P text ST              (device control strings)
#   PM/APC — ESC ^ / ESC _ text ST
#   Charset — ESC ( B, ESC ) 0, …    (G0/G1 designators)
#   Other   — ESC = > 7 8 M D E H …  (keypad, cursor, index, reset)
_ANSI_RE = re.compile(
    r"\x1b(?:"
    r"\[[0-?]*[ -/]*[@-~]"               # CSI sequences
    r"|\][^\x07\x1b]*(?:\x07|\x1b\\)"    # OSC sequences (BEL or ST terminated)
    r"|[P^_][^\x1b]*\x1b\\"              # DCS / PM / APC (ST terminated)
    r"|[ -/]*[0-~]"                       # All other 2+ char ESC sequences
    r")"
)

_INITIAL_PROMPT_DRAIN_TIMEOUT = 5.0
_INITIAL_PROMPT_SETTLE_SLEEP = 0.1

# PS1 marker injected via PROMPT_COMMAND so every command boundary is timestamped.
# Format: __PS1__<epoch_ms>__<exit_code>__
_PROMPT_COMMAND = "export PROMPT_COMMAND='echo \"__PS1__$(date +%s%3N)__$?__\"'"
_PS1_RE = re.compile(r"__PS1__(\d+)__(\d+)__")

# Control characters to strip from stored PTY logs (not printable, not meaningful for display)
_CTRL_STRIP = re.compile(r"[\x00-\x06\x0e-\x1a\x1c-\x1f]")


def _process_backspace(text: str) -> str:
    """Simulate terminal backspace/delete so stored PTY logs show final text, not raw keystrokes.

    Handles:
      \x08  BS  — move cursor left (backspace): removes previous character
      \x7f  DEL — same effect as BS in most terminals
      \x03  ETX — Ctrl+C: rendered as visible ^C marker
      \r    CR  — carriage return without LF: resets to start of current line

    This makes history readable when users corrected typos before hitting Enter.
    """
    result: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in ("\x08", "\x7f"):
            if result:
                result.pop()
        elif ch == "\x03":
            result.append("^C")
        elif ch == "\r":
            # If \r\n, let \n handle the newline normally; if lone \r, clear to line start
            if i + 1 < len(text) and text[i + 1] == "\n":
                result.append(ch)
            else:
                # Retrace to last newline (carriage return to column 0)
                while result and result[-1] != "\n":
                    result.pop()
        else:
            result.append(ch)
        i += 1
    return "".join(result)


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences and process backspace/control chars for readable PTY logs."""
    cleaned = _ANSI_RE.sub("", text)
    cleaned = _CTRL_STRIP.sub("", cleaned)
    return _process_backspace(cleaned)


# Internal alias kept for backward compat within this module
_strip_ansi = strip_ansi


def open_session(server: Server) -> SessionHandle:
    """Open an SSH connection, invoke a PTY shell, and drain the initial prompt."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs: dict = {
        "hostname": server.hostname,
        "port": server.ssh_port,
        "username": server.ssh_username,
        "timeout": 30,
    }

    if server.ssh_private_key:
        connect_kwargs["pkey"] = _load_pkey_from_content(server.ssh_private_key)
    elif server.ssh_password:
        connect_kwargs["password"] = server.ssh_password

    try:
        client.connect(**connect_kwargs)
    except paramiko.AuthenticationException as exc:
        raise RuntimeError(f"SSH auth failed for {server.hostname}: {exc}") from exc
    except paramiko.SSHException as exc:
        raise RuntimeError(f"SSH connection error for {server.hostname}: {exc}") from exc

    channel = client.invoke_shell(term="xterm", width=220, height=50)

    # Drain the initial shell prompt so it does not bleed into the first command output.
    deadline = time.monotonic() + _INITIAL_PROMPT_DRAIN_TIMEOUT
    while time.monotonic() < deadline:
        if channel.recv_ready():
            channel.recv(4096)
        time.sleep(_INITIAL_PROMPT_SETTLE_SLEEP)
        if not channel.recv_ready():
            break

    # Inject PROMPT_COMMAND so every command completion is timestamped with an
    # __PS1__<ms>__<exit_code>__ marker. This enables parse_pty_commands() later.
    channel.sendall(f"{_PROMPT_COMMAND}\n".encode())
    time.sleep(0.3)
    drain_deadline = time.monotonic() + 1.0
    while time.monotonic() < drain_deadline:
        if channel.recv_ready():
            channel.recv(4096)
        else:
            break

    logger.info("PTY session opened for server %s", server.id)
    return SessionHandle(client=client, channel=channel)


def execute_command(
    channel: paramiko.Channel,
    command: str,
    timeout: float = 60.0,
) -> tuple[str, str, int]:
    """Run a command inside an existing PTY shell using the sentinel pattern.

    Returns:
        (stdout, stderr, exit_code) -- stderr is always empty string (PTY merges streams).
    """
    sentinel_id = uuid.uuid4().hex
    exit_marker = f"__DONE_{sentinel_id}__"

    channel.sendall(f"{command}\n".encode())
    channel.sendall(f"echo {exit_marker}_$?\n".encode())

    buffer = b""
    deadline = time.monotonic() + timeout
    marker_pattern = re.compile(re.escape(exit_marker) + r"_(\d+)")

    while time.monotonic() < deadline:
        if channel.recv_ready():
            chunk = channel.recv(4096)
            buffer += chunk
            decoded = buffer.decode(errors="replace")
            if marker_pattern.search(decoded):
                break
        else:
            time.sleep(0.02)
    else:
        # Graceful recovery: interrupt the foreground process, then re-queue
        # the sentinel so the shell runs it once it returns to the prompt.
        channel.sendall(b"\x03")  # Ctrl+C → SIGINT to foreground process
        time.sleep(0.15)
        channel.sendall(f"echo {exit_marker}_124\n".encode())
        recover_deadline = time.monotonic() + 3.0
        while time.monotonic() < recover_deadline:
            if channel.recv_ready():
                buffer += channel.recv(4096)
                if marker_pattern.search(buffer.decode(errors="replace")):
                    break
            else:
                time.sleep(0.05)
        logger.warning("Command timed out after %ss, interrupted: %r", timeout, command)

    # Drain any remaining bytes briefly.
    drain_deadline = time.monotonic() + 0.2
    while time.monotonic() < drain_deadline:
        if channel.recv_ready():
            buffer += channel.recv(4096)
        else:
            time.sleep(0.02)

    raw = buffer.decode(errors="replace")
    raw = _strip_ansi(raw)
    raw = raw.replace(chr(13) + chr(10), chr(10)).replace(chr(13), chr(10))

    lines = raw.split(chr(10))

    # Line 0 is the echoed command itself -- skip it.
    lines = lines[1:]

    echo_line = f"echo {exit_marker}_"
    match = marker_pattern.search(chr(10).join(lines))
    exit_code = int(match.group(1)) if match else 1

    filtered = [
        line for line in lines
        if exit_marker not in line and echo_line not in line
    ]

    stdout = chr(10).join(filtered).strip()
    return stdout, "", exit_code


def parse_pty_commands(pty_log: str) -> list[dict]:
    """Parse PS1 boundary markers from a PTY log into discrete command records.

    Requires that PROMPT_COMMAND was injected by open_session() (sessions started
    after this version will have markers; older sessions return an empty list).

    Each record: {command, output, started_ms, completed_ms, duration_ms, exit_code}
    """
    markers = list(_PS1_RE.finditer(pty_log))
    if len(markers) < 2:
        return []

    commands: list[dict] = []
    for i in range(len(markers) - 1):
        start_m = markers[i]
        end_m = markers[i + 1]

        started_ms = int(start_m.group(1))
        completed_ms = int(end_m.group(1))
        # exit_code in the END marker is the exit code of the command in THIS block
        exit_code = int(end_m.group(2))
        duration_ms = max(0, completed_ms - started_ms)

        block = pty_log[start_m.end():end_m.start()]
        # Strip ANSI escape sequences and process backspace/control chars so stored
        # commands and output are human-readable, not raw PTY bytes.
        block = strip_ansi(block).strip()
        block = block.replace("\r\n", "\n").replace("\r", "\n")
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue

        # Strip shell prompt prefix (e.g. "root@host:~# ", "user@host:~$ ") from first line
        first = lines[0].strip()
        command = re.sub(r"^[^#$]*[#$]\s+", "", first).strip()
        # Skip the PROMPT_COMMAND setup line itself
        if not command or command.startswith("export PROMPT_COMMAND"):
            continue

        output = "\n".join(lines[1:]).strip()
        commands.append(
            {
                "command": command,
                "output": output,
                "started_ms": started_ms,
                "completed_ms": completed_ms,
                "duration_ms": duration_ms,
                "exit_code": exit_code,
            }
        )

    return commands


def close_session(handle: SessionHandle) -> None:
    """Close the PTY channel and underlying SSH client."""
    try:
        handle.channel.close()
    except Exception:
        pass
    try:
        handle.client.close()
    except Exception:
        pass
    logger.info("PTY session closed")
