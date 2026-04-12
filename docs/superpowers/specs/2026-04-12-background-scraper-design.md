# Background Scraper + Extension Changes

**Date:** 2026-04-12
**Status:** Draft

## Problem

The user manually checks 3 saved searches on hiring.cafe daily to find new jobs worth analyzing. This is time-consuming and means jobs posted overnight or while away from the computer are missed until the next manual check. There is no mechanism to discover new matching jobs passively.

## Goals

- Scrape the user's saved hiring.cafe searches in the background every hour without opening browser tabs
- Pre-filter results against existing targeting signals — no Claude API calls
- Notify the user via email when new matching jobs are found
- Store matched jobs (including full description) in PostgreSQL so they can be analyzed on demand from any device
- Sync application status changes from the extension to the backend so the web app stays in sync
- Alert the user when the hiring.cafe session expires and polling stops

## Non-Goals

- LinkedIn scraping (follow-on iteration)
- Auto-analyzing jobs with Claude (user triggers analysis manually)
- Mobile push notifications (email only for now)
- Multi-user rate limiting / proxy infrastructure (design is user-scoped; scaling addressed when needed)

---

## Architecture Overview

```
Extension (on hiring.cafe navigation)
  → chrome.cookies reads session cookie
  → POSTs encrypted cookie + search states to backend

Backend (APScheduler, every hour)
  → asyncio.gather fires all saved searches concurrently
  → Filters results against targeting signals
  → Cross-checks against job_analyses (dedup)
  → Inserts new matches into scraped_jobs
  → Sends SendGrid email if new matches found

Extension (on application status change)
  → POSTs new status to backend
  → Backend writes to job_analyses / scraped_jobs
```

---

## Database Schema

### `hiring_cafe_credentials` (new)

Stores the encrypted hiring.cafe session cookie per user.

```sql
hiring_cafe_credentials
  id           serial PK
  user_id      int FK → users(id) ON DELETE CASCADE
  cookie_name  varchar(100) NOT NULL       -- e.g. "__session"
  cookie_value text NOT NULL               -- Fernet-encrypted
  domain       varchar(100) NOT NULL       -- "hiring.cafe"
  updated_at   timestamptz DEFAULT now()
  UNIQUE (user_id, cookie_name)
```

### `saved_searches` (new)

Stores the user's registered hiring.cafe saved searches.

```sql
saved_searches
  id           serial PK
  user_id      int FK → users(id) ON DELETE CASCADE
  name         varchar(200) NOT NULL       -- user-facing label
  search_state jsonb NOT NULL              -- full s= payload decoded
  is_active    boolean NOT NULL DEFAULT true
  created_at   timestamptz DEFAULT now()
  last_polled  timestamptz
  -- max 5 per user enforced in application layer
```

### `scraped_jobs` (new)

Stores background-scraped job matches pending user review.

```sql
scraped_jobs
  id              serial PK
  user_id         int FK → users(id) ON DELETE CASCADE
  saved_search_id int FK → saved_searches(id) ON DELETE SET NULL
  object_id       varchar(200) NOT NULL    -- hiring.cafe objectID (Algolia)
  apply_url       text NOT NULL
  title           varchar(500) NOT NULL
  company         varchar(300) NOT NULL
  description     text NOT NULL            -- full job_information.description
  found_at        timestamptz DEFAULT now()
  is_read         boolean NOT NULL DEFAULT false
  analysis_id     int FK → job_analyses(id) NULL  -- set when user analyzes
  UNIQUE (user_id, object_id)
```

### `job_analyses` — no schema changes needed

The `status` column (`varchar(32), nullable`) already exists on `job_analyses`. The `PATCH /api/v1/job/{db_id}/status` endpoint already handles status updates. The `/api/v1/history/push-statuses` endpoint already handles bulk status sync from the extension.

The extension status sync enhancement in this spec is purely a trigger change — sync on every individual status click rather than only on dashboard load.

---

## Backend API Endpoints

All under `/api/v1`, require JWT auth.

### Session Cookie

| Method | Path | Description |
|---|---|---|
| `POST` | `/scraper/credentials` | Upsert encrypted hiring.cafe session cookie |
| `DELETE` | `/scraper/credentials` | Remove stored credentials |
| `GET` | `/scraper/credentials/status` | Returns `{ active: bool, last_used: timestamp, last_error: str \| null }` |

### Saved Searches

| Method | Path | Description |
|---|---|---|
| `GET` | `/scraper/searches` | List all saved searches for user |
| `POST` | `/scraper/searches` | Register a new saved search `{ name, search_state }` |
| `PATCH` | `/scraper/searches/{id}` | Update name or toggle is_active |
| `DELETE` | `/scraper/searches/{id}` | Remove a saved search |

### Scraped Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/scraper/jobs` | List unread scraped jobs (`is_read=false`) |
| `POST` | `/scraper/jobs/{id}/dismiss` | Mark as read without analyzing |
| `POST` | `/scraper/jobs/{id}/analyze` | Trigger Claude analysis, returns score, sets `analysis_id`, marks `is_read=true` |

### Application Status

