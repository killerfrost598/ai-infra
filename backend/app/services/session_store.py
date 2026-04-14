"""Thread-safe in-process store mapping session_id -> SessionHandle."""

from __future__ import annotations

import threading
from typing import NamedTuple

import paramiko


class SessionHandle(NamedTuple):
    client: paramiko.SSHClient
    channel: paramiko.Channel


_lock = threading.Lock()
_store: dict[str, SessionHandle] = {}
_pty_active: set[str] = set()  # session_ids that have an open WebSocket PTY connection


def put(session_id: str, handle: SessionHandle) -> None:
    """Register a handle for the given session_id."""
    with _lock:
        _store[session_id] = handle


def get(session_id: str) -> SessionHandle | None:
    """Return the handle for session_id, or None if not present."""
    with _lock:
        return _store.get(session_id)


def remove(session_id: str) -> SessionHandle | None:
    """Remove and return the handle for session_id, or None if not present."""
    with _lock:
        return _store.pop(session_id, None)


def mark_pty_active(session_id: str) -> None:
    """Record that a WebSocket PTY connection is open for this session."""
    with _lock:
        _pty_active.add(session_id)


def clear_pty_active(session_id: str) -> None:
    """Remove the active PTY marker for this session."""
    with _lock:
        _pty_active.discard(session_id)


def is_pty_active(session_id: str) -> bool:
    """Return True if a WebSocket PTY connection is currently open."""
    with _lock:
        return session_id in _pty_active
