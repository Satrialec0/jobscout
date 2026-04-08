# User & Profile-Scoped Job Card Dimming

**Date:** 2026-04-07
**Branch:** feature/resume-switching

## Problem

All dimming data — the explicit keyword blocklist, learned hide/show signals, and manual card overrides — is currently global and device-local. There is no user or profile separation. As the app moves to support multiple users and multiple profiles per user, this breaks down: a "Senior Engineer" profile and an "Engineering Manager" profile should train independent hide signals, and different users should never share keyword data.

## Requirements

| Data | Scope | Persistence |
|---|---|---|
| Explicit keyword blocklist (replaces hard-coded `BAD_FIT_KEYWORDS`) | Per-user | Cross-device (backend) |
| Learned keyword signals (`kw_hide_*` / `kw_show_*`) | Per-profile | Cross-device (backend, debounced sync) |
| Manual dim overrides (`user_dimmed_*` / `user_undimmed_*`) | Per-user | Device-local (wiped on logout) |

## Design

### Backend

**New tables:**

`user_keyword_blocklist`
```
id          serial PK
user_id     int FK → users(id) ON DELETE CASCADE
term        varchar(200) NOT NULL
created_at  timestamptz NOT NULL DEFAULT now()
UNIQUE (user_id, term)
```

`profile_keyword_signals`
```
id          serial PK
profile_id  int FK → user_profiles(id) ON DELETE CASCADE
ngram       varchar(200) NOT NULL
hide_count  int NOT NULL DEFAULT 0
show_count  int NOT NULL DEFAULT 0
updated_at  timestamptz NOT NULL DEFAULT now()
UNIQUE (profile_id, ngram)
```

**New API endpoints** (all under `/api/v1/keywords`, require auth):

| Method | Path | Description |
|---|---|---|
| `GET` | `/keywords/blocklist` | Return current user's blocklist terms |
| `POST` | `/keywords/blocklist` | Add a term `{ term: string }` |
| `DELETE` | `/keywords/blocklist/{term}` | Remove a term |
| `GET` | `/keywords/signals/{profile_id}` | Fetch all signal rows for a profile |
| `PUT` | `/keywords/signals/{profile_id}` | Bulk upsert signal counts `[{ ngram, hide_count, show_count }]` |

All endpoints validate that the requested profile belongs to the authenticated user.

**Migration:** On first login for users who existed before this feature, seed their blocklist with the 17 terms from the old hard-coded `BAD_FIT_KEYWORDS` array. This can be a one-time Alembic data migration.

### Extension — Storage as a Per-Session Cache

`chrome.storage.local` is treated as a fast local mirror of backend data, not a multi-user store. No user or profile IDs appear in storage keys. Everything is wiped on logout.

**Storage keys (unchanged structure, new lifecycle):**

| Key | Written by | Value |
|---|---|---|
| `active_profile_id` | background | `number` — active profile ID, for sync reference |
| `blocklist` | background | `string[]` — user's blocked terms |
| `kw_hide_{ngram}` | content | `number` — hide signal count |
| `kw_show_{ngram}` | content | `number` — show signal count |
| `user_dimmed_{jobId}` | content | object — manual hide override (device-local) |
| `user_undimmed_{jobId}` | content | `true` — manual show override (device-local) |

### Extension — Background Script Responsibilities

The background script owns all data lifecycle events:

**On login:**
1. Store JWT as usual
2. Fetch `GET /keywords/blocklist` → write `blocklist` to local storage
3. Fetch `GET /profiles/active` → store `active_profile_id`
4. Fetch `GET /keywords/signals/{profileId}` → write `kw_hide_*` / `kw_show_*` keys

**On profile switch** (new message type `SWITCH_PROFILE`):
1. Update `active_profile_id`
2. Remove all `kw_hide_*` / `kw_show_*` keys from local storage
3. Fetch and re-seed signals for the new profile
4. Broadcast `PROFILE_SWITCHED` to content scripts so they re-evaluate visible cards

**Debounced signal sync:**
- Background listens to `chrome.storage.onChanged` to detect writes to `kw_hide_*` / `kw_show_*` keys and builds an in-memory dirty set of changed ngrams
- Flushes to `PUT /keywords/signals/{active_profile_id}` after 30s of no new changes
- Also flushes on `chrome.runtime.onSuspend` (service worker shutdown)
- Only sends changed ngrams, not the full set
- The `PUT` body sends absolute current counts (overwrite semantics). Last-writer-wins if two devices are simultaneously active — acceptable for a personal tool
- If the service worker is killed between flush intervals, the in-memory dirty set is lost; at most ~30s of signal updates are not synced, which is acceptable

**On logout:**
1. Remove JWT
2. Call `chrome.storage.local.clear()`

### Extension — Content Script

No structural changes. Content script continues to read/write flat `kw_hide_*` / `kw_show_*` and `blocklist` keys. The `shouldKeywordDim` function reads from `blocklist` instead of the hard-coded array. No awareness of users or profiles.

The hard-coded `BAD_FIT_KEYWORDS` array in `content/index.ts` is deleted. On content script init, the blocklist is loaded from `chrome.storage.local` into a module-level variable (`let blocklist: string[] = []`). `shouldKeywordDim` reads from this variable, keeping the call synchronous. A `chrome.storage.onChanged` listener in the content script updates the variable if the background refreshes the blocklist (e.g., after a profile switch or blocklist edit).

### Account Page — Keyword Filters Tab

New tab on the account page: **"Keyword Filters"**.

Displays:
- List of current blocked terms, each with a remove button (X)
- Text input + "Add" button to add new terms
- Optimistic UI updates (update list immediately, API call in background, revert on error)

On load: `GET /keywords/blocklist`
On add: `POST /keywords/blocklist` → prepend to list
On remove: `DELETE /keywords/blocklist/{term}` → remove from list

### Data Flow

```
Login
 └── background seeds local storage:
       blocklist[]        ← GET /keywords/blocklist
       kw_hide_*          ← GET /keywords/signals/{profileId}
       kw_show_*          ← GET /keywords/signals/{profileId}
       active_profile_id  ← stored for sync reference

Browsing
 └── content reads blocklist + kw_* (unchanged logic)
 └── manual hide/show → content writes kw_* + marks ngrams dirty
 └── background debounce (30s) → PUT /keywords/signals/{profileId}

Profile switch
 └── background clears kw_* keys, re-seeds from new profile's signals
 └── content re-evaluates visible cards on PROFILE_SWITCHED message

Logout
 └── background calls chrome.storage.local.clear()

Account page blocklist tab
 └── Load   → GET /keywords/blocklist → render list
 └── Add    → POST /keywords/blocklist → optimistic update
 └── Remove → DELETE /keywords/blocklist/{term} → optimistic update
```

## Out of Scope

- Cross-device sync of manual dim overrides (`user_dimmed_*` / `user_undimmed_*`) — these are ephemeral browsing state tied to specific job listings that expire; local-only is acceptable
- Per-profile blocklists — the explicit blocklist is user-scoped by design; profile-level learned signals handle differentiation between role types
