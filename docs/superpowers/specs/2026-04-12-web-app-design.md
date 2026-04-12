# Web App — React + Vite Dashboard

**Date:** 2026-04-12
**Status:** Draft

## Problem

The extension dashboard is only accessible from the machine where Chrome is running. Job history, application status, "While You Were Gone" matches, and keyword/targeting management cannot be accessed from a phone, tablet, or any other device. The user wants full feature parity with the extension dashboard accessible from any device.

## Goals

- Full mirror of the extension dashboard accessible from any browser on any device
- "While You Were Gone" panel surfacing background-scraped job matches with on-demand analysis
- Application status updates reflected across both extension and web app in real time via shared PostgreSQL backend
- On-demand Claude analysis triggered directly from the web app (no extension required)
- Deployed to Cloudflare Pages, served under a custom domain

## Non-Goals

- Replacing the extension — both remain active and in sync
- User registration via the web app (users register through the extension)
- Mobile-native features (PWA/push notifications are a future iteration)
- Social / sharing features

---

## Architecture Overview

```
Browser (any device)
  → React + Vite SPA (Cloudflare Pages: app.yourdomain.com)
  → HTTP-only cookie auth (JWT)
  → FastAPI backend (api.yourdomain.com via Cloudflare tunnel)
  → PostgreSQL

Extension (Chrome, primary device)
  → Continues operating independently
  → Syncs status changes and cookie credentials to backend
  → Reads from same PostgreSQL via backend API
```

---

## Monorepo Structure

```
jobscout/
  backend/          # FastAPI (unchanged entry point)
  extension/        # Chrome extension (unchanged)
  frontend/         # NEW — React + Vite web app
    src/
      components/   # Shared UI components
      pages/        # Route-level page components
      hooks/        # Custom React hooks
      api/          # Typed fetch wrappers for backend endpoints
      types/        # Shared TypeScript interfaces
    index.html
    vite.config.ts
    tsconfig.json
    package.json
  docs/
  docker-compose.yml
```

---

## Auth

### Login Flow

The web app uses the same `/auth/login` backend endpoint as the extension. On successful login, the backend sets an HTTP-only cookie instead of returning the token in the response body.

**Backend change:** Add a `/auth/web-login` endpoint (or a `?web=true` flag on `/auth/login`) that calls `response.set_cookie()`:

```python
response.set_cookie(
    key="access_token",
    value=jwt_token,
    httponly=True,
    secure=True,
    samesite="strict",
    domain=".yourdomain.com",   # shared across subdomains
    max_age=60 * 60 * 24 * 7   # 7 days
)
```

The extension continues using `Bearer <token>` in the Authorization header — unchanged.

### Session Persistence

Cookie is scoped to `.yourdomain.com` so it works across `app.yourdomain.com` (frontend) and `api.yourdomain.com` (backend). React app checks `/auth/me` on load to determine auth state.

### Protected Routes

All routes except `/login` require an authenticated session. Unauthenticated requests to the API return 401, which the React app intercepts and redirects to `/login`.

---

## Routes

| Path | Page | Description |
|---|---|---|
| `/login` | Login | Email + password form |
| `/` | While You Were Gone | Unread scraped job matches |
| `/history` | Job History | Full analyzed job history table |
| `/filters` | Keyword Filters | Avoiding panel (dim signals, blocked companies) |
| `/targeting` | Targeting | Target keywords, signals, companies |
| `/account` | Account | Profile management, saved searches, scraper status |

---

## Pages

### `/` — While You Were Gone

Default landing page. Shows all `scraped_jobs` where `is_read = false` for the current user, ordered by `found_at` descending.

**Job card shows:**
- Job title + company
- Which saved search found it
- Time found
- Salary estimate from `v5_processed_job_data` if available (stored in description payload)
- [Analyze] button — POSTs to `/scraper/jobs/{id}/analyze`, streams or polls for result, renders score inline
- [×] dismiss button — POSTs to `/scraper/jobs/{id}/dismiss`, removes card

On analyze: card expands to show full score breakdown (fit score ring, direct matches, gaps, salary estimate) matching the extension popup UI. Job moves to history automatically.

Empty state: "No new jobs since your last visit. Scraper checks every hour."

If credentials not configured: prompt to visit hiring.cafe with the extension active.

