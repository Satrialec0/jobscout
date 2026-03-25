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
pnpm build    # Webpack build → dist/  (uses webpack.config.js)
pnpm watch    # Watch mode for development
```

Load the extension in Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`

After any source change, run `pnpm build` (or let `pnpm watch` rebuild), then click the reload icon on the extension card in `chrome://extensions`.

## Architecture

### Data Flow
1. `content/index.ts` watches for URL changes on job sites and triggers extraction
2. A site-specific extractor (`content/extractors/*.ts`) scrapes job data from the DOM
3. Content script sends an `ANALYZE_JOB` message to `background/index.ts` (service worker)
4. Background worker POSTs to `POST /api/v1/analyze` — bypassing site CSP restrictions
5. Backend checks the PostgreSQL cache by URL; on miss, calls Claude API (`claude-sonnet-4-20250514`) and stores result
6. Score is returned to the popup (`popup/index.ts`) and an inline badge (`content/badge.ts`)

### Key Architectural Decisions

**CSP Bypass via Service Worker:** LinkedIn's Content Security Policy blocks fetch calls from content scripts. All backend communication is routed through the Manifest V3 background service worker, which is not subject to page CSP.

**URL-Based Caching:** Every analysis is cached in PostgreSQL by URL. Repeat visits are instant with no API cost. Hiring.cafe uses title+company as a fallback key due to dynamic URLs.

**Score Persistence via `chrome.storage.local`:** The background worker caches scores per URL in extension storage so the popup renders immediately on re-open without re-fetching. The dashboard reads a *different* key format — see storage schema below.

**Application Status Tracking:** `dashboard/index.ts` manages a 6-state lifecycle per job (`applied → phone_screen → interviewed → offer → rejected → null`) persisted in `chrome.storage.local`. Status is cycled in-order on each click; clicking past `rejected` resets to null.

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

`StoredScore` shape: `{ result: AnalyzeResponse, jobTitle, company, timestamp, salary?, easyApply?, jobAge?, jobAgeIsOld?, url? }`

### Webpack Bundle Entries

Each entry in `webpack.config.js` maps to an independent JS bundle in `dist/`:
- `background` → service worker
- `content` → injected into job site pages
- `popup` → toolbar popup
- `dashboard` → full-page history/tracking tab

HTML files are copied from `extension/public/` to `dist/` via `CopyPlugin`. To add a new page (e.g. `interview.html`), add the HTML to `public/`, register it in `web_accessible_resources` in `manifest.json`, and add its entry point to `webpack.config.js`.

### Backend Layout
```
backend/app/
  api/analyze.py        # Route handlers: POST /analyze, GET /history, GET /score/:id, POST /applied/:id
  services/claude.py    # Claude API client, system prompt, response parsing
  models/
    job.py              # SQLAlchemy ORM: JobAnalysis table
    repository.py       # Cache read/write (get_cached_analysis, save_analysis)
  schemas/analyze.py    # Pydantic models: AnalyzeRequest, AnalyzeResponse, SalaryEstimate
  config.py             # Settings from backend/.env
  database.py           # SQLAlchemy engine + session factory
```

### Extension Layout
```
extension/src/
  background/index.ts   # Service worker — API relay, score caching, message dispatch
  content/
    index.ts            # URL watcher, job detection, analysis orchestration, keyword learning
    badge.ts            # Inline score badge injected on job cards
    overlay.ts          # Overlay UI for detailed job info
    extractors/         # Site-specific DOM scrapers; each returns ExtractionResult (see extractors/types.ts)
  popup/index.ts        # Score ring UI + detailed breakdown
  dashboard/index.ts    # Job history table, status tracking, keyword learning mgmt (2 tabs: History, Filters & Hidden)
```

### Database
PostgreSQL 16 via Docker. Single table: `job_analyses`. Schema managed with Alembic — migrations live in `backend/alembic/versions/`. Connection string in `backend/.env` as `DATABASE_URL`.

### Environment Variables (`backend/.env`)
- `ANTHROPIC_API_KEY` — required
- `DATABASE_URL` — PostgreSQL connection string
- `ENVIRONMENT` — `development` or `production`

## Adding a New Job Site

1. Create `extension/src/content/extractors/<site>.ts` implementing `ExtractionResult` (see `extractors/types.ts`)
2. Register it in `content/index.ts` URL-matching logic
3. Add the site's hostname to `host_permissions` in `extension/public/manifest.json`

## Adding a New Dashboard Page

1. Create `extension/public/<page>.html` and `extension/src/<page>/index.ts`
2. Add the entry to `webpack.config.js` entries
3. Register the HTML in `manifest.json` under `web_accessible_resources`
4. Open the page via `chrome.tabs.create({ url: chrome.runtime.getURL("<page>.html") })`
