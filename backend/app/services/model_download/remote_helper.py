"""Remote helper script — embedded as a string, uploaded and executed on the GPU server."""

from __future__ import annotations

# This script is written to ~/.inferix/downloads/helper_<download_id>.py on the remote
# server and executed with explicit CLI args. It streams NDJSON to stdout AND tees to
# a local file so the backend can reattach after restarts.
REMOTE_HELPER_SCRIPT: str = r'''
#!/usr/bin/env python3
"""Per-file HuggingFace downloader with NDJSON progress stream.

Usage:
  python3 helper_<id>.py \
    --repo-id <repo> \
    --download-id <id> \
    --cache-dir <path> \
    --exact-file <name> [--exact-file ...] \
    --allow-pattern <glob> [--allow-pattern ...] \
    --ndjson-out <path>
"""

from __future__ import annotations

import argparse
import errno
import fnmatch
import json
import os
import sys
import time
from pathlib import Path

_EMIT_INTERVAL = 0.15  # seconds between chunk events


def _emit(obj: dict, ndjson_fh) -> None:
    line = json.dumps(obj)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()
    if ndjson_fh:
        ndjson_fh.write(line + "\n")
        ndjson_fh.flush()


def _is_cancel_requested(cancel_path: Path) -> bool:
    return cancel_path.exists()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--download-id", required=True)
    parser.add_argument("--cache-dir", default=str(Path.home() / ".cache" / "huggingface"))
    parser.add_argument("--exact-file", action="append", default=[])
    parser.add_argument("--allow-pattern", action="append", default=[])
    parser.add_argument("--ndjson-out", required=True)
    args = parser.parse_args()

    repo_id: str = args.repo_id
    download_id: str = args.download_id
    cache_dir: str = args.cache_dir
    exact_files: list[str] = args.exact_file
    allow_patterns: list[str] = args.allow_pattern
    ndjson_out: str = args.ndjson_out
    token: str | None = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

    cancel_path = Path(ndjson_out).parent / f"{download_id}.cancel"
    Path(ndjson_out).parent.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import HfApi, hf_hub_download, try_to_load_from_cache
        from tqdm.auto import tqdm
    except ImportError as exc:
        # Write direct — ndjson file may not be open yet
        msg = json.dumps({"t": "done", "error": f"venv missing huggingface_hub: {exc}"})
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()
        try:
            Path(ndjson_out).parent.mkdir(parents=True, exist_ok=True)
            with open(ndjson_out, "a") as f:
                f.write(msg + "\n")
        except Exception:
            pass
        return 1

    api = HfApi(token=token)

    ndjson_fh = None
    try:
        ndjson_fh = open(ndjson_out, "a", buffering=1)

        # Resolve file list
        try:
            info = api.model_info(repo_id, files_metadata=True)
        except Exception as exc:
            _emit({"t": "done", "error": f"model_info failed: {exc}"}, ndjson_fh)
            return 1

        siblings = info.siblings or []

        def _matches(rfilename: str) -> bool:
            if rfilename in exact_files:
                return True
            return any(fnmatch.fnmatch(rfilename, p) for p in allow_patterns)

        matched: list[dict] = []
        for sib in siblings:
            name = sib.rfilename
            if not _matches(name):
                continue
            size = sib.size or 0
            cached_path = try_to_load_from_cache(
                repo_id=repo_id, filename=name, cache_dir=cache_dir
            )
            is_cached = isinstance(cached_path, str) and Path(cached_path).is_file()
            matched.append({"name": name, "size": size, "cached": is_cached})

        # Sort: cached first, then by name
        matched.sort(key=lambda f: (not f["cached"], f["name"]))

        _emit({"t": "start", "files": matched}, ndjson_fh)

        class FileTqdm(tqdm):
            _last_emit: float = 0.0
            _file_index: int = -1
            _ndjson_fh = None

            def update(self, n: int = 1) -> bool | None:
                ret = super().update(n)
                now = time.monotonic()
                idx = FileTqdm._file_index
                if idx >= 0 and (now - FileTqdm._last_emit >= _EMIT_INTERVAL or self.n == self.total):
                    FileTqdm._last_emit = now
                    _emit(
                        {"t": "chunk", "i": idx, "downloaded": self.n or 0, "total": self.total or 0},
                        FileTqdm._ndjson_fh,
                    )
                return ret

        FileTqdm._ndjson_fh = ndjson_fh

        for i, finfo in enumerate(matched):
            if _is_cancel_requested(cancel_path):
                _emit({"t": "done", "error": "cancelled"}, ndjson_fh)
                return 0

            if finfo["cached"]:
                _emit({"t": "file_start", "i": i}, ndjson_fh)
                _emit({"t": "file_done", "i": i, "ok": True}, ndjson_fh)
                continue

            _emit({"t": "file_start", "i": i}, ndjson_fh)
            FileTqdm._file_index = i
            FileTqdm._last_emit = 0.0

            try:
                hf_hub_download(
                    repo_id=repo_id,
                    filename=finfo["name"],
                    cache_dir=cache_dir,
                    token=token,
                    tqdm_class=FileTqdm,
                )
                _emit({"t": "file_done", "i": i, "ok": True}, ndjson_fh)
            except OSError as exc:
                if exc.errno == errno.ENOSPC:
                    _emit({"t": "done", "error": f"disk full: {exc}"}, ndjson_fh)
                    return 1
                _emit({"t": "file_done", "i": i, "ok": False, "error": str(exc)}, ndjson_fh)
            except Exception as exc:  # noqa: BLE001
                error_str = str(exc)
                # Retry once with resume for connection errors
                if any(k in error_str.lower() for k in ("connection", "timeout", "network")):
                    try:
                        hf_hub_download(
                            repo_id=repo_id,
                            filename=finfo["name"],
                            cache_dir=cache_dir,
                            token=token,
                            tqdm_class=FileTqdm,
                            resume_download=True,
                        )
                        _emit({"t": "file_done", "i": i, "ok": True}, ndjson_fh)
                        continue
                    except Exception as exc2:  # noqa: BLE001
                        error_str = str(exc2)
                _emit({"t": "file_done", "i": i, "ok": False, "error": error_str}, ndjson_fh)

        _emit({"t": "done", "error": ""}, ndjson_fh)
        return 0

    finally:
        if ndjson_fh:
            try:
                ndjson_fh.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
'''
