# Resume Profiles Design

**Date:** 2026-04-07  
**Status:** Approved

## Overview

Replace the hardcoded candidate profile in all Claude service system prompts with dynamic, per-user profiles stored in the database. Each user can maintain multiple named profiles, each with its own uploaded resume text and custom analysis instructions. One profile is active at a time and is injected into every analysis request automatically.

## Motivation

- The current system embeds a single hardcoded candidate profile across all service files, making it unusable for multiple users
- Users need to analyze jobs against different resumes (e.g. a tailored PM resume vs an engineering resume)
- Users need to customize the analysis lens per profile (e.g. "I'm pivoting from engineering to product — weight transferable skills heavily")

---

## Data Model

### New table: `user_profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | int FK → users | indexed |
| `name` | varchar(100) | e.g. "PM Pivot", "Software Engineer" |
| `resume_text` | text | confirmed/edited extracted resume content |
| `instructions` | text | user-editable analysis instructions |
| `is_active` | bool | exactly one true per user at a time |
| `created_at` | timestamp | |

- Setting a profile active flips the previous active profile to `false` in the same transaction
- No changes to the `users` table

### Default instruction template (pre-filled on new profile creation)

> "Analyze this job for overall fit based on my resume. Highlight skill gaps and strengths, and flag any responsibilities or requirements I should pay special attention to."

---

## API

### New router: `/api/v1/profiles/`

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/profiles` | List all profiles for current user |
| `POST` | `/profiles` | Create new profile (name, resume_text, instructions) |
| `PUT` | `/profiles/{id}` | Update name, resume_text, or instructions |
| `DELETE` | `/profiles/{id}` | Delete a profile |
| `POST` | `/profiles/{id}/activate` | Set as active, flips previous active to false |
| `POST` | `/profiles/parse-resume` | Accept PDF/DOCX, return extracted text — does NOT save |

### Resume parsing flow

1. Frontend POSTs file to `/profiles/parse-resume` (multipart)
2. Backend detects MIME type, extracts text via `pypdf` (PDF) or `python-docx` (DOCX)
3. Returns extracted text string — file is never persisted
4. Frontend drops text into editable textarea for user confirmation/editing
5. User confirms → POST/PUT to save the profile with confirmed text

---

## Service Layer Changes

All existing Claude services currently use a hardcoded `SYSTEM_PROMPT` string. These are refactored to accept `resume_text` and `instructions` as parameters.

### New prompt structure (all services)

```
[Base system instructions — role, output format, scoring rubric]

CANDIDATE RESUME:
{resume_text}

ANALYSIS INSTRUCTIONS:
{instructions}
```

### Services to update

- `backend/app/services/claude.py` — job analysis
- `backend/app/services/cover_letter.py` — cover letter generation
- `backend/app/services/interview_prep.py` — interview prep
- `backend/app/services/reach.py` — reach job analysis
- `backend/app/services/app_questions.py` — application questions

### Active profile injection

Each API route handler fetches the user's active profile once at request time (single indexed DB query), then passes `resume_text` and `instructions` down to the service call. Services remain stateless — no profile awareness inside the service layer.

---

## Frontend (Dashboard)

### Account tab restructure

The Account tab gains a two-panel layout:
- **Left column:** vertical tab headers — "Account Details", "Profiles"
- **Right panel:** content for the selected tab

### Profiles tab

**Profile list:**
- Each profile shows its name and an "Active" badge if currently active
- Per-profile actions: "Set Active", "Edit", "Delete"
- "New Profile" button at top

**Profile editor (inline on create/edit):**
- **Name** — text input
- **Resume** — file upload button (PDF/DOCX) → calls parse endpoint → result appears in editable textarea for confirmation
- **Instructions** — textarea, pre-filled with default template on new profiles
- Save / Cancel

**Active profile indicator:**
- Persistent label in the dashboard header showing the currently active profile name

---

## Resume Parsing Libraries

| Format | Library |
|---|---|
| PDF | `pypdf` |
| DOCX | `python-docx` |

Both are lightweight and require no external services. Added to `backend/requirements.txt`.

---

## Token Efficiency

- Resume text is injected into Claude's context only at analysis request time
- Active profile is fetched via one indexed DB query per request — no caching layer needed at this scale
- No resume content is stored in `chrome.storage.local` or sent in extension payloads

---

## Migration

- Alembic migration to create `user_profiles` table
- Existing users start with no profiles; the UI prompts them to create one before analysis is available
- Hardcoded profile strings are removed from all service files after dynamic injection is in place