Already exists — no new endpoints required.

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/job/{db_id}/status` | Update `status` on a job analysis (existing) |
| `POST` | `/history/push-statuses` | Bulk status sync from extension (existing) |

---

## Background Polling Service

### Location

`backend/app/services/scraper.py` — standalone service module.
Registered with APScheduler in `backend/app/main.py` on startup.

### Schedule

Every 60 minutes. Start time offset per user by `(user_id % 60)` minutes to stagger across the hour and avoid burst traffic to hiring.cafe.

### Poll Cycle (per user)

```python
async def poll_user(user_id: int):
    creds = get_credentials(user_id)
    if not creds:
        return  # no credentials registered

    searches = get_active_searches(user_id)
    if not searches:
        return

    results = await asyncio.gather(
        *[fetch_search(search, creds) for search in searches],
        return_exceptions=True
    )

    new_jobs = []
    for search, result in zip(searches, results):
        if isinstance(result, AuthError):
            send_expiry_email(user_id)
            deactivate_credentials(user_id)
            return
        if isinstance(result, Exception):
            log_error(result)
            continue
        for job in result:
            if is_new(job, user_id):           # not in scraped_jobs or job_analyses
                if matches_signals(job, user_id):  # targeting signal check
                    insert_scraped_job(job, search.id, user_id)
                    new_jobs.append(job)

    if new_jobs:
        send_match_email(user_id, new_jobs)
```

### Hiring.cafe Fetch

```python
async def fetch_search(search: SavedSearch, creds: Credentials) -> list[Job]:
    # Reconstruct cookie header from stored credentials
    # GET /api/search-jobs?s=<encoded_state>&size=40&page=0&sv=control
    # Returns results array
    # Raises AuthError on non-JSON response (HTML redirect = expired session)
    # Raises RateLimitError on 503 → exponential backoff, max 3 retries
```

### Targeting Signal Pre-filter

Reuses the same signal logic as the content script's `applyHCHighlight`:
- Company matches `company_target` → include
- Title ngrams match `profile_target_keywords` → include
- Title ngrams match `profile_target_signals` with `targetCount >= 3` and confidence `>= 70%` → include
- No match → skip (no Claude call, no storage)

### Deduplication

Before inserting, check:
1. `scraped_jobs` — `UNIQUE (user_id, object_id)` constraint handles this at DB level
2. `job_analyses` — query by `apply_url`; skip if already analyzed

---

## Extension Changes

### Cookie Sync (`background/index.ts`)

On message `HIRING_CAFE_NAVIGATED` from content script:

```typescript
async function syncHiringCafeCookies() {
  const cookies = await chrome.cookies.getAll({ domain: 'hiring.cafe' });
  const sessionCookie = cookies.find(c => c.name === '__session' || c.name === 'session');
  if (!sessionCookie) return;

  const jwt = (await chrome.storage.local.get('auth_jwt')).auth_jwt;
  if (!jwt) return;

  await fetch(`${BACKEND_URL}/api/v1/scraper/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ cookie_name: sessionCookie.name, cookie_value: sessionCookie.value, domain: 'hiring.cafe' })
  });
}
```

### Navigation Trigger (`content/index.ts`)

On page load for hiring.cafe URLs (already matched), send `HIRING_CAFE_NAVIGATED` to background. No change to existing extraction logic.

### "Watch This Search" Button (`content/index.ts`)

Injected into the hiring.cafe page toolbar when `searchState` is present in the URL.

```typescript
// Read current search state from URL
const searchState = new URLSearchParams(window.location.search).get('searchState');
// Read full s= param from most recent /api/search-jobs request
// (captured via fetch interceptor already in place)
// Send REGISTER_SEARCH { name: auto-generated from searchQuery, search_state } to background
// Background POSTs to /scraper/searches
// Button changes to "Watching ✓" on success
```

The fetch interceptor captures the full `s=` parameter from the most recent `search-jobs` request, which contains the complete filter state beyond what `searchState` in the URL encodes.

### Application Status Sync (`dashboard/index.ts`)

The existing `push-statuses` bulk sync runs on dashboard load. Enhance the existing `cycleStatus` function to also fire a per-click sync for real-time web app consistency:

```typescript
const dbId = job.dbId; // already stored on StoredScore
if (dbId) {
  fetch(`${BACKEND_URL}/api/v1/job/${dbId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ status: newStatus })
  });
}
```

Fire-and-forget — does not block the UI update. The existing bulk `push-statuses` on load remains as a fallback reconciliation.

---

## Email Notifications

### Service

SendGrid. API key stored in `backend/.env` as `SENDGRID_API_KEY`. Sender address configured as `SENDGRID_FROM_EMAIL`.

### New Matches Email

Subject: `JobScout: {n} new job{s} match your profile`

Body: Plain text list of matched jobs — title, company, direct apply_url. Sent once per poll cycle that finds new matches. Not sent if zero new jobs.

### Session Expiry Email

Subject: `JobScout: Your hiring.cafe session has expired`

Body: One sentence explaining polling has paused and will resume automatically next time you visit hiring.cafe. Sent once per expiry event, not repeatedly.

---

## Error Handling

| Error | Behavior |
|---|---|
| 503 from hiring.cafe | Exponential backoff: wait 2min, 4min, 8min. Skip search after 3 failures, log. |
| Auth failure (HTML response) | Send expiry email, mark credentials inactive, stop polling. |
| SendGrid failure | Log error, do not retry email. Jobs still stored in DB. |
| DB write failure | Log error, skip job. Next poll cycle will re-discover if still in results. |
| asyncio task exception | Caught by `return_exceptions=True`, logged per-search. Other searches continue. |

---

## Security

- Hiring.cafe session cookie is encrypted with Fernet before DB write. Key stored in `backend/.env` as `FERNET_KEY`. Generated once with `Fernet.generate_key()`.
- Cookie value never logged.
- `/scraper/credentials` endpoint accepts only from authenticated users (JWT required).
- Credential sync uses HTTPS via Cloudflare tunnel.
