# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

JobScout is a Chrome extension (Manifest V3) + Python FastAPI backend + React web app that scores job listings in real-time using Claude AI. Users browse LinkedIn, Indeed, and Hiring.cafe — the extension extracts job details, sends them to the backend, and returns a fit score (0–100) with skills breakdown, gaps, and salary estimates. A background scraper watches saved searches and emails new matches.

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
pnpm build    # Webpack build → dist/  (uses webpack.config.js)
pnpm watch    # Watch mode for development
```

Load the extension in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`

After any source change, run `pnpm build` (or let `pnpm watch` rebuild), then click the reload icon on the extension card in `chrome://extensions`.

### Web app (frontend)
```bash
cd frontend
pnpm install
pnpm dev      # Dev server at localhost:5173 (proxies API to localhost:8000)
pnpm build    # Build → frontend/dist/
```

To deploy the web app into the backend (so FastAPI serves it):
```bash
./deploy-web.sh   # runs pnpm build then copies dist/ to backend/app/static/web/
```

## Architecture

### Data Flow
1. `content/index.ts` watches for URL changes on job sites and triggers extraction
2. A site-specific extractor (`content/extractors/*.ts`) scrapes job data from the DOM
3. Content script sends an `ANALYZE_JOB` message to `background/index.ts` (service worker)
4. Background worker POSTs to `POST /api/v1/analyze` — bypassing site CSP restrictions
5. Backend checks the PostgreSQL cache by URL; on miss, calls Claude API and stores result
6. Score is returned to the popup (`popup/index.ts`) and an inline badge (`content/badge.ts`)
7. The React web app reads the same backend (auth via HTTP-only JWT cookie) for history, stats, and scraper management

### Key Architectural Decisions

**CSP Bypass via Service Worker:** LinkedIn's Content Security Policy blocks fetch calls from content scripts. All backend communication is routed through the Manifest V3 background service worker, which is not subject to page CSP.

**URL-Based Caching:** Every analysis is cached in PostgreSQL by URL. Repeat visits are instant with no API cost. Hiring.cafe uses title+company as a fallback key due to dynamic URLs.

**Web App Served from FastAPI:** The React/Vite frontend is compiled by `deploy-web.sh` into `backend/app/static/web/`. FastAPI serves it at `/` with a catch-all SPA fallback route. One deployment, one domain, no CORS complexity.

**Score Persistence via `chrome.storage.local`:** The background worker caches scores per URL in extension storage so the popup renders immediately on re-open without re-fetching.

**Application Status Tracking:** Both `dashboard/index.ts` (extension) and the web app manage a 6-state lifecycle per job (`applied → phone_screen → interviewed → offer → rejected → null`). Status changes in the extension sync to the backend; the web app reads from the backend directly.

**User-Supplied API Keys:** Each user stores their own Anthropic API key, encrypted with Fernet, in the database. There is no shared server-level API key.

**Fernet Encryption:** Hiring.cafe session cookies and API keys are encrypted at rest using a server-held Fernet key. Never stored in plaintext.

### `chrome.storage.local` Key Schema

| Key pattern | Written by | Value | Purpose |
|---|---|---|---|
| `score_<url>` | background | `StoredScore` object | Per-URL score cache for popup |
| `score_jobid_<jobId>` | content | `StoredScore` object | Per-job score cache read by dashboard |
| `status_<jobId>` | dashboard | `AppStatus` string | Application lifecycle status |
| `applied_<jobId>` | background | `true` | Legacy applied flag (migrated to `status_` on load) |
| `user_dimmed_<jobId>` | content | `true` | Manually hidden jobs |
| `user_undimmed_<jobId>` | dashboard | `true` | Re-shown jobs (overrides auto-dim) |
| `kw_hide_<ngram>` | content | count | Hide signal weight for keyword |
| `kw_show_<ngram>` | content | count | Show signal weight for keyword |
| `auth_jwt` | login page | JWT string | Token used by background worker for API calls |

`StoredScore` shape: `{ result: AnalyzeResponse, jobTitle, company, timestamp, salary?, easyApply?, jobAge?, jobAgeIsOld?, url? }`

### Webpack Bundle Entries

Each entry in `webpack.config.js` maps to an independent JS bundle in `dist/`:
- `background` → service worker
- `content` → injected into job site pages
- `popup` → toolbar popup
- `dashboard` → full-page job history/tracking tab
- `login` → extension login page
- `interview` → interview prep page
- `app-assist` → application assist page

HTML files are copied from `extension/public/` to `dist/` via `CopyPlugin`.

