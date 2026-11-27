from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import uuid

from fastapi import HTTPException
import pytest

from app.main import api_cleanup_datasets, api_create_scenario, api_delete_dataset
from app.schemas import (
    MultiPeriodColumnMapping,
    ScenarioCreateRequest,
    ScenarioInputConfig,
)
from app.services import dataset_service, scenario_service
from app.services.dataset_service import (
    DatasetCleanupDisabledError,
    cleanup_unreferenced_datasets,
    clear_dataset_cache,
    get_dataset,
    get_dataset_cache_size,
    get_retention_config,
    upload_dataset,
)
from app.services.lifecycle_lock import LifecycleLockError, lifecycle_lock


@pytest.fixture
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OR_STUDIO_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("OR_STUDIO_SCENARIO_DB", raising=False)
    monkeypatch.delenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", raising=False)
    monkeypatch.delenv("OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS", raising=False)
    monkeypatch.delenv("OR_STUDIO_MAX_DATASET_STORAGE_MB", raising=False)
    monkeypatch.delenv("OR_STUDIO_MIN_DATASET_AGE_MINUTES", raising=False)
    monkeypatch.delenv("OR_STUDIO_TEMP_FILE_GRACE_MINUTES", raising=False)
    clear_dataset_cache()
    yield tmp_path
    clear_dataset_cache()


def _set_dataset_timestamps(data_dir: Path, dataset_id: str, hours_ago: float) -> None:
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
    conn = sqlite3.connect(data_dir / "or_studio_datasets.db")
    try:
        conn.execute(
            "UPDATE datasets SET created_at = ?, last_accessed_at = ? WHERE dataset_id = ?",
            (ts, ts, dataset_id),
        )
        conn.commit()
    finally:
        conn.close()


def _set_file_mtime(path: Path, minutes_ago: float) -> None:
    target = time.time() - (minutes_ago * 60.0)
    os.utime(path, (target, target))


