# Job Card Targeting & Green Highlight

**Date:** 2026-04-11
**Branch:** TBD

## Problem

Users browse hiring.cafe without knowing which job cards are worth clicking into. The existing system only signals what to *avoid* (dimming via keyword blocks and low scores). There is no proactive signal for cards that closely match the user's profile — meaning users must open every card to discover fit.

## Goals

- Highlight job cards green (border glow) on hiring.cafe when they match the active user's targeting signals
- Build targeting signals from three sources: resume-extracted keywords (backend), learned ngrams from apply clicks and high-score analyses, and target companies mined from high-scoring jobs
- Let users view and edit all targeting signals in a new "Targeting" panel in the Account section
- Extend the existing "Keyword Filters" (Avoiding) panel with a Blocked Companies section
- Scope: hiring.cafe first; LinkedIn/Indeed to follow in a subsequent iteration

## Non-Goals

- Red border highlighting (existing dim system handles "avoid" signaling)
- LinkedIn/Indeed card highlighting in this iteration
- Weighted scoring across multiple signal types

---

## Architecture

### Approach

Parallel targeting system (independent from existing `profile_keyword_signals`). Hide and target signals have separate tables, storage keys, endpoints, and flush/seed cycles. This prevents cross-contamination during profile switches and allows each system to evolve its thresholds independently.

---

## Database Schema

Three new tables, managed via Alembic migrations.

```sql
-- Per-profile: resume-extracted keywords + learned target ngrams
profile_target_keywords
  id          serial PK
  profile_id  int FK → user_profiles(id) ON DELETE CASCADE
  keyword     varchar(200) NOT NULL
  source      varchar(20) NOT NULL  -- 'resume' | 'learned'
  created_at  timestamptz DEFAULT now()
  UNIQUE (profile_id, keyword)

-- Per-profile: learned target ngram signal counts
profile_target_signals
  id           serial PK
  profile_id   int FK → user_profiles(id) ON DELETE CASCADE
  ngram        varchar(200) NOT NULL
  target_count int NOT NULL DEFAULT 0
  show_count   int NOT NULL DEFAULT 0
  updated_at   timestamptz DEFAULT now()
  UNIQUE (profile_id, ngram)

-- Companies: per-profile targets (profile_id set), global blocks (profile_id NULL)
companies
  id         serial PK
  profile_id int FK → user_profiles(id) ON DELETE CASCADE NULL
  name       varchar(300) NOT NULL
  list_type  varchar(10) NOT NULL  -- 'target' | 'block'
  created_at timestamptz DEFAULT now()
  -- Use NULLS NOT DISTINCT (Postgres 15+) or a partial unique index for NULL profile_id rows
  UNIQUE NULLS NOT DISTINCT (profile_id, name, list_type)
```

---

## Backend API Endpoints

All under `/api/v1`, require auth. Follow existing patterns in `backend/app/api/`.

### Target Keywords (profile-scoped)

| Method | Path | Description |
|---|---|---|
| `GET` | `/profiles/{id}/target-keywords` | Fetch all keywords. Lazy-extracts from resume on first call if table is empty for this profile. |
| `POST` | `/profiles/{id}/target-keywords` | Add a keyword `{ keyword: string, source: "resume" \| "learned" }` |
| `DELETE` | `/profiles/{id}/target-keywords/{keyword}` | Remove a keyword |
| `POST` | `/profiles/{id}/target-keywords/reset` | Re-extract from resume; replace all `source=resume` entries |

**Lazy extraction:** On `GET`, if no rows exist for the profile, call Claude (or simple NLP) to extract skills/keywords from `resume_text` and persist them. Return the extracted list. Subsequent calls read from DB. This handles all existing profiles with no migration needed. If `resume_text` is null, return an empty list — the user can add keywords manually.

### Target Signals (flush/seed pattern)

| Method | Path | Description |
|---|---|---|
| `GET` | `/keywords/target-signals/{profile_id}` | Return all signal rows for seeding into extension storage on profile activation |
| `PUT` | `/keywords/target-signals/{profile_id}` | Bulk upsert `[{ ngram, target_count, show_count }]` |

### Companies

| Method | Path | Description |
|---|---|---|
| `GET` | `/companies` | Returns `{ targets: [{id, name, profile_id}], blocks: [{id, name}] }` for active profile |
| `POST` | `/companies/target` | Add target company `{ name: string, profile_id: int }` |
| `DELETE` | `/companies/target/{id}` | Remove target company |
| `POST` | `/companies/block` | Add blocked company `{ name: string }` (global, no profile_id) |
| `DELETE` | `/companies/block/{id}` | Remove blocked company |

---

## Extension Storage

### New Keys

