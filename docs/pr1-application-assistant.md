# PR 1 — Application Assistant Side Panel

## Branch
`feature/application-helper-extension` (current)

## Overview
Build a Chrome Side Panel that auto-opens on Greenhouse job application pages, scrapes form questions, matches the active job context from cached scores, and generates Claude-powered answers using the active user profile's resume and a new per-profile `app_assist_instructions` field.

Also adds full profile editing to the React frontend (resume upload, instructions, app assist instructions) and a lazy-loaded job description expand in JobHistory.

---

## Decisions Made

| Decision | Choice |
|---|---|
| UI surface | Chrome Side Panel API (Chrome 114+) |
| Auto-open | Greenhouse pages only; toggle in popup (`sidepanel_auto_open` in chrome.storage.local) |
| Question input | Auto-detect from Greenhouse DOM + manual paste fallback |
| JD context | Auto-match active job by title+company from Greenhouse DOM → fuzzy match cached scores → manual override picker |
| Profile context | Always use active profile resume + new `app_assist_instructions` field |
| Instructions pre-fill | Side panel sticky block pre-filled from `app_assist_instructions`, editable, persisted locally |
| Story bank | **PR 2 only** |
| JD in React frontend | Lazy-fetch from `GET /api/v1/score/:id` on row expand |
| Commit scope | Greenhouse only; add other ATS as encountered |

---

## Implementation Order

### Step 1 — Backend: `app_assist_instructions` field

**Files to change:**
- `backend/app/models/user_profile.py` — add `app_assist_instructions: Mapped[str | None]` column (Text, nullable, default None)
- `backend/app/schemas/profile.py` — add `app_assist_instructions: Optional[str] = None` to `ProfileCreate`, `ProfileUpdate`, `ProfileResponse`
- `backend/app/api/profiles.py` — handle `app_assist_instructions` in `update_profile` PUT handler (same pattern as `instructions`)
- `backend/app/services/app_questions.py` — update `generate_app_answer` to accept and use `app_assist_instructions` as the `instructions` param instead of job analysis instructions. Update `_build_system_prompt` accordingly.
- `backend/app/api/analyze.py` — when calling `generate_app_answer`, pass `profile.app_assist_instructions` (fetch active profile if not already loaded)
- New migration: `alembic revision --autogenerate -m "add app_assist_instructions to user_profiles"`

---

### Step 2 — React Frontend: Account page profile editing

**Current state:** Account page is read-only. Shows profile names + active badge only. No resume, no instructions editing.

**Files to change:**
- `frontend/src/types/index.ts` — add `instructions: string`, `resume_text: string | null`, `app_assist_instructions: string | null` to `Profile` interface
- `frontend/src/api/profiles.ts` — add `updateProfile(id, body)` → `PUT /api/v1/profiles/:id`, add `parseResume(file)` → `POST /api/v1/profiles/parse-resume`
- `frontend/src/pages/Account.tsx` — expand the Profiles section:
  - Each profile gets an expand/edit panel (click to open)
  - Resume: textarea showing `resume_text`, upload button that calls parse-resume then saves
  - Job analysis instructions: textarea for `instructions`
  - App assist instructions: textarea for `app_assist_instructions` with label "Application Assistant Instructions — used when generating answers to application questions"
  - Save button calls `updateProfile`
  - Keep activate/delete controls

---

### Step 3 — React Frontend: JobHistory JD expand

**Current state:** `JobHistoryItem` type has no `job_description`. History list doesn't include it. Individual score endpoint (`GET /api/v1/score/:id`) does return it.

**Files to change:**
- `frontend/src/api/history.ts` — add `getJobDetail(id: number)` → `GET /api/v1/score/:id`, returns full record including `job_description`
- `frontend/src/pages/JobHistory.tsx` — add expandable row. On expand, lazy-fetch `getJobDetail(item.id)`. Show collapsible sections:
  - Job description (scrollable, max-height ~300px)
  - Analysis breakdown (direct matches, transferable, gaps, flags) — mirrors what the HTML dashboard already shows

---

### Step 4 — Extension: manifest + side panel scaffold

**Files to change:**
- `extension/public/manifest.json`:
  - Add `"sidePanel"` to `permissions`
  - Add `"side_panel": { "default_path": "sidepanel.html" }` at top level
  - Add `"https://*.greenhouse.io/*"` to `host_permissions`
- `extension/public/sidepanel.html` — new file, mirrors structure of `app-assist.html` but scoped for the panel
- `extension/webpack.config.js` — add `sidepanel: './src/sidepanel/index.ts'` entry
- `extension/src/sidepanel/index.ts` — new file (scaffold only at this step)

---

### Step 5 — Extension: Greenhouse detection + question scraping

**New file: `extension/src/content/extractors/greenhouse.ts`**

Greenhouse job application pages (`boards.greenhouse.io/*/jobs/*` or `job-boards.greenhouse.io`) have:
- Job title in `h1.app-title` or `h1` within `.app-header`
- Company name in `.company-name` or page `<title>` format "Job Application for {title} at {company}"
- Questions: `<div class="field">` containing `<label>` + `<input>` or `<textarea>`

Extractor should return:
```ts
interface GreenhouseExtraction {
  jobTitle: string;
  company: string;
  questions: Array<{ label: string; fieldType: 'text' | 'textarea' | 'select' }>; 
}
```

