"""DownloadSession: in-process state machine + SSE event queue for one download job."""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Literal

EVENT_THROTTLE_INTERVAL = 0.15  # seconds — minimum gap between non-forced SSE events

FileStatus = Literal["cached", "pending", "downloading", "completed", "failed"]


@dataclass
class FileProgress:
    filename: str
    size: int = 0
    status: FileStatus = "pending"
    downloaded: int = 0
    error: str = ""

    @property
    def percent(self) -> float:
        if self.size <= 0:
            return 100.0 if self.status in ("completed", "cached") else 0.0
        return min(100.0, (self.downloaded / self.size) * 100.0)

    def to_dict(self) -> dict:
        return {
            "filename": self.filename,
            "size": self.size,
            "size_mb": round(self.size / 1e6, 2),
            "status": self.status,
            "downloaded": self.downloaded,
            "downloaded_mb": round(self.downloaded / 1e6, 2),
            "percent": round(self.percent, 1),
            "error": self.error,
        }


@dataclass
class DownloadSession:
    """Owns canonical state of one in-flight download and produces SSE events."""

    download_id: str
    repo_id: str
    files: list[FileProgress] = field(default_factory=list)
    current_file_index: int = -1
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    error: str = ""
    events: queue.Queue = field(default_factory=queue.Queue)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _event_lock: threading.Lock = field(default_factory=threading.Lock)
    _subscribers: set[queue.Queue] = field(default_factory=set, repr=False)
    _last_emit_at: float = 0.0

    # ── file lifecycle ────────────────────────────────────────────────────────

    def start_file(self, index: int) -> None:
        with self._lock:
            self.current_file_index = index
            f = self.files[index]
            if f.status != "cached":
                f.status = "downloading"
        self.emit(force=True)

    def finish_file(self, index: int, *, ok: bool, error: str = "") -> None:
        with self._lock:
            f = self.files[index]
            if ok:
                f.status = "completed"
                f.downloaded = f.size or f.downloaded
            else:
                f.status = "failed"
                f.error = error
        self.emit(force=True)

    def on_chunk(self, index: int, current_bytes: int, total_bytes: int) -> None:
        with self._lock:
            f = self.files[index]
            f.downloaded = current_bytes
            if total_bytes and total_bytes > f.size:
                f.size = total_bytes
        self.emit(force=False)

    def finish(self, error: str = "") -> None:
        with self._lock:
            self.finished_at = time.monotonic()
            self.error = error
        self.emit(force=True, terminal=True)

    # ── aggregate metrics ─────────────────────────────────────────────────────

    def snapshot(self) -> dict:
        with self._lock:
            total_size = sum(f.size for f in self.files)
            downloaded = sum(
                f.size if f.status in ("completed", "cached") else f.downloaded
                for f in self.files
            )
            elapsed = (
                (self.finished_at or time.monotonic()) - self.started_at
                if self.started_at
                else 0.0
            )
            # Speed counts only bytes actually transferred this run (not cached)
            new_bytes = sum(
                f.size if f.status == "completed" else f.downloaded
                for f in self.files
                if f.status not in ("cached", "pending")
            )
            avg_speed_mbps = (new_bytes / 1e6) / elapsed if elapsed > 0.1 else 0.0
            remaining = max(0, total_size - downloaded)
            eta_seconds = (remaining / 1e6) / avg_speed_mbps if avg_speed_mbps > 0.1 else 0.0
            return {
                "event_type": "progress",
                "download_id": self.download_id,
                "repo_id": self.repo_id,
                "files": [f.to_dict() for f in self.files],
                "file_index": max(self.current_file_index + 1, 0),
                "total_files": len(self.files),
                "downloaded": downloaded,
                "downloaded_mb": round(downloaded / 1e6, 2),
                "total": total_size,
                "total_mb": round(total_size / 1e6, 2),
                "percent": round((downloaded / total_size) * 100, 2) if total_size else 0.0,
                "avg_speed_mbps": round(avg_speed_mbps, 2),
                "elapsed": round(elapsed, 1),
                "eta_seconds": round(eta_seconds, 1),
                "finished": self.finished_at is not None,
                "error": self.error,
            }

    def emit(self, *, force: bool, terminal: bool = False) -> None:
        now = time.monotonic()
        with self._event_lock:
            if not force and (now - self._last_emit_at) < EVENT_THROTTLE_INTERVAL:
                return
            self._last_emit_at = now
        snap = self.snapshot()
        if terminal:
            snap["event_type"] = "complete"
        self.events.put(snap)
        with self._event_lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            self._put_latest(subscriber, snap)

    def subscribe(self) -> queue.Queue:
        """Return a per-client event queue for future emissions."""
        event_queue: queue.Queue = queue.Queue(maxsize=100)
        with self._event_lock:
            self._subscribers.add(event_queue)
        return event_queue

    def unsubscribe(self, event_queue: queue.Queue) -> None:
        with self._event_lock:
            self._subscribers.discard(event_queue)

    @staticmethod
    def _put_latest(event_queue: queue.Queue, event: dict) -> None:
        try:
            event_queue.put_nowait(event)
            return
        except queue.Full:
            pass

        try:
            event_queue.get_nowait()
        except queue.Empty:
            pass

        try:
            event_queue.put_nowait(event)
        except queue.Full:
            pass
