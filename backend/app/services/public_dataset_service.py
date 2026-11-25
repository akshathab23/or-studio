from __future__ import annotations

import io
import tempfile
import threading
import zipfile
from pathlib import Path

import httpx
import pandas as pd

from app.schemas import (
    MultiPeriodColumnMapping,
    ParameterAssumptionItem,
    PreprocessingReport,
    PublicDatasetCatalogItem,
    PublicDatasetImportRequest,
    PublicDatasetImportResponse,
)
from app.services.dataset_service import register_prepared_dataset

MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024
MAX_EXTRACTED_BYTES = 150 * 1024 * 1024
CACHE_DIR = Path(tempfile.gettempdir()) / "or_studio_public_cache"

_IMPORT_LOCK = threading.Lock()
_ACTIVE_JOBS: set[str] = set()

UCI_ONLINE_RETAIL_URLS = [
    "https://archive.ics.uci.edu/static/public/352/online+retail.zip",
    "https://archive.ics.uci.edu/ml/machine-learning-databases/00352/Online%20Retail.xlsx",
]

CATALOG: dict[str, PublicDatasetCatalogItem] = {
    "uci_online_retail": PublicDatasetCatalogItem(
        id="uci_online_retail",
        name="UCI Online Retail",
        source="UCI Machine Learning Repository",
        source_url="https://archive.ics.uci.edu/dataset/352/online+retail",
        description=(
            "Transnational historical dataset containing all transactions occurring between "
            "01/12/2010 and 09/12/2011 for a UK-based non-store online retail business "
            "(InvoiceNo, StockCode, Description, Quantity, InvoiceDate, UnitPrice, CustomerID, Country)."
        ),
        approximate_size="~22.6 MB (.xlsx, ~541,909 raw transactions)",
        data_period="2010-12-01 to 2011-12-09 (Historical)",
        license="CC BY 4.0 (Creative Commons Attribution 4.0 International)",
        citation=(
            "Chen, D. (2015). Online Retail [Dataset]. UCI Machine Learning Repository. "
            "https://doi.org/10.24432/C5BW33."
        ),
        disclaimer=(
            "Historical retail transaction dataset used as a real-world test of OR Studio's "
            "optimization workflow, not live market data. Capacity and unit cost parameters are "
            "configurable modeling assumptions."
        ),
    )
}


def list_public_datasets() -> list[PublicDatasetCatalogItem]:
    return list(CATALOG.values())