### Backend Layout
```
backend/app/
  api/
    analyze.py      # POST /analyze, GET /history, GET /history/stats, GET /score/:id, POST /applied/:id
    auth.py         # POST /auth/register, /auth/login, /auth/web-login, /auth/web-logout, /auth/me
    scraper.py      # CRUD for saved searches, credentials, scraped jobs
    profiles.py     # CRUD for resume profiles
    keywords.py     # GET/POST keyword weights
    targeting.py    # Targeting/reach job management
    reach.py        # Reach scoring
    deps.py         # Shared FastAPI dependencies (get_current_user, get_db)
  services/
    claude.py           # Claude API client, system prompt, response parsing
    auth.py             # JWT creation/verification, password hashing
    email.py            # SendGrid email service
    encryption.py       # Fernet encrypt/decrypt for stored credentials
    hiring_cafe.py      # Hiring.cafe fetch service (authenticated scraping)
    scraper_poll.py     # APScheduler poll job — fetches searches, scores matches, sends emails
    resume_parser.py    # Resume text extraction
    cover_letter.py     # Cover letter generation
    interview_prep.py   # Interview question generation
    keyword_extractor.py # Keyword extraction from job descriptions
    company_info.py     # Company info enrichment
    reach.py            # Reach/targeting scoring logic
  models/
    job.py              # JobAnalysis ORM
    user.py             # User ORM
    user_profile.py     # UserProfile ORM
    scraper.py          # ScraperSearch, ScraperCredential, ScrapedJob ORM
    keyword.py          # KeywordWeight ORM
    targeting.py        # TargetingJob ORM
    application_data.py # ApplicationData ORM
    repository.py       # Cache read/write helpers
  schemas/            # Pydantic request/response models (one file per domain)
  config.py           # Settings loaded from backend/.env
  database.py         # SQLAlchemy engine + session factory
  main.py             # FastAPI app, router registration, APScheduler startup, static SPA serving
```

### Extension Layout
```
extension/src/
  background/index.ts   # Service worker — API relay, score caching, message dispatch
  content/
    index.ts            # URL watcher, job detection, analysis orchestration, keyword learning
    badge.ts            # Inline score badge injected on job cards
    overlay.ts          # Overlay UI for detailed job info
    extractors/         # Site-specific DOM scrapers: linkedin.ts, indeed.ts, hiring-cafe.ts
  popup/index.ts        # Score ring UI + detailed breakdown
  dashboard/index.ts    # Job history table, status tracking, keyword learning mgmt
  login/index.ts        # Extension login page (sets auth_jwt in chrome.storage.local)
  interview/index.ts    # Interview prep page
  app-assist/index.ts   # Application assist page
```

### Web App Layout (frontend/src/)
```
frontend/src/
  api/            # Typed fetch wrappers: auth, history, profiles, searches, credentials, keywords, targeting
  components/     # Layout, ProtectedRoute, ScoreRing, StatusPill, shadcn/ui components
  hooks/          # useAuth
  pages/
    Login.tsx           # Web login form
    JobHistory.tsx      # Full history table with stats bar, funnel, and rich filters
    WhileYouWereGone.tsx # New matches since last visit
    Filters.tsx         # Keyword weight management
    Targeting.tsx       # Reach job management
    Account.tsx         # Profile and API key management
  types/index.ts  # Shared TypeScript types
```

### Database
PostgreSQL 16 via Docker. Schema managed with Alembic — migrations in `backend/alembic/versions/`.

Key tables: `job_analyses`, `users`, `user_profiles`, `scraper_searches`, `scraper_credentials`, `scraped_jobs`, `keyword_weights`, `targeting_jobs`, `application_data`.

### Environment Variables (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | Fernet key for encrypting credentials |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens |
| `ENVIRONMENT` | No | `development` or `production` |
| `JWT_ALGORITHM` | No | Default: `HS256` |
| `JWT_EXPIRE_HOURS` | No | Default: `720` (30 days) |
| `SENDGRID_API_KEY` | No | For scraper email notifications |
| `SENDGRID_FROM_EMAIL` | No | Sender address for scraper emails |

## Adding a New Job Site

1. Create `extension/src/content/extractors/<site>.ts` implementing `ExtractionResult` (see `extractors/types.ts`)
2. Register it in `content/index.ts` URL-matching logic
3. Add the site's hostname to `host_permissions` in `extension/public/manifest.json`

## Adding a New Extension Page

1. Create `extension/public/<page>.html` and `extension/src/<page>/index.ts`
2. Add the entry to `webpack.config.js` entries
3. Register the HTML in `manifest.json` under `web_accessible_resources`
4. Open the page via `chrome.tabs.create({ url: chrome.runtime.getURL("<page>.html") })`

## Adding a New Web App Page

1. Create `frontend/src/pages/<Page>.tsx`
2. Add the route in `frontend/src/App.tsx`
3. Add a nav link in `frontend/src/components/Layout.tsx` if it should appear in the sidebar
4. Add any required API calls to `frontend/src/api/`
5. Run `./deploy-web.sh` to rebuild and serve from the backend
