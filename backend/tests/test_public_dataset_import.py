from __future__ import annotations

import io
import zipfile
from unittest.mock import MagicMock

import pandas as pd
import pytest

from app.schemas import MultiPeriodSolveRequest, PublicDatasetImportRequest
from app.services import public_dataset_service as pds
from app.services.dataset_service import validate_multi_period_mapping
from app.services.multi_period_solver import solve_multi_period


def _build_uci_like_excel_bytes() -> bytes:
    df = pd.DataFrame(
        [
            # Valid transactions for SKU_A across 2 months
            {
                "InvoiceNo": "536365",
                "StockCode": "SKU_A",
                "Description": "Item A",
                "Quantity": 10,
                "InvoiceDate": "2011-01-10 09:00:00",
                "UnitPrice": 5.0,
                "CustomerID": 17850,
                "Country": "United Kingdom",
            },
            {
                "InvoiceNo": "536366",
                "StockCode": "SKU_A",
                "Description": "Item A",
                "Quantity": 15,
                "InvoiceDate": "2011-02-14 11:00:00",
                "UnitPrice": 5.0,
                "CustomerID": 17850,
                "Country": "United Kingdom",
            },
            # Valid transactions for SKU_B
            {
                "InvoiceNo": "536367",
                "StockCode": "SKU_B",
                "Description": "Item B",
                "Quantity": 20,
                "InvoiceDate": "2011-01-12 10:00:00",
                "UnitPrice": 10.0,
                "CustomerID": 17851,
                "Country": "United Kingdom",
            },
            # Cancelled invoice (must be removed)
            {
                "InvoiceNo": "C536379",
                "StockCode": "SKU_A",
                "Description": "Item A",
                "Quantity": -5,
                "InvoiceDate": "2011-01-15 12:00:00",
                "UnitPrice": 5.0,
                "CustomerID": 17850,
                "Country": "United Kingdom",
            },
            # Negative quantity without C prefix (must be removed)
            {
                "InvoiceNo": "536380",
                "StockCode": "SKU_B",
                "Description": "Item B",
                "Quantity": -3,
                "InvoiceDate": "2011-02-01 12:00:00",
                "UnitPrice": 10.0,
                "CustomerID": 17851,
                "Country": "United Kingdom",
            },
            # Zero unit price (must be removed)
            {
                "InvoiceNo": "536381",
                "StockCode": "SKU_A",
                "Description": "Item A",
                "Quantity": 8,
                "InvoiceDate": "2011-02-02 12:00:00",
                "UnitPrice": 0.0,
                "CustomerID": 17850,
                "Country": "United Kingdom",
            },
            # Missing StockCode (must be removed)
            {
                "InvoiceNo": "536382",
                "StockCode": None,
                "Description": "Missing",
                "Quantity": 4,
                "InvoiceDate": "2011-02-03 12:00:00",
                "UnitPrice": 4.0,
                "CustomerID": 17850,
                "Country": "United Kingdom",
            },
            # Invalid date (must be removed)
            {
                "InvoiceNo": "536383",
                "StockCode": "SKU_B",
                "Description": "Item B",
                "Quantity": 4,
                "InvoiceDate": "not-a-date",
                "UnitPrice": 10.0,
                "CustomerID": 17850,
                "Country": "United Kingdom",
            },
        ]
    )
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()


def test_public_dataset_catalog():
    items = pds.list_public_datasets()
    assert len(items) >= 1
    uci = next(i for i in items if i.id == "uci_online_retail")
    assert "UCI" in uci.source
    assert "CC BY 4.0" in uci.license


def test_import_preprocess_and_solve_uci_fixture(monkeypatch, tmp_path):
    excel_bytes = _build_uci_like_excel_bytes()
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("Online Retail.xlsx", excel_bytes)
    zip_bytes = zip_buf.getvalue()

    monkeypatch.setattr(pds, "CACHE_DIR", tmp_path)

    mock_resp = MagicMock()
    mock_resp.content = zip_bytes
    mock_resp.raise_for_status = MagicMock()

    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_client.get = MagicMock(return_value=mock_resp)

    monkeypatch.setattr(pds.httpx, "Client", MagicMock(return_value=mock_client))

    req = PublicDatasetImportRequest(
        source_id="uci_online_retail",
        aggregation_period="monthly",
        max_products=5,
        max_periods=12,
        capacity_buffer_pct=25.0,
        include_production_cost=True,
        production_cost_ratio=0.6,
        include_inventory_cost=True,
        inventory_cost_ratio=0.05,
    )
    res = pds.import_public_dataset(req)

    rep = res.preprocessing_report
    assert rep.raw_row_count == 8
    assert rep.cancelled_invoices_removed == 1
    assert rep.missing_stockcode_removed == 1
    assert rep.invalid_date_removed == 1
    assert rep.non_positive_quantity_removed == 1
    assert rep.invalid_price_removed == 1
    assert rep.clean_row_count == 3
    assert rep.products_selected == 2
    assert rep.periods_created == 2
    assert rep.prepared_row_count == 4
    assert rep.cached_source_used is False

    # Second call should use cached file without hitting network
    res_cached = pds.import_public_dataset(req)
    assert res_cached.preprocessing_report.cached_source_used is True

    # Validate auto-generated mapping & solve with existing Multi-Period solver
    val = validate_multi_period_mapping(res.dataset.dataset_id, res.suggested_mapping)
    assert val.valid is True

    sol = solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=res.dataset.dataset_id,
            mapping=res.suggested_mapping,
            capacity_scope=res.suggested_capacity_scope,
        )
    )
    assert sol.is_optimal is True
    assert sol.status == "Optimal"
    assert sol.constraints_feasible is True
    assert abs((sol.total_demand or 0) - 45.0) < 1e-6  # 10 + 15 + 20


def test_import_download_failure_does_not_fabricate_data(monkeypatch, tmp_path):
    monkeypatch.setattr(pds, "CACHE_DIR", tmp_path)

    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_client.get = MagicMock(side_effect=pds.httpx.ConnectError("Network unreachable"))

    monkeypatch.setattr(pds.httpx, "Client", MagicMock(return_value=mock_client))

    with pytest.raises(RuntimeError, match="Failed to download UCI Online Retail"):
        pds.import_public_dataset(PublicDatasetImportRequest(source_id="uci_online_retail"))


def test_duplicate_import_job_rejected(monkeypatch):
    monkeypatch.setattr(pds, "_ACTIVE_JOBS", {"uci_online_retail"})
    with pytest.raises(FileExistsError, match="already in progress"):
        pds.import_public_dataset(PublicDatasetImportRequest(source_id="uci_online_retail"))
