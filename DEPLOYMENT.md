# OR Studio — Production Deployment Guide

This guide covers deploying **OR Studio** using:
- **GitHub**: Dedicated repository `or-studio`
- **Render**: FastAPI + PuLP (CBC) backend
- **Vercel**: React + Vite + TypeScript frontend

---

## 1. GitHub Repository Connection

OR Studio lives inside its own Git repository (`or-studio/`) separate from any parent workspace.

1. Initialize and verify the repository inside `or-studio/`:
   ```powershell
   cd or-studio
   git status
   git remote -v
   ```
2. If `origin` is not yet configured, add your `or-studio` GitHub repository URL:
   ```powershell
   git remote add origin https://github.com/<your-username>/or-studio.git
   git branch -M main
   git push -u origin main
   ```
3. Verify `.gitignore` excludes `.venv/`, `node_modules/`, `dist/`, `.env`, `.deploy-backup/`, and temporary files before pushing.

---

## 2. Backend Setup on Render

The backend uses `or-studio/render.yaml` (or manual Web Service configuration):

- **Root Directory**: `backend`
- **Runtime**: Python (`3.12.8`)
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Health Check Path**: `/api/health`

### Steps in Render Dashboard
1. Sign in to [Render](https://dashboard.render.com) and click **New + → Web Service** (or **Blueprint** to auto-detect `render.yaml`).
2. Connect your GitHub account and select the **`or-studio`** repository.
3. Set **Root Directory** to `backend` (if configuring manually).
4. Set environment variables (see Section 4).
5. Deploy and wait for the health check `/api/health` to return `200 OK`:
   ```json
   {"status": "ok", "service": "or-studio-backend"}
   ```
6. Copy your public Render backend URL (e.g., `https://or-studio-backend.onrender.com`).

> **Note on PuLP & CBC:** `requirements.txt` pins `pulp>=2.9.0,<3.0.0`, which bundles the Linux x86_64 COIN-OR CBC solver binary compatible with Render's Python runtime.

---

## 3. Frontend Setup on Vercel

1. Sign in to [Vercel](https://vercel.com) and click **Add New… → Project**.
2. Import the **`or-studio`** GitHub repository.
3. Configure Project Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add the environment variable `VITE_API_BASE_URL` pointing to your Render backend URL (without `/api`, e.g., `https://or-studio-backend.onrender.com`).
5. Click **Deploy**.
6. `frontend/vercel.json` is included to rewrite all client-side routes (`/multi-period`, `/goal-programming`, `/mcdm`, `/datasets`, `/history`) to `/index.html`.

---

## 4. Environment Variables

### Render (Backend)
| Variable | Description | Example |
| :--- | :--- | :--- |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins (no trailing slash) | `https://your-app.vercel.app,http://localhost:5173` |
| `PYTHON_VERSION` | Python runtime version | `3.12.8` |

### Vercel (Frontend)
| Variable | Description | Example |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Public URL of the Render FastAPI backend | `https://or-studio-backend.onrender.com` |

> **Important:** After you get your exact Vercel domain (e.g., `https://or-studio-xyz.vercel.app`), add it to `CORS_ORIGINS` on Render and redeploy the backend if needed.

---

## 5. Verification & Testing

### Pre-Deployment Local Checks
- **Backend pytest**:
  ```powershell
  cd or-studio\backend
  .\.venv\Scripts\python.exe -m pytest -p no:anyio -v
  ```
- **Frontend TypeScript & production build**:
  ```powershell
  cd or-studio\frontend
  npx.cmd tsc --noEmit
  npm.cmd run build
  ```

### Post-Deployment Live Checks
1. Open `https://<your-render-service>.onrender.com/api/health` and confirm `{"status":"ok","service":"or-studio-backend"}`.
2. Open `https://<your-vercel-app>.vercel.app` in your browser.
3. Navigate across all routes (Dashboard, Dataset Explorer, Multi-Period Optimization, Goal Programming, MCDM, Solution History) and refresh to verify SPA routing.
4. Upload a `.csv` or `.xlsx` file in Dataset Explorer and run a Multi-Period or Goal Programming solve to confirm end-to-end API connectivity.

---

## 6. Troubleshooting

- **CORS error in browser console**: Ensure `CORS_ORIGINS` on Render includes your exact Vercel URL (`https://...vercel.app`) with no trailing slash.
- **Render Free Tier cold start**: Free Render services sleep after 15 minutes of inactivity; the first request after idle may take ~30–50 seconds.
- **404 on page refresh in Vercel**: Verify `frontend/vercel.json` is present and Root Directory in Vercel is set to `frontend`.
- **In-memory uploads reset**: Uploaded datasets are stored in backend memory per worker process; if the Render instance restarts, re-upload the dataset.

---

## 7. Final Public URLs

Fill in after completing Render and Vercel authorization:
- **GitHub Repository**: `https://github.com/<your-username>/or-studio`
- **Backend API (Render)**: `https://<your-render-service>.onrender.com`
- **Frontend App (Vercel)**: `https://<your-vercel-app>.vercel.app`
