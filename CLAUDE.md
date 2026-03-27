# AI Context — DMS Project

This file is for AI coding assistants (Claude Code, Cursor, Copilot, ChatGPT, Gemini, etc.).
Read this before suggesting any code changes.

---

## What This Project Is

An AI-native Document Management System (DMS). The core idea:
upload any document → AI reads, classifies, and summarises it → routes it to the right reviewer
→ reviewer sees AI analysis, not a blank PDF → approves, rejects, or returns with a comment.

This is a **commercial product in development**. Single-tenant for now.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui |
| Backend | FastAPI, Python 3.13, async SQLAlchemy 2.0 |
| Database | PostgreSQL 16 |
| Background jobs | Celery + Redis |
| AI | Gemini 2.5 Flash (default) or Ollama — swappable via `AI_PROVIDER` env var |
| Doc conversion | LibreOffice (Office → PDF for preview) |
| Search | Meilisearch (in Docker, not yet wired) |
| File storage | Local filesystem (dev) / MinIO / S3 — swappable via `STORAGE_BACKEND` |

---

## Repository Layout

```
dms/
├── CLAUDE.md                ← you are here
├── README.md                ← full developer setup guide
├── docker-compose.yml       ← PostgreSQL, Redis, MinIO, Meilisearch, Mailhog
├── backend/
│   ├── .env                 ← local config (never commit)
│   ├── .env.example         ← template — copy to .env
│   ├── requirements.txt
│   ├── alembic/versions/    ← one migration file per schema change
│   ├── scripts/
│   │   ├── create_admin.py  ← run once: creates Admin role + first admin user
│   │   └── seed_workflow.py ← run once: reviewer role + test user + catch-all workflow rule
│   └── app/
│       ├── main.py          ← FastAPI app, CORS, router registration
│       ├── config.py        ← all settings loaded from .env (Pydantic Settings)
│       ├── database.py      ← async SQLAlchemy engine + session
│       ├── auth/
│       │   ├── router.py    ← /auth/login, /auth/refresh, /auth/logout, /auth/me
│       │   ├── dependencies.py  ← get_current_user, require_role() factory
│       │   ├── security.py  ← JWT encode/decode, bcrypt, token expiry constants
│       │   └── schemas.py   ← LoginRequest, UserResponse
│       ├── models/
│       │   ├── base.py      ← Base, TimestampMixin (created_at + updated_at)
│       │   ├── user.py      ← User, Role
│       │   ├── document.py  ← Document, DocumentVersion, Folder
│       │   ├── extraction.py ← DocumentExtraction
│       │   └── workflow.py  ← WorkflowRule, WorkflowInstance, WorkflowTask
│       ├── routers/
│       │   ├── documents.py ← upload, list, get, preview, download
│       │   └── workflow.py  ← queue, approve/reject/return, admin rules CRUD
│       ├── services/
│       │   ├── ai.py        ← Gemini/Ollama classification → ClassificationResult
│       │   ├── extraction.py ← text extraction (pdfplumber, OCR, Excel)
│       │   └── ner.py       ← spaCy entity extraction
│       ├── storage/
│       │   └── local.py     ← save/read/delete files on local filesystem
│       ├── conversion/
│       │   └── libreoffice.py ← convert Office → PDF via subprocess
│       └── workers/
│           ├── celery_app.py    ← Celery instance config
│           └── extraction_worker.py ← full pipeline: extract → NER → AI → workflow routing
└── frontend/
    └── src/
        ├── App.tsx          ← routes
        ├── contexts/
        │   └── AuthContext.tsx   ← user state, login/logout
        ├── lib/
        │   ├── api.ts       ← fetch wrapper with 401→refresh interceptor
        │   └── format.ts    ← formatDate, formatBytes
        ├── types/
        │   └── document.ts  ← Document, DocumentVersion, DocumentExtraction, WorkflowTask
        ├── constants/
        │   └── navigation.tsx ← PRIMARY_NAV, SECONDARY_NAV arrays
        ├── components/
        │   ├── auth/RequireAuth.tsx
        │   └── layout/AppLayout.tsx
        └── pages/
            ├── LoginPage.tsx
            ├── DashboardPage.tsx
            ├── DocumentsPage.tsx
            ├── DocumentViewerPage.tsx
            ├── TasksPage.tsx
            ├── SearchPage.tsx
            └── AdminPage.tsx
```

---

## What Is Already Built

### Phase 1 — Core ✅
- JWT auth with httpOnly cookies, auto-refresh (60-min access token, 7/30-day refresh with remember-me)
- Upload → store → serve documents (PDF, DOCX, XLSX, PPTX, images)
- PDF.js viewer with zoom, rotate, page count
- LibreOffice conversion for Office file preview
- Download original files

### Phase 2 — Background Processing ✅
- Celery + Redis pipeline: upload dispatches task → extract text → NER → AI → save
- Document status: `uploaded → processing → ready / processing_failed`
- Frontend polls document status until `ready`