### `/history` — Job History

Mirrors the extension dashboard History tab.

**Table columns:** Job title, Company, Score, Status, Salary, Site, Date, Actions

- Score rendered as colored badge (green ≥80, yellow 60–79, red <60)
- Status rendered as pill — click cycles through states, PATCHes to `/api/v1/job/{db_id}/status` (existing endpoint)
- Sortable by score, date
- Filterable by status, site, score range
- Clicking a row expands inline to show full analysis breakdown
- Pagination: 25 per page

Data source: `GET /api/v1/history` — existing endpoint, may need pagination and filter params added.

### `/filters` — Keyword Filters (Avoiding)

Mirrors the extension dashboard Avoiding panel.

**Sections:**
- **Learned dim keywords** — table of `kw_hide_*` signals with counts, confidence, active status. Delete per keyword.
- **Manual blocklist** — flat list of manually blocked terms. Add / delete.
- **Blocked companies** — flat list. Add by name, delete.

All reads/writes go through existing `/keywords/*` and `/companies/block` endpoints.

### `/targeting` — Targeting

Mirrors the extension dashboard Targeting panel.

**Sections:**
- **Profile keywords** — resume-extracted keywords. Add, delete, reset to resume defaults.
- **Learned target keywords** — table of `kw_target_*` signals with counts, confidence, active status.
- **Target companies** — auto-populated from high-score analyses. Add, delete.

Reads/writes via existing `/profiles/{id}/target-keywords` and `/companies/target` endpoints.

### `/account` — Account

**Sections:**

**Profile** — active resume profile selector. Switch profile (same behavior as extension).

**Saved Searches** — list of registered hiring.cafe searches.
- Name, active/inactive toggle, last polled timestamp, delete
- Add button links to instructions: "Visit hiring.cafe with the extension active and click 'Watch this search'"

**Scraper Status** — credential health indicator.
- Green: "Active — last checked {timestamp}"
- Yellow: "Session expiring soon"
- Red: "Session expired — visit hiring.cafe to refresh"
- Shows next scheduled poll time

**Email Notifications** — toggle on/off, show current notification email address.

---

## UI Design System

- **Tailwind CSS** for utility-first styling
- **shadcn/ui** for components (tables, buttons, badges, cards, dialogs, toasts)
- Dark theme matching extension palette: background `#0f172a`, text `#e2e8f0`, accent green `#4ade80`
- Responsive — works on mobile, tablet, desktop

---

## State Management

No global state library (Redux, Zustand). React Query (`@tanstack/react-query`) for server state — handles caching, background refetch, loading/error states. Component-local state with `useState` for UI interactions.

---

## API Layer

Typed fetch wrapper in `frontend/src/api/`:

```typescript
// frontend/src/api/client.ts
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',  // sends HTTP-only cookie automatically
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  if (res.status === 401) { window.location.href = '/login'; }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

Each endpoint gets a typed wrapper function in its own file (`api/scraped-jobs.ts`, `api/history.ts`, etc.).

---

## Backend Changes Required

| Change | Reason |
|---|---|
| `/auth/web-login` endpoint (or cookie flag on `/auth/login`) | HTTP-only cookie issuance for web app |
| CORS: add `app.yourdomain.com` to allowed origins with `allow_credentials=True` | Web app cross-origin requests |
| Cookie domain scoped to `.yourdomain.com` | Shared across subdomains |
| `/api/v1/history` — add pagination + filter params | Web app history table |
| `/job/{db_id}/status` PATCH — already exists | Status sync from web app (no new endpoint) |
| All scraper endpoints from Spec 1 | Saved searches, scraped jobs, credentials |

---

## Deployment

### Cloudflare Pages

- Build command: `pnpm build` (from `frontend/` directory)
- Output directory: `frontend/dist`
- Root directory: `frontend`
- Environment variable: `VITE_API_BASE=https://api.yourdomain.com`
- Deploys automatically on push to `main`

### CORS Configuration (FastAPI)

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Phased Rollout

**Phase 1 (this spec):** All pages implemented. Core flows: login, While You Were Gone panel with analyze + dismiss, history table with status updates, account/scraper management.

**Phase 2 (future):** Web Push notifications, LinkedIn integration, multi-user onboarding flow.