**Files to change:**
- `extension/src/content/index.ts` — add Greenhouse URL detection, call extractor, send `GREENHOUSE_PAGE_DETECTED` message to background with extraction result
- `extension/src/background/index.ts` — handle `GREENHOUSE_PAGE_DETECTED`: if `sidepanel_auto_open` is true (default), call `chrome.sidePanel.open({ tabId })`. Cache extraction result in `chrome.storage.session` keyed by tabId.

---

### Step 6 — Extension: Side panel job matching + context strip

**In `extension/src/sidepanel/index.ts`:**

On load:
1. Get current tab via `chrome.tabs.query({ active: true, currentWindow: true })`
2. Read Greenhouse extraction from `chrome.storage.session` for that tabId
3. Read all `score_jobid_*` keys from `chrome.storage.local`
4. Fuzzy match extracted `jobTitle` + `company` against cached scores:
   - Exact match on company (case-insensitive) + title contains match → high confidence
   - Company match only → medium confidence, show picker
   - No match → show manual picker of 5 most recent scores
5. Render context strip:
   ```
   [Score ring]  Job Title @ Company
                 ✓ Direct match 1 · ✓ Direct match 2
                 [Wrong job? Change ▾]
   ```
6. "Wrong job? Change" opens an inline picker listing 5 most recent cached scores

Also fetch active profile from `GET /api/v1/profiles/active` to get `app_assist_instructions`.

---

### Step 7 — Extension: Side panel Q&A + answer generation

**In `extension/src/sidepanel/index.ts`:**

Below the context strip:

**App Assist Instructions block:**
- Collapsible section "Assistant Instructions"
- Pre-filled from profile's `app_assist_instructions`
- Editable textarea
- Changes saved to `chrome.storage.local` as `sidepanel_instructions`
- On blur, sync back to profile via `PUT /api/v1/profiles/:id`

**Questions list:**
- Auto-populated from Greenhouse extraction (one block per question)
- Each block: label (from form), "Generate Answer" button, answer textarea
- "Add question manually" button at bottom
- Generate Answer → message to background → `GENERATE_APP_ANSWER` → backend call with:
  - `job_title`, `company`, `job_description` from matched cached score (fetched via `GET_SCORE_FROM_BACKEND`)
  - `direct_matches`, `transferable`, `gaps` from cached score
  - `question` text
  - `app_assist_instructions` from profile

**In `extension/src/background/index.ts`:**
- `GENERATE_APP_ANSWER` handler already exists — update to pass `app_assist_instructions` from profile fetch

---

### Step 8 — Extension: Popup toggle + open button

**In `extension/src/popup/index.ts`:**

Add to the action bar in `renderScore()`:
- "Open Application Helper" button → `chrome.sidePanel.open({ tabId })`
- Small gear/toggle below: "Auto-open on apply pages [toggle]"
  - Reads/writes `sidepanel_auto_open` in `chrome.storage.local`
  - Default: `true`

---

## Key Architectural Notes

**Side panel ↔ content script communication:**
- Content script detects Greenhouse page → sends `GREENHOUSE_PAGE_DETECTED` to background
- Background caches extraction in `chrome.storage.session[tabId]`
- Side panel reads from session storage on open
- Side panel cannot directly message content scripts; route through background

**JD in answer generation:**
- Side panel has the matched `jobId` from step 6
- When generating an answer, background calls `GET_SCORE_FROM_BACKEND` to get `job_description`
- This is the same pattern already used in `app-assist/index.ts`

**Auto-open toggle:**
- Stored as `sidepanel_auto_open: boolean` in `chrome.storage.local`
- Default `true` (set on extension install in background)
- Checked in background before calling `chrome.sidePanel.open()`

**Greenhouse URL patterns to detect:**
- `boards.greenhouse.io`
- `job-boards.greenhouse.io`
- Some companies host on their own domain with Greenhouse embedded — harder to detect, skip for now

---

## Files Created (new)
- `extension/public/sidepanel.html`
- `extension/src/sidepanel/index.ts`
- `extension/src/content/extractors/greenhouse.ts`
- `backend/alembic/versions/<hash>_add_app_assist_instructions_to_user_profiles.py`

## Files Modified
- `extension/public/manifest.json`
- `extension/webpack.config.js`
- `extension/src/content/index.ts`
- `extension/src/background/index.ts`
- `extension/src/popup/index.ts`
- `backend/app/models/user_profile.py`
- `backend/app/schemas/profile.py`
- `backend/app/api/profiles.py`
- `backend/app/api/analyze.py`
- `backend/app/services/app_questions.py`
- `frontend/src/types/index.ts`
- `frontend/src/api/profiles.ts`
- `frontend/src/api/history.ts`
- `frontend/src/pages/Account.tsx`
- `frontend/src/pages/JobHistory.tsx`

---

## PR 2 Preview — Story Bank
- New DB table: `profile_documents` (id, profile_id, filename, description, content TEXT, created_at)
- API: `POST/GET/DELETE /api/v1/profiles/:id/documents`
- `generate_app_answer`: fetch all docs for active profile, inject into system prompt (cap: 5 files, 10k chars each)
- React Account page: upload `.md` file + write description, list with delete
