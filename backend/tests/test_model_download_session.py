"""Tests for DownloadSession state machine."""

from __future__ import annotations

import time

import pytest

from app.services.model_download.session import DownloadSession, FileProgress


def _make_session(n_files: int = 3) -> DownloadSession:
    s = DownloadSession(download_id="test-id", repo_id="org/model")
    s.files = [FileProgress(filename=f"file_{i}.bin", size=1_000_000) for i in range(n_files)]
    return s


# ── on_chunk ──────────────────────────────────────────────────────────────────


def test_on_chunk_updates_downloaded():
    """on_chunk must set downloaded bytes and expand size if needed."""
    s = _make_session()
    s.on_chunk(0, 512_000, 1_000_000)

    assert s.files[0].downloaded == 512_000
    assert s.files[0].size == 1_000_000


def test_on_chunk_expands_size():
    """on_chunk must update size when the reported total is larger."""
    s = _make_session()
    s.on_chunk(0, 100_000, 2_000_000)  # total larger than initial
    assert s.files[0].size == 2_000_000


# ── emit throttle ─────────────────────────────────────────────────────────────


def test_emit_throttled_within_interval():
    """Two emit(force=False) calls within 150 ms must enqueue at most one event."""
    s = _make_session()
    # Prime the clock so next emit is not throttle-exempt
    s._last_emit_at = time.monotonic()

    s.emit(force=False)
    s.emit(force=False)

    count = 0
    while not s.events.empty():
        s.events.get_nowait()
        count += 1

    assert count <= 1


def test_force_emit_always_enqueues():
    """emit(force=True) must always enqueue even if called immediately after."""
    s = _make_session()
    s._last_emit_at = time.monotonic()

    s.emit(force=True)
    s.emit(force=True)

    assert s.events.qsize() == 2


def test_subscribers_each_receive_forced_emit():
    """Each SSE client gets its own event copy instead of racing one shared queue."""
    s = _make_session()
    q1 = s.subscribe()
    q2 = s.subscribe()
    try:
        s.emit(force=True)

        assert q1.get_nowait()["download_id"] == s.download_id
        assert q2.get_nowait()["download_id"] == s.download_id
    finally:
        s.unsubscribe(q1)
        s.unsubscribe(q2)


def test_unsubscribe_stops_future_events():
    s = _make_session()
    q = s.subscribe()
    s.unsubscribe(q)

    s.emit(force=True)

    assert q.empty()


# ── finish_file ───────────────────────────────────────────────────────────────


def test_finish_file_ok_sets_completed():
    s = _make_session()
    s.files[0].status = "downloading"
    s.files[0].downloaded = 500_000
    s.finish_file(0, ok=True)

    assert s.files[0].status == "completed"
    # downloaded should snap to size on success
    assert s.files[0].downloaded == s.files[0].size


def test_finish_file_failed_sets_error():
    s = _make_session()
    s.finish_file(1, ok=False, error="403 gated")

    assert s.files[1].status == "failed"
    assert s.files[1].error == "403 gated"


# ── finish ────────────────────────────────────────────────────────────────────


def test_finish_enqueues_complete_event():
    s = _make_session()
    s.finish(error="")

    assert s.finished_at is not None
    # Drain queue and find the complete event
    events = []
    while not s.events.empty():
        events.append(s.events.get_nowait())

    complete_events = [e for e in events if e.get("event_type") == "complete"]
    assert len(complete_events) == 1


def test_finish_with_error_recorded():
    s = _make_session()
    s.finish(error="disk full")

    assert s.error == "disk full"


# ── snapshot ──────────────────────────────────────────────────────────────────


def test_snapshot_percent_correct():
    """Snapshot percent must reflect downloaded / total."""
    s = _make_session(n_files=2)
    s.files[0].status = "completed"
    s.files[0].downloaded = 1_000_000
    s.files[1].status = "pending"
    s.files[1].downloaded = 0

    snap = s.snapshot()
    assert snap["downloaded"] == 1_000_000
    assert snap["total"] == 2_000_000
    assert snap["percent"] == 50.0


def test_snapshot_excludes_cached_from_speed():
    """avg_speed_mbps must not count cached files' bytes."""
    s = _make_session(n_files=2)
    # file 0: cached (not counted in speed)
    s.files[0].status = "cached"
    s.files[0].downloaded = 1_000_000
    # file 1: actively downloading
    s.files[1].status = "downloading"
    s.files[1].downloaded = 500_000

    # Force elapsed to be 1 second
    s.started_at = time.monotonic() - 1.0

    snap = s.snapshot()
    # Only file_1's 500_000 bytes at ~1s = ~0.5 MB/s; cached should not add 1 MB/s
    assert snap["avg_speed_mbps"] < 1.0


def test_snapshot_zero_total_no_crash():
    """Snapshot must not raise ZeroDivisionError when total_size is 0."""
    s = DownloadSession(download_id="x", repo_id="org/model")  # no files
    snap = s.snapshot()
    assert snap["percent"] == 0.0
    assert snap["avg_speed_mbps"] == 0.0
