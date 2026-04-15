# JobScout

A full-stack job search platform built around a Chrome extension that scores job listings in real time using Claude AI. Built as a portfolio project spanning a Python backend, PostgreSQL database, React web app, Chrome extension, and background automation.

## What it does

JobScout connects every part of a job search into one system:

**Real-time scoring** — As you browse LinkedIn, Indeed, or Hiring.cafe, the extension extracts job details and scores your fit (0–100) using Claude. Results appear inline on job cards and in the toolbar popup with matched skills, transferable experience, gaps, and flags — without leaving the page.

**Web app** — A companion React app lets you review your full job history, filter by score, status, site, or recency, and see an application funnel (applied → phone screen → interviewed → offer) with response and offer rates.

**Background scraper** — Save searches on Hiring.cafe and the backend polls them on a schedule, scores new matches against your profile, and emails results via SendGrid.

**Multi-profile support** — Maintain separate resume profiles and score jobs against whichever profile is active, keeping history and recommendations per-profile.

**Application tracking** — Track each job through a 6-state lifecycle (applied → phone screen → interviewed → offer → rejected) from either the extension or the web app.

**Keyword learning** — The extension observes which jobs you engage with and which you skip, building per-user keyword weights that automatically surface better matches over time.

## Architecture

```
Chrome Extension (Manifest V3 + TypeScript)
├── Content script      → Extracts job data from LinkedIn / Indeed / Hiring.cafe DOM
├── Background worker   → API relay (CSP bypass), score cache, message dispatch
├── Popup UI            → Score ring, verdict, and skills breakdown
├── Dashboard page      → Job history, status tracking, keyword management
└── Extension pages     → Login, interview prep, app assist

FastAPI Backend (Python)
├── /api/v1/analyze     → Score a job via Claude; cache by URL
├── /api/v1/history     → Paginated, filtered job history with stats
├── /auth/*             → JWT auth (register, login, web login w/ HTTP-only cookie)
├── /scraper/*          → Saved searches, credentials, scraped job results
├── /profiles/*         → Resume profile management
├── /keywords/*         → Keyword weight read/write
├── /targeting/*        → Reach/targeting job scoring
└── /health             → Health check

React Web App (Vite + Tailwind + shadcn/ui)
├── Served by FastAPI from backend/app/static/web/
├── JWT auth via HTTP-only cookie
└── Pages: Job History, While You Were Gone, Filters, Targeting, Account

PostgreSQL Database
├── job_analyses        → Cached scores, full breakdown, application status
├── users               → Accounts with hashed passwords
├── user_profiles       → Multiple resume profiles per user
├── scraper_searches    → Saved Hiring.cafe searches
├── scraper_credentials → Encrypted site credentials
├── scraped_jobs        → Background scraper results
├── keyword_weights     → Per-user keyword learning signals
└── targeting_jobs      → Reach/targeting job queue
```

## Tech stack

| Layer              | Technology                                      |
| ------------------ | ----------------------------------------------- |
| Browser extension  | TypeScript, Manifest V3, Webpack                |
| Web frontend       | React, Vite, Tailwind CSS, shadcn/ui            |
| Backend framework  | Python, FastAPI, Uvicorn                        |
| AI integration     | Anthropic Claude API                            |
| Database           | PostgreSQL 16, SQLAlchemy ORM                   |
| Migrations         | Alembic                                         |
| Data validation    | Pydantic v2                                     |
| Auth               | JWT (PyJWT), HTTP-only cookies, Fernet encryption|
| Background jobs    | APScheduler                                     |
| Email              | SendGrid                                        |
| Containerization   | Docker, Docker Compose                          |
| Package management | uv (Python), pnpm (Node)                        |

## Project structure