| Key | Written by | Value | Cleared on |
|---|---|---|---|
| `kw_target_<ngram>` | background | `{ targetCount: number, showCount: number }` | Profile switch |
| `kw_target_profile_<keyword>` | background | `true` | Profile switch |
| `company_target_<name>` | background | `true` | Profile switch |
| `company_block_<name>` | background | `true` | Logout only (global) |

### Seeding on Profile Activation

Extends the existing `SWITCH_PROFILE` handler in `background/index.ts`:

1. Flush pending `kw_target_*` signals to backend (debounced flush, same as hide signals)
2. Clear all `kw_target_*` and `company_target_*` keys from storage
3. `GET /keywords/target-signals/{profileId}` → seed `kw_target_*`
4. `GET /profiles/{id}/target-keywords` → seed as always-on signals (stored separately as `kw_target_profile_<keyword>`)
5. `GET /companies` → seed `company_target_*` and `company_block_*`

### Mining Triggers

**On analysis response with `fit_score >= 80`** (in background worker, `ANALYZE_JOB` handler):
- Extract ngrams from `green_flags` skill list → increment `kw_target_<ngram>.targetCount`
- Write `company_target_<company>` = `true`
- Queue debounced flush to `/keywords/target-signals/{profileId}`

**On Apply click** (status set to `applied` in dashboard or background):
- Extract title ngrams (same tokenizer as existing dim system) → increment `kw_target_<ngram>.targetCount`
- Queue debounced flush

**Flush:** Debounced 30 seconds, same pattern as existing `kw_hide_*` flush.

---

## Content Script Highlighting Logic

### `applyHCHighlight(card, title, company)`

New function called from `applyHCCardState` after `applyVisibility` runs.

Priority (first match wins, top to bottom):

1. Card is already dimmed → exit, no border applied
2. Company matches `company_block_<name>` → already dimmed by dim system, exit
3. Company matches `company_target_<name>` → apply green border
4. Title ngrams match any profile keyword (`kw_target_profile_<keyword>`) → apply green border
5. Title ngrams match any `kw_target_<ngram>` with `targetCount >= 3` AND `targetCount / (targetCount + showCount) >= 0.70` → apply green border
6. No match → no border (neutral)

### Green Border Style

```css
box-shadow: 0 0 0 2px #4ade80;
border-radius: inherit;
```

Applied to `div.relative.bg-white.rounded-xl`. Matches existing badge green `#4ade80`.

### Carousel Handling

`applyHCCardState` already resets card UI on carousel navigation via `MutationObserver`. Since `applyHCHighlight` is called from `applyHCCardState`, it runs automatically on each carousel flip with no additional wiring needed.

---

## Dashboard UI Changes

### Account Sidebar

- Rename "Keyword Filters" → "Avoiding" (button label + panel id)
- Add "Targeting" nav button + panel

### "Avoiding" Panel Changes

Extends existing `loadKeywordFiltersPanel()`. Existing sections (learned dim keywords + manual blocklist) are unchanged.

**New: Blocked Companies section**
- Flat editable list
- Add by typing company name + Enter
- Delete via × button per entry
- Writes to `company_block_<name>` storage and `/companies/block` endpoint

### "Targeting" Panel (new `loadTargetingPanel()`)

**Profile Keywords section**
- Lists all `source=resume` keywords for the active profile
- × button to remove individual keywords
- Text input to manually add keywords
- "Reset to resume defaults" button → calls `/profiles/{id}/target-keywords/reset`

**Learned Target Keywords section**
- Same layout as learned dim keywords in Avoiding panel
- Columns: ngram, target count, show count, confidence bar
- Status: "building signal" (below threshold) or "● active" (targetCount >= 3, confidence >= 70%)
- × / Reset button per keyword

**Target Companies section**
- Auto-populated from mining (score >= 80 analyses)
- User can delete entries via × button
- Calls `/companies/target` endpoints

---

## Thresholds & Rules

| Signal | Threshold | Notes |
|---|---|---|
| Profile-derived keywords | Always active | Bypass count/confidence requirements |
| Learned target ngrams | `targetCount >= 3` AND `confidence >= 70%` | Same as existing dim thresholds |
| Mining trigger (score) | `fit_score >= 80` | Mines `green_flags` + company |
| Mining trigger (apply) | Status set to `applied` | Mines title ngrams only |
| Conflict (green + dim) | Dim wins | Green border never shown on dimmed card |

---

## Site Scope

**This iteration:** hiring.cafe only. The highlight logic is isolated to `applyHCCardState` and the new `applyHCHighlight` function.

**Future iterations:** LinkedIn and Indeed require card-level company selectors to be written (currently only extracted from modals on those sites). The signal infrastructure (storage, backend, dashboard) is shared and requires no changes.
