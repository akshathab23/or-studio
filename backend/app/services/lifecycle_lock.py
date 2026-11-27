from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import os
from pathlib import Path
import threading
import time

if os.name == "nt":
    import msvcrt
else:
    import fcntl

DEFAULT_LOCK_TIMEOUT_SECONDS = 10.0

_THREAD_LOCKS_GUARD = threading.Lock()
_THREAD_LOCKS: dict[Path, threading.Lock] = {}


class LifecycleLockError(RuntimeError):
    """Raised when the cross-process dataset/scenario lifecycle lock cannot be acquired."""


def get_lifecycle_lock_timeout_seconds() -> float:
    raw = os.getenv("OR_STUDIO_LIFECYCLE_LOCK_TIMEOUT_SECONDS", "").strip()
    if raw:
        try:
            val = float(raw)
            if val > 0:
                return val
        except ValueError:
            pass
    return DEFAULT_LOCK_TIMEOUT_SECONDS


def _get_data_dir() -> Path:
    override = os.getenv("OR_STUDIO_DATA_DIR", "").strip()
    if override:
        path = Path(override)
    else:
        path = Path(__file__).resolve().parents[2] / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_lifecycle_lock_path() -> Path:
    return _get_data_dir().resolve() / ".or_studio_lifecycle.lock"


def _get_thread_lock(lock_path: Path) -> threading.Lock:
    with _THREAD_LOCKS_GUARD:
        lock = _THREAD_LOCKS.get(lock_path)
        if lock is None:
            lock = threading.Lock()
            _THREAD_LOCKS[lock_path] = lock
        return lock


def _try_acquire_os_lock(fd: int) -> bool:
    if os.name == "nt":
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False
    else:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False


def _release_os_lock(fd: int) -> None:
    if os.name == "nt":
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
    else:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass


@contextmanager
def lifecycle_lock(timeout_seconds: float | None = None) -> Iterator[None]:
    """
    Cross-process and intra-process exclusive lock protecting critical
    dataset/scenario reference lifecycle operations.

    Lock Acquisition Order (to prevent deadlocks):
      1. lifecycle_lock (this lock)
      2. scenario_service._DB_LOCK / dataset_service._DB_LOCK
      3. dataset_service._CACHE_LOCK

    Never acquire lifecycle_lock while holding _DB_LOCK or _CACHE_LOCK.
    """
    timeout = timeout_seconds if timeout_seconds is not None else get_lifecycle_lock_timeout_seconds()
    lock_path = get_lifecycle_lock_path()
    thread_lock = _get_thread_lock(lock_path)
    deadline = time.monotonic() + max(0.001, timeout)

    if not thread_lock.acquire(timeout=max(0.001, timeout)):
        raise LifecycleLockError(
            "Timed out waiting for intra-process dataset lifecycle lock."
        )

    fd: int | None = None
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
        if os.fstat(fd).st_size == 0:
            os.write(fd, b"\0")

        while not _try_acquire_os_lock(fd):
            if time.monotonic() >= deadline:
                raise LifecycleLockError(
                    "Timed out waiting for cross-process dataset lifecycle lock."
                )
            time.sleep(0.02)

        try:
            yield
        finally:
            _release_os_lock(fd)
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        thread_lock.release()
