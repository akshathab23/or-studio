from __future__ import annotations

import os
import threading

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.schemas import (
    DatasetCleanupReport,
    DatasetListItem,
    DatasetSummary,
    GoalProgrammingSolveRequest,
    GoalProgrammingSolveResponse,
    MCDMSolveRequest,
    MCDMSolveResponse,
    MappingValidationResponse,
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    MultiPeriodSolveResponse,
    PublicDatasetCatalogItem,
    PublicDatasetImportRequest,
    PublicDatasetImportResponse,
    SavedScenarioDetail,
    ScenarioCreateRequest,
    ScenarioReattachRequest,
    ScenarioUpdateRequest,
    SensitivitySweepRequest,
    SensitivitySweepResponse,
    SheetSelectRequest,
    TradeoffExploreRequest,
    TradeoffExploreResponse,
)
from app.services.dataset_service import (
    DatasetCleanupDisabledError,
    DatasetInUseError,
    DatasetTooLargeError,
    cleanup_unreferenced_datasets,
    delete_dataset,
    get_dataset_summary,
    get_max_upload_bytes,
    get_preview_rows,
    list_datasets,
    select_sheet,
    upload_dataset,
    validate_multi_period_mapping,
)
from app.services.lifecycle_lock import LifecycleLockError
from app.services.goal_programming_solver import solve_goal_programming
from app.services.mcdm_solver import solve_mcdm
from app.services.multi_period_solver import solve_multi_period
from app.services.public_dataset_service import import_public_dataset, list_public_datasets
from app.services.scenario_service import (
    create_scenario,
    delete_scenario,
    get_scenario,
    list_scenarios,
    reattach_scenario_dataset,
    update_scenario,
)
from app.services.sensitivity_service import run_sensitivity_analysis
from app.services.tradeoff_service import run_tradeoff_exploration

_SENSITIVITY_SEMAPHORE = threading.BoundedSemaphore(2)
_TRADEOFF_SEMAPHORE = threading.BoundedSemaphore(2)

app = FastAPI(
    title="OR Studio API",
    description="Interactive Operations Research Solver Backend (Dataset Processing, Multi-Period LP/MILP, Goal Programming, MCDM)",
    version="1.0.0",
)

