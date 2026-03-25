# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

JobScout is a Chrome extension (Manifest V3) + Python FastAPI backend that scores job listings in real-time using Claude AI. Users browse LinkedIn, Indeed, and Hiring.cafe — the extension extracts job details, sends them to the local backend, and returns a fit score (0–100) with skills breakdown, gaps, and salary estimates.

## Commands

### Backend
```bash
docker compose up -d                          # Start PostgreSQL (required before backend)
cd backend
uvicorn app.main:app --reload                 # Start dev server at localhost:8000
alembic upgrade head                          # Run pending migrations
alembic revision --autogenerate -m "message"  # Create a new migration
pytest                                        # Run tests
```

### Extension
```bash
cd extension
pnpm install
pnpm build    # One-time build → dist/
pnpm watch    # Watch mode for development
```

Load the extension in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`

## Architecture

### Data Flow
1. `content/index.ts` watches for URL changes on job sites and triggers extraction
2. A site-specific extractor (`content/extractors/*.ts`) scrapes job data from the DOM
3. Content script sends an `ANALYZE_JOB` message to `background/index.ts` (service worker)
4. Background worker POSTs to `POST /api/v1/analyze` — bypassing site CSP restrictions
5. Backend checks the PostgreSQL cache by URL; on miss, calls Claude API and stores result
6. Score is returned to the popup (`popup/index.ts`) and an inline badge (`content/badge.ts`)

### Key Architectural Decisions

**CSP Bypass via Service Worker:** LinkedIn's Content Security Policy blocks fetch calls from content scripts. All backend communication is routed through the Manifest V3 background service worker, which is not subject to page CSP.

**URL-Based Caching:** Every analysis is cached in PostgreSQL by URL. Repeat visits are instant with no API cost. Hiring.cafe uses title+company as a fallback key due to dynamic URLs.

**Score Persistence via `chrome.storage.local`:** The background worker caches scores per URL in extension storage so the popup renders immediately on re-open without re-fetching.

**Application Status Tracking:** `dashboard/index.ts` manages a 6-state lifecycle per job (applied → phone_screen → interviewed → offer → rejected + hidden) persisted in `chrome.storage.local`.

### Backend Layout
```
backend/app/
  api/analyze.py        # Route handlers: POST /api/v1/analyze, GET /api/v1/history
  services/claude.py    # Claude API client, prompt engineering, response parsing
  models/
    job.py              # SQLAlchemy ORM model (JobAnalysis table)
    repository.py       # Cache read/write (get_cached_analysis, save_analysis)
  schemas/analyze.py    # Pydantic request/response models
  config.py             # Settings loaded from backend/.env
  database.py           # SQLAlchemy engine + session factory
```

### Extension Layout
```
extension/src/
  background/index.ts   # Service worker — API relay, score caching, message dispatch
  content/
    index.ts            # URL watcher, job detection, analysis orchestration
    badge.ts            # Inline score badge injected on job cards
    overlay.ts          # Overlay UI for detailed job info
    extractors/         # Site-specific DOM scrapers (linkedin, indeed, hiring-cafe)
  popup/index.ts        # Score ring UI + detailed breakdown
  dashboard/index.ts    # Job history, status tracking, keyword learning
```

### Database
PostgreSQL 16 via Docker. Single table: `job_analyses`. Schema managed with Alembic — migrations live in `backend/alembic/versions/`. Connection string in `backend/.env` as `DATABASE_URL`.

### Environment Variables (`backend/.env`)
- `ANTHROPIC_API_KEY` — required
- `DATABASE_URL` — PostgreSQL connection string
- `ENVIRONMENT` — `development` or `production`

## Adding a New Job Site

1. Create `extension/src/content/extractors/<site>.ts` implementing `ExtractionResult` (see `types.ts`)
2. Register it in `content/index.ts` URL-matching logic
3. Add the site's hostname to `host_permissions` in `extension/public/manifest.json`
