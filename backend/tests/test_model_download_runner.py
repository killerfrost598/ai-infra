"""Tests for model_download runner with stubbed SSH transport."""

from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import dataclass
from io import BytesIO

import pytest

from app.services.model_download.session import DownloadSession, FileProgress
from app.services.model_download.runner import _dispatch, attach, _SESSIONS, _SESSIONS_LOCK


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_session(download_id: str = "test::dl::123") -> DownloadSession:
    s = DownloadSession(download_id=download_id, repo_id="org/model")
    with _SESSIONS_LOCK:
        _SESSIONS[download_id] = s
    return s


def _cleanup(download_id: str) -> None:
    with _SESSIONS_LOCK:
        _SESSIONS.pop(download_id, None)


# ── _dispatch unit tests ──────────────────────────────────────────────────────


class TestDispatch:
    def setup_method(self):
        self.s = DownloadSession(download_id="d1", repo_id="r1")

    def test_start_populates_files(self):
        ev = {
            "t": "start",
            "files": [
                {"name": "a.safetensors", "size": 1000, "cached": False},
                {"name": "config.json", "size": 100, "cached": True},
            ],
        }
        _dispatch(self.s, ev)
        assert len(self.s.files) == 2
        assert self.s.files[0].filename == "a.safetensors"
        assert self.s.files[1].status == "cached"

    def test_file_start_sets_downloading(self):
        self.s.files = [FileProgress(filename="f.bin", size=500)]
        _dispatch(self.s, {"t": "file_start", "i": 0})
        assert self.s.files[0].status == "downloading"

    def test_chunk_updates_bytes(self):
        self.s.files = [FileProgress(filename="f.bin", size=1000)]
        _dispatch(self.s, {"t": "chunk", "i": 0, "downloaded": 400, "total": 1000})
        assert self.s.files[0].downloaded == 400

    def test_file_done_ok(self):
        self.s.files = [FileProgress(filename="f.bin", size=1000, status="downloading")]
        _dispatch(self.s, {"t": "file_done", "i": 0, "ok": True})
        assert self.s.files[0].status == "completed"

    def test_file_done_error(self):
        self.s.files = [FileProgress(filename="f.bin", size=1000, status="downloading")]
        _dispatch(self.s, {"t": "file_done", "i": 0, "ok": False, "error": "403 gated"})
        assert self.s.files[0].status == "failed"
        assert self.s.files[0].error == "403 gated"

    def test_done_finishes_session(self):
        _dispatch(self.s, {"t": "done", "error": ""})
        assert self.s.finished_at is not None
        assert self.s.error == ""

    def test_done_with_error(self):
        _dispatch(self.s, {"t": "done", "error": "disk full"})
        assert self.s.error == "disk full"

    def test_out_of_bounds_index_ignored(self):
        """Dispatching chunk for non-existent file index must not raise."""
        _dispatch(self.s, {"t": "chunk", "i": 99, "downloaded": 100, "total": 200})

    def test_bad_event_type_ignored(self):
        """Unknown event types must not raise."""
        _dispatch(self.s, {"t": "unknown_event", "data": 42})


# ── Simulate full NDJSON stream ───────────────────────────────────────────────


def _replay_ndjson(session: DownloadSession, lines: list[str]) -> None:
    """Feed a canned NDJSON stream into the session the same way the thread does."""
    got_done = False
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        _dispatch(session, ev)
        if ev.get("t") == "done":
            got_done = True

    if not got_done:
        session.finish(error="stream ended without done")


CANNED_STREAM = [
    json.dumps({"t": "start", "files": [
        {"name": "model.safetensors", "size": 5_000_000, "cached": False},
        {"name": "config.json", "size": 1000, "cached": True},
    ]}),
    json.dumps({"t": "file_start", "i": 0}),
    json.dumps({"t": "chunk", "i": 0, "downloaded": 2_500_000, "total": 5_000_000}),
    json.dumps({"t": "chunk", "i": 0, "downloaded": 5_000_000, "total": 5_000_000}),
    json.dumps({"t": "file_done", "i": 0, "ok": True}),
    json.dumps({"t": "file_start", "i": 1}),
    json.dumps({"t": "file_done", "i": 1, "ok": True}),
    json.dumps({"t": "done", "error": ""}),
]


def test_full_stream_session_finishes():
    dl_id = "test::full::001"
    s = _make_session(dl_id)
    try:
        _replay_ndjson(s, CANNED_STREAM)

        assert s.finished_at is not None
        assert s.error == ""
        assert all(f.status in ("completed", "cached") for f in s.files)
    finally:
        _cleanup(dl_id)


def test_full_stream_emits_progress_and_complete():
    """At least one progress event and exactly one complete event must be enqueued."""
    dl_id = "test::full::002"
    s = _make_session(dl_id)
    try:
        _replay_ndjson(s, CANNED_STREAM)

        events = []
        while not s.events.empty():
            events.append(s.events.get_nowait())

        progress = [e for e in events if e.get("event_type") == "progress"]
        complete = [e for e in events if e.get("event_type") == "complete"]

        assert len(progress) >= 1, "Expected at least one progress event"
        assert len(complete) == 1, "Expected exactly one complete event"
    finally:
        _cleanup(dl_id)


def test_attach_returns_session():
    dl_id = "test::attach::001"
    s = _make_session(dl_id)
    try:
        result = attach(dl_id)
        assert result is s
    finally:
        _cleanup(dl_id)


def test_attach_missing_returns_none():
    assert attach("nonexistent::id") is None


def test_attach_finished_returns_snapshot_with_complete():
    """Finished session attached via SSE should immediately return complete."""
    dl_id = "test::attach::002"
    s = _make_session(dl_id)
    s.files = [FileProgress(filename="f.bin", size=100, status="completed", downloaded=100)]
    s.finish(error="")
    try:
        session = attach(dl_id)
        assert session is not None
        assert session.finished_at is not None

        # Simulate SSE generator: first check finished_at
        snap = session.snapshot()
        assert snap["finished"] is True
    finally:
        _cleanup(dl_id)


def test_stream_with_parse_error_lines_skipped():
    """Malformed NDJSON lines must be skipped without crashing."""
    dl_id = "test::parse::001"
    s = _make_session(dl_id)
    try:
        bad_stream = [
            json.dumps({"t": "start", "files": [{"name": "f.bin", "size": 100, "cached": False}]}),
            "NOT JSON {{{{",
            "",
            json.dumps({"t": "file_start", "i": 0}),
            json.dumps({"t": "file_done", "i": 0, "ok": True}),
            json.dumps({"t": "done", "error": ""}),
        ]
        _replay_ndjson(s, bad_stream)
        assert s.finished_at is not None
        assert s.files[0].status == "completed"
    finally:
        _cleanup(dl_id)
