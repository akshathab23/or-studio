# OR Studio — Interactive Operations Research Solver

OR Studio is a scientific web application for formulating, solving, visualizing, and auditing Operations Research (OR) optimization models. It pairs a React + TypeScript + Tailwind CSS frontend (with Plotly.js interactive charts and KaTeX mathematical notation) with a Python + FastAPI + Pandas + PuLP (CBC) optimization backend.

---

## Technology Stack

**Frontend (`or-studio/frontend`)**
- React 19 + TypeScript
- Vite 6
- Tailwind CSS v4
- React Router v7
- Lucide Icons
- Plotly.js (`plotly.js-dist-min`) for interactive charts
- KaTeX (`katex`) for rendered mathematical formulations

**Backend (`or-studio/backend`)**
- Python 3.12+
- FastAPI + Uvicorn
- Pandas + OpenPyXL (CSV & multi-sheet `.xlsx` parsing and profiling)
- PuLP (`2.9.0` with bundled COIN-OR CBC MILP/LP solver)
- Pytest

---

## Project Structure

```text
or-studio/
├── backend/
│   ├── app/
│   │   ├── main.py                         # FastAPI routes & CORS configuration
│   │   ├── schemas.py                      # Pydantic request/response schemas
│   │   └── services/
│   │       ├── dataset_service.py          # CSV/XLSX parsing, sheet switching, profiling, mapping validation
│   │       ├── multi_period_solver.py      # PuLP LP/MILP multi-period production planning solver
│   │       ├── goal_programming_solver.py  # Weighted & Preemptive Lexicographic Goal Programming solver
│   │       └── mcdm_solver.py              # TOPSIS & Weighted Sum Model (WSM) solver
│   ├── tests/
│   │   └── test_or_studio_api.py           # Backend unit & integration tests
│   ├── pytest.ini
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/client.ts                   # Typed REST API client
│       ├── components/                     # Layout, DatasetUploader, DatasetPreview, PlotlyChart, MathBlock, FormulationView
│       ├── context/StudioContext.tsx       # Shared dataset, solver results & Solution History state
│       ├── pages/                          # Dashboard, MultiPeriod, GoalProgramming, MCDM, DatasetExplorer, SolutionHistory
│       └── types/or.ts
└── README.md
```

---

## Installation & Setup

### 1. Backend Setup

```powershell
cd or-studio\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 2. Frontend Setup

```powershell
cd or-studio\frontend
npm.cmd install
```

---

## How to Run the Application

Open two terminals:

**Terminal 1 — Start FastAPI Backend (port 8000):**
```powershell
cd or-studio\backend
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Start Vite Frontend (port 5173):**
```powershell
cd or-studio\frontend
npm.cmd run dev
```

Open `http://localhost:5173` in your browser. Vite proxies `/api/*` requests to `http://127.0.0.1:8000`.

---

## Dataset Instructions

1. Navigate to **Dataset Explorer** in the sidebar.
2. Upload any `.csv` or `.xlsx` file. For `.xlsx` workbooks, use the **Sheet** dropdown to switch between sheets.
3. Inspect the detected column types, missing-value counts, and numerical statistics (`min`, `max`, `mean`, `std`).
4. **Candidate Research Dataset:** *Tablets Manufacturing Processes: Multi-level multi-item capacitated lot-sizing* (`https://data.mendeley.com/datasets/wt4s58xwj3/4`). Download the dataset locally and upload it in Dataset Explorer. OR Studio never fabricates datasets or silently substitutes missing values.

---

## Solver Instructions

- **Multi-Period Optimization:** Map your dataset's actual columns (`Product`, `Period`, `Demand`, and optional `Production Cost`, `Inventory Cost`, `Capacity`, `Processing Time`, `Resource`, `Initial Inventory`, `Setup Cost`, `Setup Time`), click **Validate Mapping**, and click **Solve Model**. Inspect results, Plotly.js charts, and the exact KaTeX formulation, or export the schedule as CSV.
- **Goal Programming:** Choose **Non-Preemptive Weighted** or **Preemptive Lexicographic** optimization, define decision variables, hard constraints, and goals (`minimum`, `maximum`, `exact` with `D+`/`D-` deviations, priorities, and weights), then click **Solve Goal Program**. Preemptive mode solves priority levels sequentially and preserves prior priority optimums via exact constraints.
- **MCDM:** Choose **TOPSIS** or **Weighted Sum (WSM)**, configure weighted benefit/cost criteria and alternative scores, and click **Compute Rankings**.

---

## API Information

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Backend health check |
| `POST` | `/api/datasets/upload` | Upload `.csv` or `.xlsx` dataset |
| `GET` | `/api/datasets/{dataset_id}` | Get dataset summary & profile |
| `POST` | `/api/datasets/{dataset_id}/sheet` | Switch active Excel sheet |
| `GET` | `/api/datasets/{dataset_id}/preview` | Paginated data preview |
| `DELETE` | `/api/datasets/{dataset_id}` | Remove dataset from memory |
| `POST` | `/api/datasets/{dataset_id}/validate-mapping` | Validate column mapping & missing values |
| `POST` | `/api/solve/multi-period` | Solve Multi-Period Production Planning LP/MILP |
| `POST` | `/api/solve/goal-programming` | Solve Weighted or Preemptive Goal Programming |
| `POST` | `/api/solve/mcdm` | Solve TOPSIS or WSM ranking |

---

## Running Tests

**Backend tests:**
```powershell
cd or-studio\backend
.\.venv\Scripts\python.exe -m pytest -p no:anyio -v
```

**Frontend typecheck & build:**
```powershell
cd or-studio\frontend
npm.cmd run build
```

---

## Limitations

- Uploaded datasets are stored in backend process memory (ephemeral per server session); restarting the backend clears uploaded datasets.
- Solution History is persisted in browser `localStorage` (`or_studio_history_v1`).
- Missing values in mapped optimization columns are rejected during validation rather than imputed, so incomplete sheets must be cleaned before solving.
- Preemptive Goal Programming preserves prior priority optimums with a `1e-6` numerical feasibility tolerance.
