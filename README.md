# DMS — AI-Native Document Management System

An AI-assisted document management system that understands documents, not just stores them.

**Core idea:** Upload any document → AI reads it, classifies it, checks for problems, routes it to the right reviewer → reviewer sees AI summary + risk flags, not a blank PDF.

Full design: [`misc/architecture.md`](misc/architecture.md) | Task list: [`misc/todo.md`](misc/todo.md)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui |
| Backend | FastAPI, Python 3.11+, Async SQLAlchemy |
| Database | PostgreSQL 16 + pgvector |
| Background Jobs | Celery + Redis |
| File Storage | Local filesystem (dev) / MinIO / S3 |
| AI | Gemini API (default) or Ollama (local/private) |
| Full-text Search | Meilisearch |
| Doc Conversion | LibreOffice |

---

## Prerequisites

You need these installed before starting:

| Tool | Version | Where to get it |
|---|---|---|
| Python | 3.11+ | https://www.python.org/downloads/ |
| Node.js | 18+ | https://nodejs.org/ |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop/ |
| LibreOffice | latest | https://www.libreoffice.org/download/ |
| Git | any | https://git-scm.com/ |

> **PostgreSQL, Redis, MinIO, Meilisearch** — all started automatically via Docker.

---

## Quick Start (3 steps)

### Step 1 — Start infrastructure (Docker)

```bash
cd dms
docker compose up -d
```