```
jobscout/
├── backend/
│   ├── app/
│   │   ├── api/           # Route handlers (analyze, auth, scraper, profiles, keywords, targeting)
│   │   ├── models/        # SQLAlchemy ORM models + repository pattern
│   │   ├── schemas/       # Pydantic request/response models
│   │   ├── services/      # Claude, auth, email, hiring.cafe fetcher, scraper poll, encryption
│   │   ├── static/web/    # Compiled React SPA (served by FastAPI)
│   │   ├── config.py      # Environment-based settings
│   │   ├── database.py    # Session management
│   │   └── main.py        # FastAPI app, middleware, APScheduler startup
│   ├── alembic/           # Database migrations
│   └── tests/             # pytest test suite
├── extension/
│   ├── src/
│   │   ├── background/    # Service worker — API relay, score cache, message dispatch
│   │   ├── content/       # URL watcher, DOM scrapers, inline badge, overlay
│   │   │   └── extractors/ # LinkedIn, Indeed, Hiring.cafe
│   │   ├── popup/         # Score ring UI
│   │   ├── dashboard/     # Job history table + keyword management
│   │   ├── login/         # Extension login page
│   │   ├── interview/     # Interview prep page
│   │   └── app-assist/    # Application assist page
│   ├── public/            # manifest.json + HTML shells
│   └── webpack.config.js
├── frontend/              # React web app source
│   └── src/
│       ├── api/           # Typed API clients
│       ├── components/    # Shared UI (ScoreRing, StatusPill, Layout, shadcn)
│       ├── pages/         # JobHistory, WhileYouWereGone, Filters, Targeting, Login, Account
│       ├── hooks/         # useAuth
│       └── types/
├── deploy-web.sh          # Build frontend → copy to backend/app/static/web/
└── docker-compose.yml
```

## Key engineering decisions

**Background worker as CSP bypass** — LinkedIn's Content Security Policy blocks outbound fetch calls from page-injected scripts. The content script passes job data via `chrome.runtime.sendMessage` to the background service worker, which runs in the extension's own context and is not subject to page CSP.

**SPA URL watcher** — LinkedIn and Hiring.cafe are single-page applications. A persistent `MutationObserver` monitors DOM changes and detects URL transitions, triggering a fresh analysis cycle on each new job without requiring a page reload.

**Web app served from FastAPI** — Rather than deploying the React app separately, `deploy-web.sh` compiles the Vite bundle and copies it into `backend/app/static/web/`. FastAPI serves the SPA with a catch-all route for client-side routing. One deployment, one domain.

**User-supplied API keys** — The backend no longer holds a single Anthropic API key. Each user provides their own key, stored encrypted with Fernet, so the platform scales to multiple users without sharing API quota.

**URL-based caching** — Analyzed jobs are cached in PostgreSQL keyed by URL. Repeat visits return instantly with zero API cost. Hiring.cafe uses title + company as a fallback key due to dynamic URLs.

**Fernet encryption for credentials** — Hiring.cafe session cookies and API keys are stored encrypted at rest. The encryption key is held only in the server environment, never in the database.

**Repository pattern** — Database logic is isolated behind a repository layer, keeping route handlers thin and data access testable in isolation.

## Local setup

### Prerequisites

- Python 3.11+
- Node.js 18+ and pnpm
- Docker Desktop
- Chrome browser

### Backend

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
cd backend
uv venv
source .venv/bin/activate   # macOS/Linux
.venv\Scripts\Activate.ps1  # Windows
uv pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env — see Environment Variables below

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

API docs at `http://127.0.0.1:8000/docs`

### Web app

```bash
cd frontend
pnpm install
pnpm dev        # Dev server at localhost:5173

# Or build and deploy into the backend:
cd ..
./deploy-web.sh  # compiles and copies to backend/app/static/web/
```

### Chrome extension

```bash
cd extension
pnpm install
pnpm build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist/`

After any source change: `pnpm build`, then click the reload icon on the extension card.

### Environment variables (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | Fernet key — generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens |
| `ENVIRONMENT` | No | `development` or `production` (default: `development`) |
| `SENDGRID_API_KEY` | No | For scraper email notifications |
| `SENDGRID_FROM_EMAIL` | No | Sender address for scraper emails |

## License

MIT