def _extract_excel_from_zip(raw_zip: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name_lower = info.filename.lower()
            if ".." in info.filename or info.filename.startswith(("/", "\\")):
                continue
            if info.file_size > MAX_EXTRACTED_BYTES:
                raise ValueError("Extracted archive entry exceeds safety size limit.")
            if name_lower.endswith(".xlsx") or name_lower.endswith(".csv"):
                return zf.read(info.filename)
    raise ValueError("Downloaded archive did not contain a supported .xlsx or .csv file.")


def _fetch_uci_online_retail_bytes() -> tuple[bytes, bool]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / "uci_online_retail.xlsx"
    if cache_path.exists() and cache_path.stat().st_size > 1024:
        return cache_path.read_bytes(), True

    last_error: Exception | None = None
    for url in UCI_ONLINE_RETAIL_URLS:
        try:
            with httpx.Client(timeout=45.0, follow_redirects=True) as client:
                resp = client.get(url)
                resp.raise_for_status()
                content = resp.content
            if len(content) > MAX_DOWNLOAD_BYTES:
                raise ValueError("Remote dataset exceeds maximum allowed download size.")
            if len(content) < 512:
                raise ValueError("Downloaded dataset response was unexpectedly small.")

            if url.lower().endswith(".zip") or content[:4] == b"PK\x03\x04":
                try:
                    # Could be a zip archive OR an .xlsx (both start with PK\x03\x04)
                    if url.lower().endswith(".zip"):
                        extracted = _extract_excel_from_zip(content)
                    else:
                        extracted = content
                except zipfile.BadZipFile as exc:
                    raise ValueError("Downloaded archive is corrupted.") from exc
            else:
                extracted = content

            cache_path.write_bytes(extracted)
            return extracted, False
        except Exception as exc:
            last_error = exc
            continue

    raise RuntimeError(
        f"Failed to download UCI Online Retail dataset from official UCI endpoints: {last_error}"
    )


def _format_period_series(dates: pd.Series, agg: str) -> pd.Series:
    if agg == "weekly":
        iso = dates.dt.isocalendar()
        return iso["year"].astype(str) + "-W" + iso["week"].astype(str).str.zfill(2)
    if agg == "quarterly":
        return dates.dt.to_period("Q").astype(str)
    return dates.dt.strftime("%Y-%m")


def preprocess_and_prepare_uci_retail(
    raw_bytes: bytes,
    req: PublicDatasetImportRequest,
    *,
    cached_source_used: bool,
) -> PublicDatasetImportResponse:
    # Detect whether bytes are Excel (.xlsx) or CSV
    try:
        if raw_bytes[:4] == b"PK\x03\x04":
            df = pd.read_excel(io.BytesIO(raw_bytes), engine="openpyxl")
        else:
            df = pd.read_csv(io.BytesIO(raw_bytes))
    except Exception as exc:
        raise ValueError(f"Failed to parse UCI Online Retail dataset: {exc}") from exc

    required_cols = {"InvoiceNo", "StockCode", "Quantity", "InvoiceDate", "UnitPrice"}
    missing_cols = required_cols - set(str(c).strip() for c in df.columns)
    if missing_cols:
        raise ValueError(
            f"Dataset is missing expected columns: {', '.join(sorted(missing_cols))}."
        )
    df.columns = [str(c).strip() for c in df.columns]

    raw_row_count = int(len(df))

    # 1. Remove cancelled invoices (InvoiceNo starting with C)
    inv_str = df["InvoiceNo"].astype(str).str.strip()
    cancel_mask = inv_str.str.upper().str.startswith("C")
    cancelled_removed = int(cancel_mask.sum())
    df = df.loc[~cancel_mask].copy()

    # 2. Remove missing StockCode
    stock_str = df["StockCode"].astype(str).str.strip()
    missing_stock_mask = df["StockCode"].isna() | (stock_str == "") | (stock_str.str.lower() == "nan")
    missing_stockcode_removed = int(missing_stock_mask.sum())
    df = df.loc[~missing_stock_mask].copy()
    df["StockCode"] = df["StockCode"].astype(str).str.strip()

    # 3. Parse and validate InvoiceDate
    df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"], errors="coerce")
    invalid_date_mask = df["InvoiceDate"].isna()
    invalid_date_removed = int(invalid_date_mask.sum())
    df = df.loc[~invalid_date_mask].copy()

    # 4. Validate Quantity > 0
    df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce")
    bad_qty_mask = df["Quantity"].isna() | (df["Quantity"] <= 0)
    non_positive_quantity_removed = int(bad_qty_mask.sum())
    df = df.loc[~bad_qty_mask].copy()

    # 5. Validate UnitPrice > 0
    df["UnitPrice"] = pd.to_numeric(df["UnitPrice"], errors="coerce")
    bad_price_mask = df["UnitPrice"].isna() | (df["UnitPrice"] <= 0)
    invalid_price_removed = int(bad_price_mask.sum())
    df = df.loc[~bad_price_mask].copy()

    clean_row_count = int(len(df))
    if clean_row_count == 0:
        raise ValueError("No valid transaction rows remained after preprocessing.")

    date_min = df["InvoiceDate"].min().strftime("%Y-%m-%d")
    date_max = df["InvoiceDate"].max().strftime("%Y-%m-%d")

    df["Period"] = _format_period_series(df["InvoiceDate"], req.aggregation_period)
    df["Gross_Sales_Value"] = df["Quantity"] * df["UnitPrice"]

    # Select top products by total historical demand and chronological periods
    top_products = (
        df.groupby("StockCode")["Quantity"]
        .sum()
        .sort_values(ascending=False)
        .head(req.max_products)
        .index.tolist()
    )
    all_periods_sorted = sorted(df["Period"].unique().tolist())
    selected_periods = all_periods_sorted[: req.max_periods]

    filtered = df[
        df["StockCode"].isin(top_products) & df["Period"].isin(selected_periods)
    ].copy()

    grouped = (
        filtered.groupby(["StockCode", "Period"], as_index=False)
        .agg(
            Demand=("Quantity", "sum"),
            Avg_Unit_Price=("UnitPrice", "mean"),
            Gross_Sales_Value=("Gross_Sales_Value", "sum"),
        )
    )

    # Product-level fallback average unit price for zero-demand periods
    prod_avg_price = (
        filtered.groupby("StockCode")["UnitPrice"].mean().to_dict()
    )

    # Complete (Product, Period) grid so multi-period solver has clean periods
    grid = pd.MultiIndex.from_product(
        [top_products, selected_periods], names=["Product", "Period"]
    ).to_frame(index=False)
    merged = grid.merge(
        grouped.rename(columns={"StockCode": "Product"}),
        on=["Product", "Period"],
        how="left",
    )
    merged["Demand"] = merged["Demand"].fillna(0.0).round(2)
    merged["Gross_Sales_Value"] = merged["Gross_Sales_Value"].fillna(0.0).round(2)
    merged["Avg_Unit_Price"] = merged.apply(
        lambda r: round(
            float(r["Avg_Unit_Price"])
            if pd.notna(r["Avg_Unit_Price"])
            else float(prod_avg_price.get(r["Product"], 1.0)),
            4,
        ),
        axis=1,
    )

    # Estimated Capacity per product = peak period demand * (1 + buffer%)
    peak_by_product = merged.groupby("Product")["Demand"].max().to_dict()
    buffer_mult = 1.0 + (req.capacity_buffer_pct / 100.0)
    merged["Estimated_Capacity"] = merged["Product"].map(
        lambda p: round(max(float(peak_by_product.get(p, 0.0)) * buffer_mult, 1.0), 2)
    )

    assumptions: list[ParameterAssumptionItem] = [
        ParameterAssumptionItem(
            field="product",
            column_name="Product",
            origin="source_derived",
            methodology="Directly mapped from historical StockCode (top products by net demand).",
            summary=f"{len(top_products)} StockCodes selected",
        ),
        ParameterAssumptionItem(
            field="period",
            column_name="Period",
            origin="source_derived",
            methodology=f"Derived from InvoiceDate using {req.aggregation_period} aggregation.",
            summary=f"{len(selected_periods)} periods ({selected_periods[0]} to {selected_periods[-1]})",
        ),
        ParameterAssumptionItem(
            field="demand",
            column_name="Demand",
            origin="source_derived",
            methodology="Sum of valid positive Quantity after removing cancellations & invalid rows.",
            summary=f"Total demand: {merged['Demand'].sum():,.2f} units",
        ),
        ParameterAssumptionItem(
            field="capacity",
            column_name="Estimated_Capacity",
            origin="model_assumption",
            methodology=(
                f"Estimated per-product capacity = peak historical period demand × "
                f"(1 + {req.capacity_buffer_pct:g}% buffer). Not present in UCI source."
            ),
            summary=(
                f"Min {merged['Estimated_Capacity'].min():,.2f} / "
                f"Max {merged['Estimated_Capacity'].max():,.2f} units"
            ),
        ),
    ]

    prod_cost_col: str | None = None
    if req.include_production_cost:
        prod_cost_col = "Assumed_Production_Cost"
        merged[prod_cost_col] = (merged["Avg_Unit_Price"] * req.production_cost_ratio).round(4)
        assumptions.append(
            ParameterAssumptionItem(
                field="production_cost",
                column_name=prod_cost_col,
                origin="model_assumption",
                methodology=(
                    f"Assumed unit production cost = {req.production_cost_ratio * 100:g}% of "
                    "historical Avg_Unit_Price. Not actual manufacturing cost."
                ),
                summary=f"Mean {merged[prod_cost_col].mean():,.2f} per unit",
            )
        )

    inv_cost_col: str | None = None
    if req.include_inventory_cost:
        inv_cost_col = "Assumed_Inventory_Cost"
        merged[inv_cost_col] = (merged["Avg_Unit_Price"] * req.inventory_cost_ratio).round(4)
        assumptions.append(
            ParameterAssumptionItem(
                field="inventory_cost",
                column_name=inv_cost_col,
                origin="model_assumption",
                methodology=(
                    f"Assumed unit holding cost = {req.inventory_cost_ratio * 100:g}% of "
                    "historical Avg_Unit_Price per period. Not in source."
                ),
                summary=f"Mean {merged[inv_cost_col].mean():,.2f} per unit-period",
            )
        )

    init_inv_col: str | None = None
    if req.include_initial_inventory:
        init_inv_col = "Assumed_Initial_Inventory"
        merged[init_inv_col] = round(req.initial_inventory_units, 2)
        assumptions.append(
            ParameterAssumptionItem(
                field="initial_inventory",
                column_name=init_inv_col,
                origin="model_assumption",
                methodology="User-configured starting inventory before Period 1.",
                summary=f"{req.initial_inventory_units:g} units per product",
            )
        )

    dataset_summary = register_prepared_dataset(
        f"uci_online_retail_{req.aggregation_period}.csv",
        merged,
    )

    report = PreprocessingReport(
        raw_row_count=raw_row_count,
        cancelled_invoices_removed=cancelled_removed,
        non_positive_quantity_removed=non_positive_quantity_removed,
        invalid_price_removed=invalid_price_removed,
        missing_stockcode_removed=missing_stockcode_removed,
        invalid_date_removed=invalid_date_removed,
        clean_row_count=clean_row_count,
        aggregation_period=req.aggregation_period,
        products_selected=len(top_products),
        periods_created=len(selected_periods),
        prepared_row_count=int(len(merged)),
        date_range_start=date_min,
        date_range_end=date_max,
        cached_source_used=cached_source_used,
    )

    suggested_mapping = MultiPeriodColumnMapping(
        product="Product",
        period="Period",
        demand="Demand",
        production_cost=prod_cost_col,
        inventory_cost=inv_cost_col,
        capacity="Estimated_Capacity",
        initial_inventory=init_inv_col,
    )

    return PublicDatasetImportResponse(
        dataset=dataset_summary,
        catalog_entry=CATALOG[req.source_id],
        preprocessing_report=report,
        assumptions=assumptions,
        suggested_mapping=suggested_mapping,
        suggested_capacity_scope="per_product",
    )


def import_public_dataset(req: PublicDatasetImportRequest) -> PublicDatasetImportResponse:
    if req.source_id not in CATALOG:
        raise ValueError(f"Unknown public dataset source '{req.source_id}'.")

    with _IMPORT_LOCK:
        if req.source_id in _ACTIVE_JOBS:
            raise FileExistsError(
                f"An import job for '{req.source_id}' is already in progress. Please wait."
            )
        _ACTIVE_JOBS.add(req.source_id)

    try:
        raw_bytes, cached = _fetch_uci_online_retail_bytes()
        return preprocess_and_prepare_uci_retail(
            raw_bytes,
            req,
            cached_source_used=cached,
        )
    finally:
        with _IMPORT_LOCK:
            _ACTIVE_JOBS.discard(req.source_id)