_default_origins = (
    "http://localhost:5173,"
    "http://127.0.0.1:5173,"
    "http://localhost:4173,"
    "http://127.0.0.1:4173"
)
_raw_origins = os.getenv("CORS_ORIGINS", _default_origins)
_allowed_origins = [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials="*" not in _allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root_status() -> dict[str, str]:
    return {"status": "ok", "service": "or-studio-backend", "health": "/api/health"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "or-studio-backend"}


@app.get("/api/datasets", response_model=list[DatasetListItem])
def api_list_datasets() -> list[DatasetListItem]:
    return list_datasets()


@app.post("/api/datasets/upload", response_model=DatasetSummary)
def api_upload_dataset(file: UploadFile = File(...)) -> DatasetSummary:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    max_bytes = get_max_upload_bytes()
    chunk_size = 1024 * 1024
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = file.file.read(chunk_size)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            max_mb = max(1, round(max_bytes / (1024 * 1024)))
            raise HTTPException(
                status_code=413,
                detail=f"Uploaded file exceeds the maximum allowed size of {max_mb} MB.",
            )
        chunks.append(chunk)

    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        return upload_dataset(file.filename, content)
    except DatasetTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/datasets/{dataset_id}", response_model=DatasetSummary)
def api_get_dataset(dataset_id: str, preview_limit: int = Query(50, ge=1, le=500)) -> DatasetSummary:
    try:
        return get_dataset_summary(dataset_id, preview_limit=preview_limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/sheet", response_model=DatasetSummary)
def api_select_sheet(dataset_id: str, req: SheetSelectRequest) -> DatasetSummary:
    try:
        return select_sheet(dataset_id, req.sheet_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/datasets/{dataset_id}/preview")
def api_preview_dataset(
    dataset_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
):
    try:
        return get_preview_rows(dataset_id, offset=offset, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/datasets/cleanup", response_model=DatasetCleanupReport)
def api_cleanup_datasets(dry_run: bool = Query(True)) -> DatasetCleanupReport:
    try:
        return cleanup_unreferenced_datasets(dry_run=dry_run)
    except DatasetCleanupDisabledError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LifecycleLockError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.delete("/api/datasets/{dataset_id}")
def api_delete_dataset(dataset_id: str) -> dict[str, str]:
    try:
        delete_dataset(dataset_id)
        return {"status": "deleted", "dataset_id": dataset_id}
    except DatasetInUseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LifecycleLockError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/datasets/{dataset_id}/validate-mapping", response_model=MappingValidationResponse)
def api_validate_mapping(
    dataset_id: str, mapping: MultiPeriodColumnMapping
) -> MappingValidationResponse:
    try:
        return validate_multi_period_mapping(dataset_id, mapping)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/solve/multi-period", response_model=MultiPeriodSolveResponse)
def api_solve_multi_period(req: MultiPeriodSolveRequest) -> MultiPeriodSolveResponse:
    try:
        return solve_multi_period(req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze/sensitivity", response_model=SensitivitySweepResponse)
def api_analyze_sensitivity(req: SensitivitySweepRequest) -> SensitivitySweepResponse:
    if not _SENSITIVITY_SEMAPHORE.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Sensitivity analysis capacity is currently busy. Please retry shortly.",
        )
    try:
        return run_sensitivity_analysis(req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _SENSITIVITY_SEMAPHORE.release()


@app.post("/api/analyze/trade-offs", response_model=TradeoffExploreResponse)
def api_analyze_tradeoffs(req: TradeoffExploreRequest) -> TradeoffExploreResponse:
    if not _TRADEOFF_SEMAPHORE.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Trade-off analysis capacity is currently busy. Please retry shortly.",
        )
    try:
        return run_tradeoff_exploration(req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        _TRADEOFF_SEMAPHORE.release()


@app.post("/api/solve/goal-programming", response_model=GoalProgrammingSolveResponse)
def api_solve_goal_programming(
    req: GoalProgrammingSolveRequest,
) -> GoalProgrammingSolveResponse:
    try:
        return solve_goal_programming(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/solve/mcdm", response_model=MCDMSolveResponse)
def api_solve_mcdm(req: MCDMSolveRequest) -> MCDMSolveResponse:
    try:
        return solve_mcdm(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/public-datasets", response_model=list[PublicDatasetCatalogItem])
def api_list_public_datasets() -> list[PublicDatasetCatalogItem]:
    return list_public_datasets()


@app.post("/api/public-datasets/import", response_model=PublicDatasetImportResponse)
async def api_import_public_dataset(
    req: PublicDatasetImportRequest,
) -> PublicDatasetImportResponse:
    try:
        return await run_in_threadpool(import_public_dataset, req)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/scenarios", response_model=list[SavedScenarioDetail])
def api_list_scenarios() -> list[SavedScenarioDetail]:
    return list_scenarios()


@app.post("/api/scenarios", response_model=SavedScenarioDetail, status_code=201)
def api_create_scenario(req: ScenarioCreateRequest) -> SavedScenarioDetail:
    try:
        return create_scenario(req)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/scenarios/{scenario_id}", response_model=SavedScenarioDetail)
def api_get_scenario(scenario_id: str) -> SavedScenarioDetail:
    try:
        return get_scenario(scenario_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/scenarios/{scenario_id}", response_model=SavedScenarioDetail)
def api_update_scenario(scenario_id: str, req: ScenarioUpdateRequest) -> SavedScenarioDetail:
    try:
        return update_scenario(scenario_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/scenarios/{scenario_id}/reattach", response_model=SavedScenarioDetail)
def api_reattach_scenario(
    scenario_id: str, req: ScenarioReattachRequest
) -> SavedScenarioDetail:
    try:
        return reattach_scenario_dataset(scenario_id, req)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LifecycleLockError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.delete("/api/scenarios/{scenario_id}")
def api_delete_scenario(scenario_id: str) -> dict[str, str]:
    try:
        delete_scenario(scenario_id)
        return {"status": "deleted", "scenario_id": scenario_id}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