This starts:
- PostgreSQL on port **5433** (pgvector enabled) — port 5432 is reserved for other projects
- Redis on port 6379
- MinIO on port 9002 (web console: http://localhost:9003, user: minioadmin / minioadmin)
- Meilisearch on port 7700 (http://localhost:7700)
- Mailhog on port 8025 — catches all outgoing email (http://localhost:8025)

Check everything is running:
```bash
docker compose ps
```

### Step 2 — Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create your .env file
copy .env.example .env      # Windows
cp .env.example .env        # Linux/Mac

# Run database migrations
alembic upgrade head

# Create the first admin user
python scripts/create_admin.py

# Seed roles, test reviewer user, and default workflow rule
python scripts/seed_workflow.py

# Index existing documents into Meilisearch (run once after setup)
python scripts/reindex_all.py

# Start the backend
uvicorn app.main:app --reload --port 8000
```

Backend is running at: http://localhost:8000
API docs: http://localhost:8000/docs

### Step 3 — Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend is running at: http://localhost:5173

---

## Environment Variables

All config goes in `backend/.env`. Copy from `backend/.env.example`.

**Required to get started:**

| Variable | Example | What it does |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5433/dms` | Database connection |
| `SECRET_KEY` | `openssl rand -hex 32` | JWT signing key |

**For AI features (Phase 3):**

| Variable | Example | What it does |
|---|---|---|
| `AI_PROVIDER` | `gemini` or `ollama` | Which AI to use |
| `GEMINI_API_KEY` | `AIza...` | Required if AI_PROVIDER=gemini |
| `OLLAMA_URL` | `http://localhost:11434` | Required if AI_PROVIDER=ollama |

**For file storage (optional, default is local folder):**

| Variable | Example | What it does |
|---|---|---|
| `STORAGE_BACKEND` | `local` / `minio` / `s3` | Where files are saved |
| `MINIO_ENDPOINT` | `localhost:9000` | Required if STORAGE_BACKEND=minio |

See `backend/.env.example` for all variables with comments.

---

## Project Structure

```
dms/
├── docker-compose.yml       ← starts Redis, MinIO, Meilisearch (PostgreSQL is external)
├── README.md
├── backend/
│   ├── .env.example         ← copy to .env and fill in values
│   ├── requirements.txt     ← Python dependencies
│   ├── alembic/             ← database migrations
│   │   └── versions/        ← one file per migration
│   ├── scripts/
│   │   ├── create_admin.py  ← run once after first migration (creates admin user)
│   │   ├── seed_workflow.py ← run once after create_admin (creates reviewer role + test user + workflow rule)
│   │   ├── reindex_all.py   ← run once after setup to index existing documents into Meilisearch
│   │   └── reembed_all.py   ← utility: re-embed documents if RAG was added to an existing install
│   └── app/
│       ├── main.py          ← FastAPI app, CORS, startup
│       ├── config.py        ← all settings from .env
│       ├── auth/            ← JWT login, refresh, logout
│       ├── models/          ← SQLAlchemy database models
│       ├── routers/         ← API endpoints
│       ├── storage/         ← file storage (local/minio/s3)
│       ├── conversion/      ← LibreOffice document conversion
│       ├── services/        ← business logic (AI, extraction, etc.)
│       └── workers/         ← Celery background tasks
├── frontend/
│   └── src/
│       ├── components/      ← reusable UI components
│       ├── pages/           ← page-level components
│       ├── contexts/        ← React state (auth, etc.)
│       └── lib/             ← API client, utilities
└── misc/                    ← design documents
    ├── architecture.md      ← full system design
    ├── todo.md              ← prioritized task list
    ├── workflow-design.md   ← AI workflow design
    └── claude-explain.md    ← plain-language project overview
```

---

## Useful Commands

### Backend

```bash
# Run database migrations
alembic upgrade head

# Create a new migration (after changing a model)
alembic revision --autogenerate -m "add status to documents"

# Start Celery worker (needed for background jobs — Phase 1+)
celery -A app.workers.celery_app worker --loglevel=info

# Start Celery Beat scheduler (for periodic tasks — escalation, deadline alerts)
celery -A app.workers.celery_app beat --loglevel=info

# Run tests
pytest
```

### Docker

```bash
# Start all services
docker compose up -d

# Stop all services (data is kept)
docker compose down

# Stop and delete all data (clean slate)
docker compose down -v

# See logs for a service
docker compose logs redis
docker compose logs meilisearch

# Connect to PostgreSQL directly
docker exec -it dms_postgres psql -U postgres -d dms
```

### Frontend

```bash
npm run dev      # development server
npm run build    # production build
npm run lint     # check for lint errors
```

---

## Common Issues

### "Database connection refused"
Make sure Docker is running and the containers are up:
```bash
docker compose up -d
docker compose ps
```

### "LibreOffice not found"
Check `LIBREOFFICE_PATH` in your `.env`. Default is `C:\Program Files\LibreOffice\program\soffice.exe` on Windows.
On Linux: `which soffice` to find the path.

### "Alembic migration fails"
Make sure Docker containers are running and `DATABASE_URL` in `.env` points to port `5433`.
```bash
docker compose up -d
```

### "CORS error in browser"
The backend allows requests from `http://localhost:5173`. If your frontend runs on a different port, update `CORS_ORIGINS` in `backend/app/main.py`.

### "Module not found" in backend
Make sure the virtual environment is active:
```bash
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate
```

---

## What Works Right Now

**Phase 1 — Core**
- Upload documents (PDF, DOCX, XLSX, PPTX, images)
- View documents (PDF.js viewer with zoom, rotate, page count)
- Download originals
- Preview Office files (converted to PDF via LibreOffice)
- JWT authentication with httpOnly cookies, token refresh, logout
- Remember me (30-day session)

**Phase 2 — Background Processing**
- Celery + Redis pipeline: text extraction, NER entities
- Document status tracking (uploaded → processing → ready / failed)
- Real-time status polling in the UI

**Phase 3 — AI Classification**
- Gemini API integration (model: gemini-2.5-flash)
- Auto-classifies document type, sensitivity, summary, tags, key fields
- Results shown in document viewer right panel

**Phase 4 — Workflow Engine**
- Rule-based routing: match on document type and/or sensitivity → assign to role
- Tasks page: reviewers see their pending queue with search, filters, sort
- Approve / Reject / Return with comments, directly from the document viewer
- Admin can manage workflow rules via `/admin`

**Phase 5 — Full-Text Search**
- Meilisearch-powered search in the Documents table (title, summary, extracted text)
- Search bar queries Meilisearch for relevance ranking, results fetched from PostgreSQL
- New documents auto-indexed after processing

**Phase 7 — Vector Search / RAG**
- pgvector embeddings (bge-small-en-v1.5, 384-dim) stored per document chunk
- "Ask this document" in the document viewer — answers questions from document content
- New documents auto-embedded after processing via Celery

**Default test accounts** (after running seed scripts):
| Email | Password | Role |
|---|---|---|
| admin@perspectiv.in | *(set during create_admin.py)* | Admin |
| reviewer@perspectiv.in | reviewer123 | reviewer |

**Coming next** (see [`misc/todo.md`](misc/todo.md)):
- Real-time notifications (WebSocket)
- Contract intelligence — clause extraction, deadline alerts
- Audit trail — full activity log

---

## API Documentation

Running backend → visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## License

Internal use only — commercial product in development.
