from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.schemas import (
    MultiPeriodSolveResponse,
    SavedScenarioDetail,
    SavedScenarioSummary,
    ScenarioCreateRequest,
    ScenarioInputConfig,
    ScenarioUpdateRequest,
)

_DB_LOCK = threading.Lock()


def _get_db_path() -> Path:
    override = os.getenv("OR_STUDIO_SCENARIO_DB", "").strip()
    if override:
        path = Path(override)
    else:
        path = Path(__file__).resolve().parents[2] / "data" / "or_studio_scenarios.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_get_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                module TEXT NOT NULL DEFAULT 'multi-period',
                dataset_id TEXT,
                dataset_name TEXT,
                active_sheet TEXT,
                objective_sense TEXT NOT NULL DEFAULT 'Minimize',
                status TEXT NOT NULL DEFAULT 'Not Solved',
                is_optimal INTEGER NOT NULL DEFAULT 0,
                constraints_feasible INTEGER NOT NULL DEFAULT 0,
                objective_value REAL,
                has_result_snapshot INTEGER NOT NULL DEFAULT 0,
                input_config_json TEXT NOT NULL,
                result_snapshot_json TEXT
            )
            """
        )
        conn.commit()
        yield conn
    finally:
        conn.close()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_snapshot_meta(
    snapshot: MultiPeriodSolveResponse | None, fallback_sense: str
) -> tuple[str, str, int, int, float | None, int, str | None]:
    if snapshot is None:
        return (fallback_sense, "Not Solved", 0, 0, None, 0, None)
    return (
        snapshot.objective_sense or fallback_sense,
        snapshot.status,
        1 if snapshot.is_optimal else 0,
        1 if snapshot.constraints_feasible else 0,
        snapshot.objective_value,
        1,
        snapshot.model_dump_json(),
    )


def _row_to_summary(row: sqlite3.Row) -> SavedScenarioSummary:
    return SavedScenarioSummary(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        module=row["module"],
        dataset_id=row["dataset_id"],
        dataset_name=row["dataset_name"],
        active_sheet=row["active_sheet"],
        objective_sense=row["objective_sense"],
        status=row["status"],
        is_optimal=bool(row["is_optimal"]),
        constraints_feasible=bool(row["constraints_feasible"]),
        objective_value=row["objective_value"],
        has_result_snapshot=bool(row["has_result_snapshot"]),
        input_config=ScenarioInputConfig.model_validate_json(row["input_config_json"]),
    )


def _row_to_detail(row: sqlite3.Row) -> SavedScenarioDetail:
    summary = _row_to_summary(row)
    snapshot = (
        MultiPeriodSolveResponse.model_validate_json(row["result_snapshot_json"])
        if row["result_snapshot_json"]
        else None
    )
    return SavedScenarioDetail(**summary.model_dump(), result_snapshot=snapshot)


def list_scenarios() -> list[SavedScenarioDetail]:
    with _DB_LOCK:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT * FROM scenarios ORDER BY created_at DESC"
            ).fetchall()
            return [_row_to_detail(r) for r in rows]


def get_scenario(scenario_id: str) -> SavedScenarioDetail:
    with _DB_LOCK:
        with _connect() as conn:
            row = conn.execute(
                "SELECT * FROM scenarios WHERE id = ?", (scenario_id,)
            ).fetchone()
            if row is None:
                raise KeyError(f"Scenario '{scenario_id}' not found.")
            return _row_to_detail(row)


def create_scenario(req: ScenarioCreateRequest) -> SavedScenarioDetail:
    scenario_id = str(uuid.uuid4())
    now = _utc_now()
    (
        sense,
        status_str,
        is_opt,
        feasible,
        obj_val,
        has_snap,
        snap_json,
    ) = _extract_snapshot_meta(req.result_snapshot, req.input_config.objective_sense)

    with _DB_LOCK:
        with _connect() as conn:
            existing = conn.execute(
                "SELECT id FROM scenarios WHERE name = ? COLLATE NOCASE",
                (req.name,),
            ).fetchone()
            if existing is not None:
                raise FileExistsError(
                    f"A scenario named '{req.name}' already exists. Choose a different name."
                )

            conn.execute(
                """
                INSERT INTO scenarios (
                    id, name, description, created_at, updated_at, module,
                    dataset_id, dataset_name, active_sheet, objective_sense,
                    status, is_optimal, constraints_feasible, objective_value,
                    has_result_snapshot, input_config_json, result_snapshot_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scenario_id,
                    req.name,
                    req.description.strip(),
                    now,
                    now,
                    req.module,
                    req.dataset_id,
                    req.dataset_name,
                    req.active_sheet,
                    sense,
                    status_str,
                    is_opt,
                    feasible,
                    obj_val,
                    has_snap,
                    req.input_config.model_dump_json(),
                    snap_json,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM scenarios WHERE id = ?", (scenario_id,)
            ).fetchone()
            return _row_to_detail(row)


def update_scenario(scenario_id: str, req: ScenarioUpdateRequest) -> SavedScenarioDetail:
    now = _utc_now()
    with _DB_LOCK:
        with _connect() as conn:
            row = conn.execute(
                "SELECT * FROM scenarios WHERE id = ?", (scenario_id,)
            ).fetchone()
            if row is None:
                raise KeyError(f"Scenario '{scenario_id}' not found.")

            new_name = req.name if req.name is not None else row["name"]
            if new_name.lower() != row["name"].lower():
                dup = conn.execute(
                    "SELECT id FROM scenarios WHERE name = ? COLLATE NOCASE AND id != ?",
                    (new_name, scenario_id),
                ).fetchone()
                if dup is not None:
                    raise FileExistsError(
                        f"A scenario named '{new_name}' already exists."
                    )

            new_desc = (
                req.description.strip()
                if req.description is not None
                else row["description"]
            )
            new_input_json = (
                req.input_config.model_dump_json()
                if req.input_config is not None
                else row["input_config_json"]
            )
            fallback_sense = (
                req.input_config.objective_sense
                if req.input_config is not None
                else row["objective_sense"]
            )

            if req.result_snapshot is not None:
                (
                    sense,
                    status_str,
                    is_opt,
                    feasible,
                    obj_val,
                    has_snap,
                    snap_json,
                ) = _extract_snapshot_meta(req.result_snapshot, fallback_sense)
            else:
                sense = fallback_sense
                status_str = row["status"]
                is_opt = row["is_optimal"]
                feasible = row["constraints_feasible"]
                obj_val = row["objective_value"]
                has_snap = row["has_result_snapshot"]
                snap_json = row["result_snapshot_json"]

            conn.execute(
                """
                UPDATE scenarios SET
                    name = ?, description = ?, updated_at = ?, objective_sense = ?,
                    status = ?, is_optimal = ?, constraints_feasible = ?,
                    objective_value = ?, has_result_snapshot = ?,
                    input_config_json = ?, result_snapshot_json = ?
                WHERE id = ?
                """,
                (
                    new_name,
                    new_desc,
                    now,
                    sense,
                    status_str,
                    is_opt,
                    feasible,
                    obj_val,
                    has_snap,
                    new_input_json,
                    snap_json,
                    scenario_id,
                ),
            )
            conn.commit()
            updated = conn.execute(
                "SELECT * FROM scenarios WHERE id = ?", (scenario_id,)
            ).fetchone()
            return _row_to_detail(updated)


def delete_scenario(scenario_id: str) -> None:
    with _DB_LOCK:
        with _connect() as conn:
            cur = conn.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
            conn.commit()
            if cur.rowcount == 0:
                raise KeyError(f"Scenario '{scenario_id}' not found.")
