# API Guardian

**Detect breaking changes between OpenAPI spec versions, score the risk, and get AI-generated explanations, migration guides, and release notes — automatically.**

API Guardian compares two versions of an OpenAPI spec, flags what changed (removed endpoints, changed fields, new additions, etc.), scores overall risk, and uses Google Gemini to explain each change in plain English, plus generate a migration guide and release notes.

---

## Features

- 📋 **Diff engine** — detects breaking and non-breaking changes between two OpenAPI spec versions (removed endpoints, changed methods, field changes, and more)
- 🚦 **Risk scoring** — each comparison gets an overall risk score (`safe` / `medium` / `high` / `critical`)
- 🤖 **AI explanations** — Google Gemini generates a plain-English explanation for every detected change, plus a migration guide and release notes for the whole comparison
- ⚡ **Async processing** — AI generation runs in the background via Celery, so comparisons return instantly and explanations fill in a few seconds later
- 🔐 **Real authentication** — email/password (JWT) and Google OAuth sign-in, with per-user data isolation
- 🗑️ **Full CRUD** — create, list, and delete projects, spec versions, and comparisons
- 🖥️ **Dashboard UI** — upload spec versions, run comparisons, and view AI-generated insights, all in a clean web interface

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python) |
| Database | PostgreSQL + SQLAlchemy |
| Background jobs | Celery |
| Job queue / broker | Memurai (Redis-compatible, Windows) |
| AI | Google Gemini (`google-genai` SDK) |
| Auth | JWT (`python-jose`) + `passlib` (bcrypt) + Google OAuth 2.0 |
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS |

---

## Prerequisites

Before running this project, you'll need:

1. **Python 3.12** (not 3.14 — some dependencies don't have prebuilt wheels for 3.14 yet)
2. **Node.js** (for the frontend — any recent LTS version)
3. **PostgreSQL**, installed and running locally
4. **[Memurai](https://www.memurai.com/get-memurai)** (free Developer Edition, LTS) — Redis-compatible broker for Celery, since Redis has no official Windows build. On macOS/Linux, plain Redis works fine instead.
5. **A Google Gemini API key** — free tier available, no credit card required, from [Google AI Studio](https://aistudio.google.com/) → Get API key
6. **Google OAuth credentials** — from [Google Cloud Console](https://console.cloud.google.com/):
   - Create a project → configure the OAuth consent screen (External, add yourself as a test user) → create an OAuth Client ID (Web application)
   - Set the authorized redirect URI to `http://127.0.0.1:8000/api/auth/google/callback`

---

## Setup

### 1. Clone and set up the backend

```bash
git clone https://github.com/manish-git-rgb/api-guardian.git
cd api-guardian/backend

python -m venv venv
# Windows:
.\venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Create the database

```sql
CREATE DATABASE api_guardian;
```

### 3. Configure environment variables

Create `backend/.env`:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/api_guardian

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash-lite

CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

JWT_SECRET_KEY=generate_a_long_random_string_here
JWT_ALGORITHM=HS256

GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:8000/api/auth/google/callback

FRONTEND_URL=http://localhost:3000
```

Generate a secure `JWT_SECRET_KEY` with:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 4. Set up the frontend

```bash
cd ../frontend
npm install
```

---

## Running the project

You need **three processes** running at once, plus Memurai as a background service.

**Terminal 1 — backend:**
```bash
cd backend
.\venv\Scripts\Activate.ps1        # or: source venv/bin/activate
uvicorn app.main:app --reload
```

**Terminal 2 — Celery worker:**
```bash
cd backend
.\venv\Scripts\Activate.ps1        # or: source venv/bin/activate
celery -A app.core.celery_app worker --loglevel=info --pool=solo
```
(`--pool=solo` is required on Windows; on macOS/Linux you can omit it)

**Terminal 3 — frontend:**
```bash
cd frontend
npm run dev
```

Then open **http://localhost:3000**, sign up (or sign in with Google), and start comparing specs.

---

## Project structure

```
backend/
  app/
    main.py                — FastAPI app, table creation, CORS, router registration
    core/
      database.py          — SQLAlchemy engine/session
      security.py           — password hashing, JWT, auth dependency
      celery_app.py         — Celery instance (Memurai broker)
    models/models.py        — User, Project, SpecVersion, Comparison, ChangeRow, AIReport
    schemas/schemas.py       — Pydantic request/response schemas
    parser/openapi_parser.py — OpenAPI spec parsing/validation
    diff/engine.py           — the diff + risk-scoring logic
    ai/
      gemini_client.py       — Gemini API wrapper
      explain.py              — prompt-building for explanations/reports
      tasks.py                 — Celery background tasks
    api/
      routes.py               — main CRUD + compare endpoints
      auth_routes.py           — signup/login/Google OAuth endpoints

frontend/
  app/
    page.tsx                 — main dashboard
    login/page.tsx            — login/signup page
    auth/callback/page.tsx     — Google OAuth redirect handler
  lib/api.ts                  — typed API client
```

---

## API overview

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | No | Create an account |
| POST | `/api/auth/login` | No | Log in |
| GET | `/api/auth/google/login` | No | Start Google OAuth flow |
| GET | `/api/auth/google/callback` | No | Google OAuth redirect target |
| GET | `/api/auth/me` | Yes | Get current user |
| POST | `/api/projects` | Yes | Create a project |
| GET | `/api/projects` | Yes | List your projects |
| POST | `/api/projects/{id}/versions` | Yes | Upload a spec version |
| GET | `/api/projects/{id}/versions` | Yes | List a project's versions |
| POST | `/api/projects/{id}/compare` | Yes | Diff two versions, trigger AI generation |
| GET | `/api/comparisons/{id}` | Yes | Get a comparison + its changes |
| GET | `/api/comparisons/{id}/ai-reports` | Yes | Get migration guide / release notes |
| DELETE | `/api/projects/{id}` | Yes | Delete a project (cascades) |
| DELETE | `/api/projects/{id}/versions/{vid}` | Yes | Delete a version |
| DELETE | `/api/comparisons/{id}` | Yes | Delete a comparison |

Full interactive docs available at `http://127.0.0.1:8000/docs` once the backend is running.

---

## Known limitations / roadmap

- **No database migrations yet** — schema is created via `create_all()`, which only adds missing tables and won't handle changes to existing ones. [Alembic](https://alembic.sqlalchemy.org/) should be introduced before any schema changes are needed.
- **No CLI** — everything currently goes through the web UI or API directly.
- **Google OAuth app is in "Testing" mode** — only accounts added as test users in the Google Cloud Console can sign in via Google until the app is verified/published.
- **CORS is restricted to `http://localhost:3000`** — update `allow_origins` in `main.py` before deploying to a different frontend URL.

---

## License

Personal/educational project — no license specified yet.