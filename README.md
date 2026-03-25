# Document Management System (DMS)

A secure, scalable document management system with universal document viewing capabilities.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui
- **Backend**: FastAPI, Python, Async SQLAlchemy
- **Database**: PostgreSQL
- **Authentication**: JWT with HTTP-only cookies

## Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 14+
- LibreOffice (for document conversion)

## Local Setup

### 1. Clone the Repository

```bash
git clone git@github.com:raghusbhat/dms.git
cd dms
```

### 2. Database Setup

Create a PostgreSQL database:

```bash
psql -U postgres -c "CREATE DATABASE dms;"
```

### 3. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
copy .env.example .env
# Edit .env with your database credentials and generate a new SECRET_KEY

# Run database migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload --port 8000
```

The backend will be available at `http://localhost:8000`.

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will be available at `http://localhost:5173`.

### 5. LibreOffice Setup

For document conversion (DOCX, XLSX, PPTX to PDF), install LibreOffice:

- **Windows**: Download from https://www.libreoffice.org/download/ and install. Update `libreoffice_path` in `backend/app/config.py` if needed.
- **Linux**: `sudo apt install libreoffice`
- **Mac**: `brew install --cask libreoffice`

## Default Credentials

After running the backend, create a user via the API or use the test endpoint if available.

## API Documentation

Once the backend is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Project Structure

```
dms/
├── backend/
│   ├── app/
│   │   ├── auth/          # Authentication logic
│   │   ├── routers/       # API endpoints
│   │   ├── models/        # SQLAlchemy models
│   │   ├── storage/       # Storage abstraction
│   │   └── conversion/    # Document conversion
│   ├── alembic/           # Database migrations
│   └── data/              # Local file storage
├── frontend/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── contexts/      # React contexts
│   │   └── lib/           # Utilities and API client
│   └── public/
└── misc/                  # Documentation
```

## Development

### Running Tests

```bash
# Backend
cd backend
pytest

# Frontend
cd frontend
npm test
```

### Environment Variables

**Backend** (`.env`):
- `DATABASE_URL`: PostgreSQL connection string
- `SECRET_KEY`: Random string for JWT signing (generate with `openssl rand -hex 32`)
- `ENVIRONMENT`: `development` or `production`

**Frontend**: No environment variables needed for local development. API URL is hardcoded to `http://localhost:8000`.

## Common Issues

### Database Connection Error

Ensure PostgreSQL is running and the `DATABASE_URL` in `.env` matches your setup.

### LibreOffice Not Found

Verify LibreOffice is installed and the path in `backend/app/config.py` is correct.

### CORS Issues

The backend is configured to allow requests from `http://localhost:5173`. If using a different port, update CORS settings in `backend/app/main.py`.

## License

Internal use only.