### Phase 3 — AI Classification ✅
- Gemini 2.5 Flash classifies: document_type, sensitivity, summary, tags, key_fields
- Results displayed in document viewer right panel
- Workflow routing happens inside the Celery worker after AI finishes

### Phase 4 — Workflow Engine ✅
- `workflow_rules` table: match on document_type + sensitivity → assign to role
- `NULL` values in rule = wildcard (catch-all rule matches everything)
- After AI classification, worker matches best rule (exact match preferred over catch-all) and creates WorkflowInstance + WorkflowTask for every active user with the target role
- `/workflow/queue` — reviewer sees their pending tasks
- `/workflow/tasks/{id}/approve|reject|return` — reviewer acts with optional/required comment
- `/workflow/admin/rules` — Admin CRUD on rules
- Tasks page (`/tasks`) and workflow panel in document viewer right sidebar

### Not Yet Built
- Full-text search (Meilisearch wired in Docker, not yet indexed)
- Email/in-app notifications
- Audit trail writing (model exists, not being written to)
- Admin panel for user management
- Vector search / RAG
- Contract intelligence (clause extraction)

---

## Architecture Decisions

**Single-tenant only.** No multi-tenancy until a paying customer requests it.
When needed: schema-per-tenant (one PostgreSQL instance, separate schema per org).
Do not add tenant_id columns or row-level security now.

**Role system:** Roles are stored in a `roles` table. `require_role(*roles)` is a FastAPI
dependency factory in `auth/dependencies.py`. Always use it for protected routes.

**AI is optional.** `AI_ENABLED=false` in `.env` skips classification. The pipeline
still runs text extraction and NER.

**Workflow tasks are fan-out.** When a rule matches, one task is created per user with
the target role — not one task shared by all. First user to act = done.
(This is intentional for now. Sequential/parallel chains are Phase 6.)

**Storage is abstracted.** Never write `open()` or file paths directly in routers.
Always go through the storage adapter in `app/storage/`.

**Async SQLAlchemy.** All routers and services use `AsyncSession`.
The Celery worker uses sync `psycopg2` (not asyncpg) because Celery is synchronous.
When using `joinedload` with collections, always call `.unique().scalars().all()`.

---

## Key Patterns

### Protecting a route by role
```python
from app.auth.dependencies import require_role

@router.get("/something")
async def my_endpoint(
    current_user: User = Depends(require_role("reviewer", "Admin")),
):
    ...
```

### Adding a new migration
```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

### Frontend API calls
All API calls go through `src/lib/api.ts`. It handles 401 → refresh → retry automatically.
```typescript
const res = await api.get("/some/endpoint");
if (!res.ok) throw new Error("...");
const data = await res.json();
```

### Adding a new page
1. Create `src/pages/NewPage.tsx`
2. Add route in `src/App.tsx`
3. Add nav entry in `src/constants/navigation.tsx` if it needs a sidebar link

---

## Known Gotchas

**Windows env vars override .env.**
Do NOT set `GEMINI_API_KEY` (or any key) as a Windows system environment variable.
It silently overrides the `.env` file. Store all secrets only in `backend/.env`.

**Celery must start in a fresh terminal after changing env vars.**
Old terminal windows inherit the old environment. Always open a new terminal.

**Celery on Windows requires `--pool=solo`.**
```bash
celery -A app.workers.celery_app worker --loglevel=info --pool=solo
```

**Gemini model name.**
Correct: `gemini-2.5-flash`. Do not use `gemini-2.0-flash` or other variants — they
have zero quota on the free tier.

**`datetime.now()` must be timezone-aware.**
Always use `datetime.now(timezone.utc)`, never `datetime.now()`.

**Tags are in `key_fields`, not a top-level column.**
`DocumentExtraction` has no `tags` column. Tags are stored as `key_fields["tags"]` (list of strings).
In the frontend: `doc.extraction.key_fields?.tags`.

---

## Test Accounts (after running seed scripts)

| Email | Password | Role |
|---|---|---|
| admin@perspectiv.in | perspectiv!2026 | Admin |
| reviewer@perspectiv.in | reviewer123 | reviewer |

---

## First-Time Setup Sequence

```bash
# 1. Start infrastructure
cd dms/
docker compose up -d

# 2. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # Linux/Mac
pip install -r requirements.txt
python -m spacy download en_core_web_sm
cp .env.example .env            # fill in SECRET_KEY and GEMINI_API_KEY
alembic upgrade head
python scripts/create_admin.py
python scripts/seed_workflow.py

# 3. Run backend (Terminal 1)
uvicorn app.main:app --reload

# 4. Run Celery (Terminal 2 — fresh terminal)
celery -A app.workers.celery_app worker --loglevel=info --pool=solo

# 5. Frontend (Terminal 3)
cd ../frontend
npm install
npm run dev
```

App: http://localhost:5173 | API docs: http://localhost:8000/docs
