# Profile Attribution on History — Design Spec

## Goal

Show which resume profile was used for each job analysis in the history dashboard, allow filtering history by profile, and let users re-analyze a job under their currently active profile (creating a new history entry alongside the original).

## Architecture

Profile attribution is captured at analysis time by snapshotting `profile_id` and `profile_name` onto the `job_analyses` row. The snapshot approach means the history label is stable even after a profile is renamed or deleted. The dashboard loads all history in one fetch, then filters client-side by profile. Re-analysis reuses the existing `POST /analyze` endpoint — no new route needed.

## Data Model

Two nullable columns added to `job_analyses`:

| Column | Type | Notes |
|---|---|---|
| `profile_id` | `Integer`, nullable FK → `user_profiles(id)` ON DELETE SET NULL | Links row to the profile used |
| `profile_name` | `String(100)`, nullable | Snapshot at analysis time; stable after profile rename/delete |

Both columns are nullable so existing rows and unauthenticated analyses degrade gracefully (display as blank, not an error).

Alembic migration: `a006_add_profile_to_job_analyses.py`, down_revision points to the `user_profiles` migration (`a005_add_user_profiles`).

## API Changes

### `POST /api/v1/analyze`
- Already fetches the active profile via `_get_active_profile()`.
- Now also writes `profile_id` and `profile_name` onto the `JobAnalysis` row before saving.
- No request schema changes.

### `GET /api/v1/analyze/history`
- `JobHistoryItem` schema gains two optional fields:
  - `profile_id: Optional[int] = None`
  - `profile_name: Optional[str] = None`
- Existing rows return `null` on both — dashboard treats `null` as "no profile / pre-feature".

### `GET /api/v1/profiles/active`
New lightweight endpoint on the profiles router. Returns:
```json
{ "id": 3, "name": "Senior IC" }
```
Returns `null` (HTTP 200) when no profile is active. Dashboard calls this on load to seed the filter dropdown default.

### Re-analyze (no new endpoint)
The dashboard sends the existing job's stored data (title, company, description, URL) back to `POST /analyze`. The backend analyzes under the currently active profile and creates a fresh row. The old row is untouched.

## Dashboard UI

### Profile badge on history rows
- Small pill element rendered alongside the job title.
- Text: the `profile_name` value from the history row.
- Rows with `null` profile_name render no badge.
- Style: matches the existing status pill aesthetic (subtle, muted).

### Profile filter dropdown
- Positioned above the history table, to the left of the existing search/filter controls.
- Options: "All Profiles" (always first) + one entry per distinct `profile_name` that appears in the loaded history.
- Profiles with `null` name are grouped under "No Profile" option only if any such rows exist.
- On page load: dashboard fetches `GET /profiles/active` and sets the dropdown to the matching profile name. Falls back to "All Profiles" if no active profile or no history rows match.
- Filtering is client-side — no additional API calls when the dropdown changes.

### Re-analyze button
- Rendered inside the expanded accordion row (the detail view that opens on clicking a history row).
- Label: "Re-analyze" or "Analyze under [active profile name]".
- On click: POSTs to `/analyze` with the stored job data. Shows a loading state on the button while in-flight.
- On success: reloads the full history list (the new row will appear at the top). No confirmation dialog needed.
- On error: shows an inline error message in the accordion.

## Error Handling

- If active profile is deleted between page load and re-analyze click: `/analyze` returns HTTP 400 ("No active profile found"). Dashboard shows the error text inline.
- History rows with a deleted profile still display the `profile_name` snapshot correctly (it's a string, not a join).
- If `GET /profiles/active` fails: dropdown defaults to "All Profiles" silently.

## What This Does Not Change

- The analysis result itself (score, gaps, flags) is unchanged — only the storage and display layer is affected.
- Existing history rows remain fully visible; they just have no profile badge.
- The extension content script and background worker are unchanged.
- No migration of old rows to assign profiles retroactively.
