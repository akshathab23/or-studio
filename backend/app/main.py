from __future__ import annotations

import os

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import (
    DatasetSummary,
    GoalProgrammingSolveRequest,
    GoalProgrammingSolveResponse,
    MCDMSolveRequest,
    MCDMSolveResponse,
    MappingValidationResponse,
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    MultiPeriodSolveResponse,
    SheetSelectRequest,
)
from app.services.dataset_service import (
    delete_dataset,
    get_dataset_summary,
    get_preview_rows,
    select_sheet,
    upload_dataset,
    validate_multi_period_mapping,
)
from app.services.goal_programming_solver import solve_goal_programming
from app.services.mcdm_solver import solve_mcdm
from app.services.multi_period_solver import solve_multi_period

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


@app.post("/api/datasets/upload", response_model=DatasetSummary)
async def api_upload_dataset(file: UploadFile = File(...)) -> DatasetSummary:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        return upload_dataset(file.filename, content)
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


@app.delete("/api/datasets/{dataset_id}")
def api_delete_dataset(dataset_id: str) -> dict[str, str]:
    try:
        delete_dataset(dataset_id)
        return {"status": "deleted", "dataset_id": dataset_id}
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
