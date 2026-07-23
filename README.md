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
- 🐳 **One-command startup** — full stack runs via Docker Compose
- 🧬 **Proper schema migrations** — Alembic-managed, not just `create_all()`
- 🧑‍💻 **CLI** — a command-line wrapper for scripting/CI use (see `cli/`)

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python) |
| Database | PostgreSQL + SQLAlchemy + Alembic |
| Background jobs | Celery |
| Job queue / broker | Redis (Memurai on native Windows, plain Redis in Docker) |
| AI | Google Gemini (`google-genai` SDK) |
| Auth | JWT (`python-jose`) + `passlib` (bcrypt) + Google OAuth 2.0 |
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS |
| Containerization | Docker + Docker Compose |

---

## Quick start with Docker (recommended)

This is the easiest way to run the whole stack — one command, no manual setup of Postgres/Redis/Python venvs needed.

### Prerequisites
- **Docker Desktop** installed and running
- A **Google Gemini API key** (free tier, no card required) — from [Google AI Studio](https://aistudio.google.com/) → Get API key
- **Google OAuth credentials** — from [Google Cloud Console](https://console.cloud.google.com/): create a project → configure the OAuth consent screen (External, add yourself as a test user) → create an OAuth Client ID (Web application) → set the authorized redirect URI to `http://127.0.0.1:8000/api/auth/google/callback`

### Setup

```bash
git clone https://github.com/manish-git-rgb/api-guardian.git
cd api-guardian
```

Create `backend/.env`:

```
DATABASE_URL=postgresql://postgres:280105@localhost:5432/api_guardian

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

> Note: `docker-compose.yml` overrides `DATABASE_URL` and `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` internally to point at its own containers (`db`, `redis`) — the values above are only used for anything not overridden (Gemini key, JWT secret, Google OAuth). You don't need to change them for Docker.

Generate a secure `JWT_SECRET_KEY` with:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Run

```bash
docker-compose up --build
```

First run takes a few minutes (building images, installing dependencies). Once you see logs from `backend-1`, `celery-worker-1`, and `frontend-1` all running, open **http://localhost:3000**.

Docker's Postgres runs on host port `5433` and Redis on `6380` (to avoid clashing with any local installs), but the app itself only needs port `3000` (frontend) and `8000` (backend) exposed to your browser.

Subsequent runs (once images are built) can just use:
```bash
docker-compose up
```

---

## Alternative: manual setup (without Docker)

<details>
<summary>Click to expand — running each service natively instead of in containers</summary>

### Prerequisites
1. **Python 3.12** (not 3.14 — some dependencies lack prebuilt wheels for it)
2. **Node.js** (any recent LTS)
3. **PostgreSQL**, installed and running locally
4. **[Memurai](https://www.memurai.com/get-memurai)** (Windows) or plain Redis (macOS/Linux) — broker for Celery
5. Gemini API key + Google OAuth credentials (same as above)

### Setup

```bash
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1        # or: source venv/bin/activate
pip install -r requirements.txt
```

Create the database:
```sql
CREATE DATABASE api_guardian;
```

Create `backend/.env` as described above, but with `DATABASE_URL`, `CELERY_BROKER_URL`, and `CELERY_RESULT_BACKEND` pointing at `localhost` (5432 and 6379) instead of Docker service names.

Apply migrations:
```bash
alembic upgrade head
```

Set up the frontend:
```bash
cd ../frontend
npm install
```

### Running (3 terminals)

**Terminal 1 — backend:**
```bash
cd backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

**Terminal 2 — Celery worker:**
```bash
cd backend
.\venv\Scripts\Activate.ps1
celery -A app.core.celery_app worker --loglevel=info --pool=solo
```
(`--pool=solo` is required on Windows; omit on macOS/Linux)

**Terminal 3 — frontend:**
```bash
cd frontend
npm run dev
```

</details>

---

## CLI usage

A command-line wrapper lives in `cli/`, useful for scripting or CI/CD pipelines (e.g. failing a build automatically when a breaking change is detected).

```bash
cd cli
python cli.py login
python cli.py projects create --name my-api
python cli.py upload --project my-api --label v1 --file spec_v1.json
python cli.py upload --project my-api --label v2 --file spec_v2.json
python cli.py compare --project my-api --from v1 --to v2 --wait-ai
```

`compare` exits with code `2` if the risk score is `critical` or `high` — check this in a CI script to fail a build on breaking changes.

---

## Project structure

```
backend/
  Dockerfile
  app/
    main.py                 — FastAPI app, CORS, router registration
    core/
      database.py            — SQLAlchemy engine/session
      security.py             — password hashing, JWT, auth dependency
      celery_app.py            — Celery instance
    models/models.py           — User, Project, SpecVersion, Comparison, ChangeRow, AIReport
    schemas/schemas.py          — Pydantic request/response schemas
    parser/openapi_parser.py     — OpenAPI spec parsing/validation
    diff/engine.py                — the diff + risk-scoring logic
    ai/
      gemini_client.py            — Gemini API wrapper (google-genai SDK)
      explain.py                   — prompt-building for explanations/reports
      tasks.py                      — Celery background tasks
    api/
      routes.py                     — main CRUD + compare endpoints
      auth_routes.py                 — signup/login/Google OAuth endpoints
  alembic/                            — schema migrations

frontend/
  Dockerfile
  app/
    page.tsx                 — main dashboard
    login/page.tsx            — login/signup page
    auth/callback/page.tsx      — Google OAuth redirect handler
  lib/api.ts                    — typed API client

cli/
  cli.py                        — command-line wrapper

docker-compose.yml
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
| POST | `/api/projects/{id}/versions` | Yes | Upload a spec version (JSON or YAML) |
| GET | `/api/projects/{id}/versions` | Yes | List a project's versions |
| DELETE | `/api/projects/{id}/versions/{vid}` | Yes | Delete a version |
| POST | `/api/projects/{id}/compare` | Yes | Diff two versions, trigger AI generation |
| GET | `/api/comparisons/{id}` | Yes | Get a comparison + its changes |
| GET | `/api/comparisons/{id}/ai-reports` | Yes | Get migration guide / release notes |
| DELETE | `/api/comparisons/{id}` | Yes | Delete a comparison (cascades) |
| DELETE | `/api/projects/{id}` | Yes | Delete a project (cascades) |

Full interactive docs available at `http://127.0.0.1:8000/docs` once the backend is running.

---

## Known limitations

- **Google OAuth app is in "Testing" mode** — only accounts added as test users in the Google Cloud Console can sign in via Google until the app is verified/published.
- **CLI wrapper** is written but not yet fully verified in all terminal environments — if commands appear to hang or produce no output, try passing `--email`/`--password` flags directly instead of the interactive prompts, and run with `python -u cli.py ...` to disable output buffering.
- **CORS is restricted to `http://localhost:3000`** — update `allow_origins` in `main.py` before deploying to a different frontend URL.

---

## License

Personal/educational project — no license specified yet.