def test_retention_config_defaults_and_invalid_values(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    cfg, warnings = get_retention_config()
    assert cfg["cleanup_enabled"] is False
    assert cfg["ttl_hours"] == 0.0
    assert cfg["max_storage_mb"] == 0.0
    assert cfg["min_dataset_age_minutes"] == 60.0
    assert cfg["temp_file_grace_minutes"] == 15.0
    assert warnings == []

    monkeypatch.setenv("OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS", "-5")
    monkeypatch.setenv("OR_STUDIO_MAX_DATASET_STORAGE_MB", "not-a-number")
    cfg2, warnings2 = get_retention_config()
    assert cfg2["ttl_hours"] == 0.0
    assert cfg2["max_storage_mb"] == 0.0
    assert len(warnings2) == 2


def test_cleanup_execution_disabled_by_default_and_api_403(isolated_env: Path):
    with pytest.raises(DatasetCleanupDisabledError):
        cleanup_unreferenced_datasets(dry_run=False)

    with pytest.raises(HTTPException) as exc:
        api_cleanup_datasets(dry_run=False)
    assert exc.value.status_code == 403

    # Default dry_run=True is allowed
    rep = api_cleanup_datasets(dry_run=True)
    assert rep.dry_run is True
    assert rep.cleanup_enabled is False


def test_dry_run_and_ttl_cleanup_with_reference_and_recent_exemptions(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS", "24")
    monkeypatch.setenv("OR_STUDIO_MIN_DATASET_AGE_MINUTES", "60")
    monkeypatch.setenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", "true")

    ds_expired = upload_dataset("expired.csv", b"product,period,demand\nA,P1,10\n")
    ds_ref = upload_dataset("referenced.csv", b"product,period,demand\nB,P1,20\n")
    ds_recent = upload_dataset("recent.csv", b"product,period,demand\nC,P1,30\n")

    _set_dataset_timestamps(isolated_env, ds_expired.dataset_id, hours_ago=48)
    _set_dataset_timestamps(isolated_env, ds_ref.dataset_id, hours_ago=48)
    # ds_recent remains fresh (< 60 minutes)

    mapping = MultiPeriodColumnMapping(product="product", period="period", demand="demand")
    api_create_scenario(
        ScenarioCreateRequest(
            name="Protect Referenced",
            dataset_id=ds_ref.dataset_id,
            dataset_name=ds_ref.filename,
            input_config=ScenarioInputConfig(mapping=mapping),
        )
    )

    # Dry run reports candidate without mutating disk, DB, or cache
    dry = cleanup_unreferenced_datasets(dry_run=True)
    assert dry.dry_run is True
    assert dry.datasets_scanned == 3
    assert dry.eligible_datasets == [ds_expired.dataset_id]
    assert dry.datasets_deleted == []
    assert dry.bytes_freed == 0
    assert ds_ref.dataset_id in dry.referenced_datasets_skipped
    assert ds_recent.dataset_id in dry.recent_datasets_skipped
    assert (isolated_env / "datasets" / f"{ds_expired.dataset_id}.csv").exists()
    assert get_dataset_cache_size() == 3

    # Execute cleanup
    executed = cleanup_unreferenced_datasets(dry_run=False)
    assert executed.dry_run is False
    assert executed.datasets_deleted == [ds_expired.dataset_id]
    assert executed.bytes_freed > 0
    assert not (isolated_env / "datasets" / f"{ds_expired.dataset_id}.csv").exists()
    assert (isolated_env / "datasets" / f"{ds_ref.dataset_id}.csv").exists()
    assert (isolated_env / "datasets" / f"{ds_recent.dataset_id}.csv").exists()

    # Cache invalidated only for deleted dataset, protected datasets remain cached
    assert get_dataset_cache_size() == 2
    with pytest.raises(KeyError):
        get_dataset(ds_expired.dataset_id)
    assert len(get_dataset(ds_ref.dataset_id).df) == 1
    assert len(get_dataset(ds_recent.dataset_id).df) == 1


def test_quota_cleanup_ordering_and_soft_quota_protection(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS", "0")
    monkeypatch.setenv("OR_STUDIO_MIN_DATASET_AGE_MINUTES", "60")
    monkeypatch.setenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", "true")

    # ~100 bytes each
    payload = ("product,period,demand\n" + "A,P1,10\n" * 10).encode("utf-8")
    ds_oldest = upload_dataset("oldest.csv", payload)
    ds_newer = upload_dataset("newer.csv", payload)
    ds_ref = upload_dataset("ref.csv", payload)

    _set_dataset_timestamps(isolated_env, ds_oldest.dataset_id, hours_ago=10)
    _set_dataset_timestamps(isolated_env, ds_newer.dataset_id, hours_ago=5)
    _set_dataset_timestamps(isolated_env, ds_ref.dataset_id, hours_ago=20)

    mapping = MultiPeriodColumnMapping(product="product", period="period", demand="demand")
    api_create_scenario(
        ScenarioCreateRequest(
            name="Quota Protected",
            dataset_id=ds_ref.dataset_id,
            dataset_name=ds_ref.filename,
            input_config=ScenarioInputConfig(mapping=mapping),
        )
    )

    # Set tiny quota (0.00015 MB ~ 157 bytes): ds_oldest and ds_newer must be evicted in oldest-first order,
    # while ds_ref remains protected and quota_target_achieved can still reflect remaining protected usage.
    monkeypatch.setenv("OR_STUDIO_MAX_DATASET_STORAGE_MB", "0.00015")
    rep = cleanup_unreferenced_datasets(dry_run=False)
    assert rep.eligible_datasets == [ds_oldest.dataset_id, ds_newer.dataset_id]
    assert rep.datasets_deleted == [ds_oldest.dataset_id, ds_newer.dataset_id]
    assert ds_ref.dataset_id in rep.referenced_datasets_skipped
    assert (isolated_env / "datasets" / f"{ds_ref.dataset_id}.csv").exists()

    # Now set an impossibly small quota with only referenced dataset left -> soft quota report
    monkeypatch.setenv("OR_STUDIO_MAX_DATASET_STORAGE_MB", "0.00001")
    rep2 = cleanup_unreferenced_datasets(dry_run=False)
    assert rep2.datasets_deleted == []
    assert rep2.quota_target_achieved is False
    assert any("quota target could not be fully achieved" in w.lower() for w in rep2.warnings)


def test_temp_orphan_missing_files_and_unexpected_files(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_TEMP_FILE_GRACE_MINUTES", "15")
    monkeypatch.setenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", "true")
    ds_dir = isolated_env / "datasets"
    ds_dir.mkdir(parents=True, exist_ok=True)

    # 1. Temp files: old vs recent
    old_tmp = ds_dir / ".tmp_ds_old"
    new_tmp = ds_dir / ".tmp_ds_new"
    old_tmp.write_bytes(b"stale-tmp")
    new_tmp.write_bytes(b"active-tmp")
    _set_file_mtime(old_tmp, minutes_ago=30)
    _set_file_mtime(new_tmp, minutes_ago=2)

    # 2. Unindexed valid UUID files: old unreferenced, recent unreferenced, old referenced
    old_orphan_id = str(uuid.uuid4())
    new_orphan_id = str(uuid.uuid4())
    ref_orphan_id = str(uuid.uuid4())
    old_orphan = ds_dir / f"{old_orphan_id}.csv"
    new_orphan = ds_dir / f"{new_orphan_id}.csv"
    ref_orphan = ds_dir / f"{ref_orphan_id}.csv"
    old_orphan.write_bytes(b"a,b,c\n1,2,3\n")
    new_orphan.write_bytes(b"a,b,c\n1,2,3\n")
    ref_orphan.write_bytes(b"a,b,c\n1,2,3\n")
    _set_file_mtime(old_orphan, minutes_ago=30)
    _set_file_mtime(new_orphan, minutes_ago=2)
    _set_file_mtime(ref_orphan, minutes_ago=30)

    mapping = MultiPeriodColumnMapping(product="a", period="b", demand="c")
    api_create_scenario(
        ScenarioCreateRequest(
            name="Protect Orphan Ref",
            dataset_id=ref_orphan_id,
            dataset_name="lost_meta.csv",
            input_config=ScenarioInputConfig(mapping=mapping),
        )
    )

    # 3. Unexpected file type & non-UUID filename must NOT be deleted
    unexpected_ext = ds_dir / "notes.txt"
    non_uuid_csv = ds_dir / "manual_backup.csv"
    unexpected_ext.write_text("keep me", encoding="utf-8")
    non_uuid_csv.write_text("keep,me\n1,2\n", encoding="utf-8")
    _set_file_mtime(unexpected_ext, minutes_ago=120)
    _set_file_mtime(non_uuid_csv, minutes_ago=120)

    # 4. DB record whose disk file is missing
    ds_missing = upload_dataset("missing_disk.csv", b"product,period,demand\nA,P1,10\n")
    (ds_dir / f"{ds_missing.dataset_id}.csv").unlink()

    rep = cleanup_unreferenced_datasets(dry_run=False)
    assert rep.temp_files_scanned == 2
    assert rep.temp_files_removed == [".tmp_ds_old"]
    assert not old_tmp.exists()
    assert new_tmp.exists()

    assert rep.orphan_files_scanned == 3
    assert rep.orphan_files_removed == [f"{old_orphan_id}.csv"]
    assert not old_orphan.exists()
    assert new_orphan.exists()
    assert ref_orphan.exists()
    assert unexpected_ext.exists()
    assert non_uuid_csv.exists()
    assert any(ds_missing.dataset_id in f for f in rep.missing_file_findings)
    assert any(ref_orphan_id in w for w in rep.warnings)


def test_cleanup_fails_closed_when_scenario_db_unavailable(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS", "1")
    monkeypatch.setenv("OR_STUDIO_MIN_DATASET_AGE_MINUTES", "0")
    monkeypatch.setenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", "true")

    ds = upload_dataset("safe.csv", b"product,period,demand\nA,P1,10\n")
    _set_dataset_timestamps(isolated_env, ds.dataset_id, hours_ago=5)

    def boom():
        raise RuntimeError("Scenario DB locked/corrupted")

    monkeypatch.setattr(scenario_service, "list_all_referenced_dataset_ids", boom)

    with pytest.raises(RuntimeError):
        cleanup_unreferenced_datasets(dry_run=False)
    assert (isolated_env / "datasets" / f"{ds.dataset_id}.csv").exists()


def test_lifecycle_lock_timeout_and_cross_process_exclusion(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    # 1. Intra-process thread lock timeout -> LifecycleLockError
    entered = threading.Event()
    release = threading.Event()

    def holder():
        with lifecycle_lock(timeout_seconds=2.0):
            entered.set()
            release.wait(timeout=2.0)

    t = threading.Thread(target=holder)
    t.start()
    assert entered.wait(timeout=2.0)
    try:
        with pytest.raises(LifecycleLockError):
            with lifecycle_lock(timeout_seconds=0.15):
                pass
    finally:
        release.set()
        t.join(timeout=2.0)

    # 2. Cross-process lock exclusion using a real child Python process
    child_code = "\n".join(
        [
            "import time",
            "from app.services.lifecycle_lock import lifecycle_lock",
            "with lifecycle_lock(timeout_seconds=5.0):",
            "    print('LOCKED', flush=True)",
            "    time.sleep(0.8)",
        ]
    )
    backend_root = str(Path(__file__).resolve().parents[1])
    env = os.environ.copy()
    env["OR_STUDIO_DATA_DIR"] = str(isolated_env)
    env["PYTHONPATH"] = backend_root
    proc = subprocess.Popen(
        [sys.executable, "-c", child_code],
        cwd=backend_root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert proc.stdout is not None
        line = proc.stdout.readline().strip()
        err_out = proc.stderr.read() if (line != "LOCKED" and proc.stderr is not None) else ""
        assert line == "LOCKED", f"Child stderr: {err_out}"

        # While child process holds lock, parent fails closed quickly
        with pytest.raises(LifecycleLockError):
            with lifecycle_lock(timeout_seconds=0.15):
                pass

        rc = proc.wait(timeout=5.0)
        assert rc == 0

        # Once child exits, parent acquires lock cleanly
        with lifecycle_lock(timeout_seconds=1.0):
            pass
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=2.0)


def test_concurrent_scenario_create_and_cleanup_plus_delete_and_cleanup(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS", "1")
    monkeypatch.setenv("OR_STUDIO_MIN_DATASET_AGE_MINUTES", "0")
    monkeypatch.setenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", "true")

    ds_ref = upload_dataset("race_ref.csv", b"product,period,demand\nA,P1,10\n")
    ds_del = upload_dataset("race_del.csv", b"product,period,demand\nB,P1,20\n")
    _set_dataset_timestamps(isolated_env, ds_ref.dataset_id, hours_ago=10)
    _set_dataset_timestamps(isolated_env, ds_del.dataset_id, hours_ago=10)

    mapping = MultiPeriodColumnMapping(product="product", period="period", demand="demand")
    errors: list[Exception] = []

    def create_scen():
        try:
            api_create_scenario(
                ScenarioCreateRequest(
                    name="Concurrent Scenario",
                    dataset_id=ds_ref.dataset_id,
                    dataset_name=ds_ref.filename,
                    input_config=ScenarioInputConfig(mapping=mapping),
                )
            )
        except Exception as exc:
            errors.append(exc)

    def run_del():
        try:
            api_delete_dataset(ds_del.dataset_id)
        except HTTPException as exc:
            # 404 is acceptable if cleanup deleted ds_del first
            if exc.status_code != 404:
                errors.append(exc)
        except Exception as exc:
            errors.append(exc)

    def run_cleanup():
        try:
            cleanup_unreferenced_datasets(dry_run=False)
        except Exception as exc:
            errors.append(exc)

    # First ensure scenario creation + cleanup never clash
    t1 = threading.Thread(target=create_scen)
    t2 = threading.Thread(target=run_cleanup)
    t1.start()
    t2.start()
    t1.join(timeout=5.0)
    t2.join(timeout=5.0)
    assert errors == []

    # Re-create ds_del if cleanup removed it, then race delete + cleanup
    ds_del2 = upload_dataset("race_del2.csv", b"product,period,demand\nC,P1,30\n")
    _set_dataset_timestamps(isolated_env, ds_del2.dataset_id, hours_ago=10)
    t3 = threading.Thread(target=lambda: api_delete_dataset(ds_del2.dataset_id))
    t4 = threading.Thread(target=run_cleanup)
    # Catch 404 from delete if cleanup wins
    def safe_del():
        try:
            api_delete_dataset(ds_del2.dataset_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                errors.append(exc)

    t3 = threading.Thread(target=safe_del)
    t3.start()
    t4.start()
    t3.join(timeout=5.0)
    t4.join(timeout=5.0)
    assert errors == []
    assert not (isolated_env / "datasets" / f"{ds_del2.dataset_id}.csv").exists()
