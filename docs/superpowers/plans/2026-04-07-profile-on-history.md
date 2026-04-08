# Profile Attribution on History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which resume profile was used for each history row, add a profile filter dropdown defaulting to the active profile, and add a re-analyze button that creates a new history entry under the current active profile.

**Architecture:** Snapshot `profile_id` + `profile_name` onto `job_analyses` at analysis time. The dashboard fetches this data via the existing `/history` endpoint (extended with two new fields) and filters client-side. Re-analysis fetches the job description from a new `GET /analyze/job/{db_id}` endpoint then POSTs to `/analyze`. A new `GET /profiles/active` endpoint seeds the filter dropdown default.

**Tech Stack:** SQLAlchemy 2.0, Alembic, FastAPI, TypeScript (Chrome extension), pnpm/webpack

---

## File Map

| File | Change |
|---|---|
| `backend/alembic/versions/a006_add_profile_to_job_analyses.py` | Create — migration adding 2 columns |
| `backend/app/models/job.py` | Modify — add `profile_id`, `profile_name` |
| `backend/app/schemas/analyze.py` | Modify — add fields to `JobHistoryItem` |
| `backend/app/schemas/profile.py` | Modify — add `ActiveProfileResponse` |
| `backend/app/models/repository.py` | Modify — `save_analysis` accepts profile params |
| `backend/app/api/analyze.py` | Modify — pass profile to save; add `GET /job/{db_id}` |
| `backend/app/api/profiles.py` | Modify — add `GET /active` endpoint |
| `backend/tests/test_profile_history.py` | Create — tests for new endpoints |
| `extension/public/dashboard.html` | Modify — add profile filter dropdown |
| `extension/src/dashboard/index.ts` | Modify — profile badge, filter, re-analyze button |

---

### Task 1: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/a006_add_profile_to_job_analyses.py`

- [ ] **Step 1: Write the migration file**

```python
# backend/alembic/versions/a006_add_profile_to_job_analyses.py
"""add profile columns to job_analyses

Revision ID: a006_add_profile_to_job_analyses
Revises: a005_add_user_profiles
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa

revision = "a006_add_profile_to_job_analyses"
down_revision = "a005_add_user_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_analyses",
        sa.Column("profile_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "job_analyses",
        sa.Column("profile_name", sa.String(100), nullable=True),
    )
    op.create_foreign_key(
        "fk_job_analyses_profile_id",
        "job_analyses",
        "user_profiles",
        ["profile_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_job_analyses_profile_id", "job_analyses", type_="foreignkey")
    op.drop_column("job_analyses", "profile_name")
    op.drop_column("job_analyses", "profile_id")
```

- [ ] **Step 2: Run the migration**

Make sure Docker PostgreSQL is up, then run from `backend/`:

```bash
DATABASE_URL=postgresql://jobscout:jobscout@localhost:5432/jobscout alembic upgrade head
```

Expected output ends with:
```
Running upgrade a005_add_user_profiles -> a006_add_profile_to_job_analyses, add profile columns to job_analyses
```

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/a006_add_profile_to_job_analyses.py
git commit -m "feat: migration — add profile_id and profile_name to job_analyses"
```

---

### Task 2: SQLAlchemy Model

**Files:**
- Modify: `backend/app/models/job.py`

- [ ] **Step 1: Write the failing test** (verifying columns exist on the model)

Create `backend/tests/test_profile_history.py`:

```python
# backend/tests/test_profile_history.py
"""Tests for profile attribution on history feature."""
import pytest
from app.models.job import JobAnalysis


def test_job_analysis_has_profile_columns():
    """JobAnalysis model must expose profile_id and profile_name."""
    cols = {c.key for c in JobAnalysis.__table__.columns}
    assert "profile_id" in cols
    assert "profile_name" in cols
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pytest tests/test_profile_history.py::test_job_analysis_has_profile_columns -v
```

Expected: FAIL — `AssertionError` (columns not yet on model)

- [ ] **Step 3: Add the two columns to `backend/app/models/job.py`**

After the existing `ext_job_id` line (line 34), add:

```python
    profile_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True, default=None)
    profile_name: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
```

The top of the file already imports `Integer`, `String`, `ForeignKey` so no new imports are needed.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && pytest tests/test_profile_history.py::test_job_analysis_has_profile_columns -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/job.py backend/tests/test_profile_history.py
git commit -m "feat: add profile_id and profile_name columns to JobAnalysis model"
```

---

### Task 3: Pydantic Schemas

**Files:**
- Modify: `backend/app/schemas/analyze.py` (lines 41-61, `JobHistoryItem`)
- Modify: `backend/app/schemas/profile.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_profile_history.py`:

```python
from app.schemas.analyze import JobHistoryItem
from app.schemas.profile import ActiveProfileResponse


def test_job_history_item_has_profile_fields():
    """JobHistoryItem must include optional profile_id and profile_name."""
    fields = JobHistoryItem.model_fields
    assert "profile_id" in fields
    assert "profile_name" in fields


def test_active_profile_response_schema():
    """ActiveProfileResponse must have id and name."""
    r = ActiveProfileResponse(id=1, name="Senior IC")
    assert r.id == 1
    assert r.name == "Senior IC"
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd backend && pytest tests/test_profile_history.py::test_job_history_item_has_profile_fields tests/test_profile_history.py::test_active_profile_response_schema -v
```

Expected: both FAIL (fields missing / class not found)

- [ ] **Step 3: Update `JobHistoryItem` in `backend/app/schemas/analyze.py`**

Add two fields after the `notes` field (line ~53):

```python
    profile_id: Optional[int] = None
    profile_name: Optional[str] = None
```

The full updated class:

```python
class JobHistoryItem(BaseModel):
    id: int
    url: Optional[str]
    job_title: str
    company: str
    fit_score: int
    should_apply: bool
    one_line_verdict: str
    created_at: datetime
    status: Optional[str] = None
    applied_date: Optional[datetime] = None
    notes: Optional[str] = None
    salary_estimate: Optional[dict] = None
    direct_matches: list = []
    transferable: list = []
    gaps: list = []
    red_flags: list[str] = []
    green_flags: list[str] = []
    profile_id: Optional[int] = None
    profile_name: Optional[str] = None

    class Config:
        from_attributes = True
```

- [ ] **Step 4: Add `ActiveProfileResponse` to `backend/app/schemas/profile.py`**

Append at the end of the file:

```python
class ActiveProfileResponse(BaseModel):
    id: int
    name: str
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_profile_history.py::test_job_history_item_has_profile_fields tests/test_profile_history.py::test_active_profile_response_schema -v
```

Expected: both PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/analyze.py backend/app/schemas/profile.py backend/tests/test_profile_history.py
git commit -m "feat: add profile fields to JobHistoryItem and ActiveProfileResponse schema"
```

---

### Task 4: Repository — `save_analysis`

**Files:**
- Modify: `backend/app/models/repository.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_profile_history.py`:

```python
import inspect
from app.models.repository import save_analysis


def test_save_analysis_accepts_profile_params():
    """save_analysis must accept profile_id and profile_name keyword args."""
    sig = inspect.signature(save_analysis)
    assert "profile_id" in sig.parameters
    assert "profile_name" in sig.parameters
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pytest tests/test_profile_history.py::test_save_analysis_accepts_profile_params -v
```

Expected: FAIL

- [ ] **Step 3: Update `save_analysis` in `backend/app/models/repository.py`**

Add two keyword params and set them on the record. The full updated function:

```python
def save_analysis(
    db: Session,
    job_title: str,
    company: str,
    job_description: str,
    result: AnalyzeResponse,
    url: str | None = None,
    user_id: int | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
) -> JobAnalysis:
    salary_estimate_dict = None
    if result.salary_estimate:
        salary_estimate_dict = {
            "low": result.salary_estimate.low,
            "high": result.salary_estimate.high,
            "currency": result.salary_estimate.currency,
            "per": result.salary_estimate.per,
            "confidence": result.salary_estimate.confidence,
            "assessment": result.salary_estimate.assessment,
        }

    record = JobAnalysis(
        url=url,
        job_title=job_title,
        company=company,
        job_description=job_description,
        fit_score=result.fit_score,
        should_apply=result.should_apply,
        one_line_verdict=result.one_line_verdict,
        direct_matches=[i.model_dump() for i in result.direct_matches],
        transferable=[i.model_dump() for i in result.transferable],
        gaps=[i.model_dump() for i in result.gaps],
        red_flags=result.red_flags,
        green_flags=result.green_flags,
        salary_estimate=salary_estimate_dict,
        user_id=user_id,
        profile_id=profile_id,
        profile_name=profile_name,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("Saved analysis id=%s, fit_score=%s", record.id, record.fit_score)
    return record
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_profile_history.py::test_save_analysis_accepts_profile_params -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/repository.py backend/tests/test_profile_history.py
git commit -m "feat: save_analysis accepts profile_id and profile_name"
```

---

### Task 5: Analyze API — pass profile to save + job detail endpoint

**Files:**
- Modify: `backend/app/api/analyze.py`

There are three places in `analyze_job_posting` where `save_analysis` is called (lines 107-116 and 137-146). Both need `profile_id` and `profile_name` passed through. Also add a new `GET /job/{db_id}` endpoint for the dashboard's re-analyze flow.

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_profile_history.py`:

```python
from app.api.analyze import analyze_job_posting, get_job_by_db_id


def test_get_job_by_db_id_function_exists():
    """get_job_by_db_id route handler must exist."""
    import inspect
    assert callable(get_job_by_db_id)
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pytest tests/test_profile_history.py::test_get_job_by_db_id_function_exists -v
```

Expected: FAIL (ImportError or AttributeError)

- [ ] **Step 3: Update `analyze_job_posting` in `backend/app/api/analyze.py`**

In the cached-result-for-new-user path (~line 107), update the `save_analysis` call:

```python
        new_row = save_analysis(
            db=db,
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description,
            result=response,
            url=request.url,
            user_id=current_user.id,
            profile_id=profile.id,
            profile_name=profile.name,
        )
```

In the fresh-analysis path (~line 137), update the `save_analysis` call:

```python
    saved = save_analysis(
        db=db,
        job_title=request.job_title,
        company=request.company,
        job_description=request.job_description,
        result=result,
        url=request.url,
        user_id=current_user.id,
        profile_id=profile.id,
        profile_name=profile.name,
    )
```

- [ ] **Step 4: Add `GET /job/{db_id}` endpoint to `backend/app/api/analyze.py`**

Add this route after the `get_score_by_job_id` route (~line 211):

```python
@router.get("/job/{db_id}")
async def get_job_by_db_id(
    db_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Fetch job data by database row ID. Used by the dashboard re-analyze flow."""
    record = (
        db.query(JobAnalysis)
        .filter(JobAnalysis.id == db_id, JobAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "db_id": record.id,
        "job_title": record.job_title,
        "company": record.company,
        "job_description": record.job_description,
        "url": record.url,
    }
```

- [ ] **Step 5: Run tests**

```bash
cd backend && pytest tests/test_profile_history.py::test_get_job_by_db_id_function_exists -v
```

Expected: PASS

- [ ] **Step 6: Run full test suite to catch regressions**

```bash
cd backend && pytest -v
```

Expected: all existing tests still pass (the new params to `save_analysis` are optional with `None` defaults, so nothing breaks)

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/analyze.py backend/tests/test_profile_history.py
git commit -m "feat: pass profile to save_analysis; add GET /analyze/job/{db_id} endpoint"
```

---

### Task 6: Profiles API — `GET /profiles/active`

**Files:**
- Modify: `backend/app/api/profiles.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_profile_history.py`:

```python
from app.api.profiles import get_active_profile_endpoint


def test_get_active_profile_endpoint_exists():
    """get_active_profile_endpoint route handler must exist."""
    assert callable(get_active_profile_endpoint)
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pytest tests/test_profile_history.py::test_get_active_profile_endpoint_exists -v
```

Expected: FAIL (ImportError)

- [ ] **Step 3: Add the endpoint to `backend/app/api/profiles.py`**

Add the import at the top of `profiles.py` (after existing imports):

```python
from app.schemas.profile import ProfileCreate, ProfileUpdate, ProfileResponse, ParseResumeResponse, ActiveProfileResponse
from typing import Optional
```

Add the new route **before** the `/{profile_id}` routes (place it after `parse-resume`, before the `PUT /{profile_id}` route):

```python
@router.get("/active", response_model=Optional[ActiveProfileResponse])
def get_active_profile_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Optional[ActiveProfileResponse]:
    """Return the active profile's id and name, or null if none is active."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == current_user.id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        return None
    return ActiveProfileResponse(id=profile.id, name=profile.name)
```

Also update the imports at the top of `profiles.py`:

```python
from typing import Optional
from app.schemas.profile import ProfileCreate, ProfileUpdate, ProfileResponse, ParseResumeResponse, ActiveProfileResponse
```

(Replace the existing `from app.schemas.profile import ...` line and add `from typing import Optional` if not present.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_profile_history.py::test_get_active_profile_endpoint_exists -v
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
cd backend && pytest -v
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/profiles.py backend/app/schemas/profile.py backend/tests/test_profile_history.py
git commit -m "feat: add GET /profiles/active endpoint"
```

---

### Task 7: Dashboard HTML — profile filter dropdown

**Files:**
- Modify: `extension/public/dashboard.html`

The controls bar is at line 1221. We add a "Profile" filter control group at the end of the `.controls` div, before its closing `</div>`.

- [ ] **Step 1: Add the profile filter control group**

In `extension/public/dashboard.html`, locate this closing tag of the controls div (after the "Applied within" control group, around line 1290):

```html
        </div>
      </div>

      <div class="table-wrap">
```

Insert the new control group before `</div>` that closes `.controls`:

```html
        <div class="control-group">
          <span class="control-label">Profile</span>
          <select id="filter-profile">
            <option value="all">All profiles</option>
          </select>
        </div>
```

Full resulting block (replace the closing section of `.controls`):

```html
        <div class="control-group">
          <span class="control-label">Applied within</span>
          <select id="filter-applied-date">
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <div class="control-group">
          <span class="control-label">Profile</span>
          <select id="filter-profile">
            <option value="all">All profiles</option>
          </select>
        </div>
      </div>
```

- [ ] **Step 2: Verify the build works**

```bash
cd extension && pnpm build
```

Expected: no errors, `dist/dashboard.js` updated

- [ ] **Step 3: Commit**

```bash
git add extension/public/dashboard.html
git commit -m "feat: add profile filter dropdown to dashboard history controls"
```

---

### Task 8: Dashboard TypeScript — profile badge, filter, re-analyze

**Files:**
- Modify: `extension/src/dashboard/index.ts`

This task has multiple sub-changes. Apply them in order.

**8a — Add `profileName` to `DashboardJob` interface and state**

- [ ] **Step 1: Update the `DashboardJob` interface**

Locate the `DashboardJob` interface (line ~50). Add one field after `dbId`:

```typescript
interface DashboardJob {
  jobId: string;
  jobTitle: string;
  company: string;
  score: number;
  shouldApply: boolean;
  verdict: string;
  salary: string | null;
  salaryEstimate: SalaryEstimate | null;
  site: string;
  timestamp: number;
  status: AppStatus;
  appliedDate: number | null;
  result: AnalyzeResponse;
  url: string | null;
  dbId?: number;
  profileName?: string | null;
}
```

**8b — Add `activeProfileName` module-level state variable**

- [ ] **Step 2: Add state variable**

After the existing state variables (`let profiles`, `let editingProfileId`), add:

```typescript
let activeProfileName: string | null = null;
```

**8c — Add `fetchActiveProfile` helper**

- [ ] **Step 3: Add the function after the existing `fetchProfiles` function (~line 1237)**

```typescript
async function fetchActiveProfile(): Promise<{ id: number; name: string } | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await fetch(`${process.env.BACKEND_URL}/profiles/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}
```

**8d — Extend `syncStatusFromBackend` to set `profileName` on jobs and populate the profile dropdown**

- [ ] **Step 4: Update `syncStatusFromBackend`**

The function currently fetches history and only syncs statuses. Extend it to also set `profileName` on each job and populate the filter dropdown.

In `syncStatusFromBackend`, change the type annotation of `backendJobs` and add profile handling. Locate this block (around line 417):

```typescript
    const backendJobs: Array<{ id: number; status: string | null; url?: string }> = await r.json();
```

Change it to:

```typescript
    const backendJobs: Array<{ id: number; status: string | null; url?: string; profile_name?: string | null }> = await r.json();
```

Then after the existing status-sync loop (after `if (changed) { renderStats(); renderTable(); }`), add:

```typescript
    // Set profileName on in-memory jobs from backend history data
    for (const bj of backendJobs) {
      const local = allJobs.find((j) => j.dbId === bj.id);
      if (local) local.profileName = bj.profile_name ?? null;
    }

    // Populate the profile filter dropdown
    populateProfileFilter();
```

**8e — Add `populateProfileFilter` function**

- [ ] **Step 5: Add the function before `renderTable`**

```typescript
async function populateProfileFilter(): Promise<void> {
  const sel = document.getElementById("filter-profile") as HTMLSelectElement | null;
  if (!sel) return;

  // Collect distinct non-null profile names from loaded jobs
  const names = Array.from(
    new Set(allJobs.map((j) => j.profileName).filter((n): n is string => !!n))
  ).sort();

  // Rebuild options: always start with "All profiles"
  sel.innerHTML = `<option value="all">All profiles</option>` +
    names.map((n) => `<option value="${n}">${n}</option>`).join("") +
    (allJobs.some((j) => j.profileName == null || j.profileName === "")
      ? `<option value="__none__">No profile</option>`
      : "");

  // Seed default to active profile if it appears in the list
  if (activeProfileName && names.includes(activeProfileName)) {
    sel.value = activeProfileName;
  }

  renderTable();
  updateCount();
}
```

**8f — Wire profile filter to `getFilteredJobs`**

- [ ] **Step 6: Update `getFilteredJobs` to handle profile filtering**

At the top of `getFilteredJobs` (after the existing filter reads), add:

```typescript
  const profileFilter =
    (document.getElementById("filter-profile") as HTMLSelectElement)?.value ?? "all";
```

Inside the `.filter()` chain, add after the `appliedCutoff` check (before `return true`):

```typescript
      if (profileFilter === "__none__" && j.profileName) return false;
      if (
        profileFilter !== "all" &&
        profileFilter !== "__none__" &&
        j.profileName !== profileFilter
      )
        return false;
```

- [ ] **Step 7: Wire the dropdown change event**

After the existing `filter-applied-date` event listener (~line 978), add:

```typescript
document.getElementById("filter-profile")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});
```

**8g — Add profile badge to history rows**

- [ ] **Step 8: Update `renderTable` to show profile badge**

In `renderTable`, locate the `<td>` that shows the job title and company (around line 741). Add the profile badge inside the job-title `<td>`, after the company div:

```typescript
      <td>
        <div class="job-title" title="${job.jobTitle}">
          ${
            job.url
              ? `<a href="${job.url}" target="_blank"
                class="job-title-link"
                data-job-id="${job.jobId}"
                data-site="${job.site}"
                data-url="${job.url}"
                style="color:#e2e8f0;text-decoration:none;cursor:pointer;"
                onmouseover="this.style.color='#38bdf8'"
                onmouseout="this.style.color='#e2e8f0'">${job.jobTitle}</a>`
              : job.jobTitle
          }
        </div>
        <div class="company">${job.company}</div>
        ${job.profileName ? `<span style="font-size:10px;color:#64748b;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:1px 6px;display:inline-block;margin-top:3px">${job.profileName}</span>` : ""}
      </td>
```

**8h — Add re-analyze button and logic**

- [ ] **Step 9: Add re-analyze button to the expanded detail row**

In `renderTable`, inside the `if (isExpanded)` block, locate the opening `<td colspan="10">`. Add the re-analyze button at the very top of the expanded cell content, before the verdict div:

```typescript
      <td colspan="10">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="font-size:12px;color:#94a3b8;font-style:italic;flex:1">${job.verdict}</div>
          <button
            class="reanalyze-btn"
            data-job-id="${job.jobId}"
            data-db-id="${job.dbId ?? ""}"
            style="font-size:11px;padding:4px 10px;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:5px;cursor:pointer;white-space:nowrap;flex-shrink:0"
            title="Re-analyze under your current active profile"
          >↺ Re-analyze</button>
        </div>
        <div class="detail-grid">
```

Remove the old standalone verdict div:

```typescript
          <div style="font-size:12px;color:#94a3b8;font-style:italic;margin-bottom:12px">${job.verdict}</div>
```

- [ ] **Step 10: Add re-analyze click handler inside `renderTable`**

After the existing event listener wiring at the bottom of `renderTable` (after the HC link intercept), add:

```typescript
  // Re-analyze button
  tbody.querySelectorAll<HTMLButtonElement>(".reanalyze-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const dbId = Number(btn.getAttribute("data-db-id"));
      if (!dbId) return;

      const originalText = btn.textContent!;
      btn.disabled = true;
      btn.textContent = "Analyzing…";

      try {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");

        // Fetch job description from backend
        const detailResp = await fetch(`${process.env.BACKEND_URL}/job/${dbId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!detailResp.ok) throw new Error("Could not fetch job details");
        const detail: { job_title: string; company: string; job_description: string; url?: string } =
          await detailResp.json();

        // Re-analyze under the current active profile
        const analyzeResp = await fetch(`${process.env.BACKEND_URL}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            job_title: detail.job_title,
            company: detail.company,
            job_description: detail.job_description,
            url: detail.url ?? null,
          }),
        });
        if (!analyzeResp.ok) {
          const err = await analyzeResp.json();
          throw new Error(err.detail ?? "Re-analysis failed");
        }

        // Reload history to show the new row
        btn.textContent = "Done!";
        setTimeout(() => {
          loadJobs();
        }, 800);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Re-analysis failed";
        btn.textContent = msg;
        btn.style.color = "#f87171";
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = originalText;
          btn.style.color = "#94a3b8";
        }, 3000);
      }
    });
  });
```

**8i — Load active profile on init and seed dropdown**

- [ ] **Step 11: Update `loadJobs` to fetch the active profile name**

In `loadJobs`, the function currently ends with:

```typescript
    backfillDbIds().then(() => syncStatusFromBackend());
```

Change it to also fetch the active profile before populating the dropdown:

```typescript
    backfillDbIds().then(async () => {
      const active = await fetchActiveProfile();
      activeProfileName = active?.name ?? null;
      await syncStatusFromBackend();
    });
```

- [ ] **Step 12: Build the extension**

```bash
cd extension && pnpm build
```

Expected: no TypeScript errors, `dist/dashboard.js` updated

- [ ] **Step 13: Commit**

```bash
git add extension/src/dashboard/index.ts
git commit -m "feat: profile badge, filter dropdown, and re-analyze button on history dashboard"
```

---

### Task 9: End-to-end smoke test

- [ ] **Step 1: Start the backend**

```bash
cd backend && uvicorn app.main:app --reload
```

- [ ] **Step 2: Run all backend tests**

```bash
cd backend && pytest -v
```

Expected: all pass

- [ ] **Step 3: Load the extension in Chrome**

In Chrome, go to `chrome://extensions` → Developer mode → Reload the JobScout extension (or click the reload icon on the extension card).

- [ ] **Step 4: Verify profile badge appears**

Open the dashboard (history tab). Jobs analyzed after this feature went live should show a small profile name badge below the company name. Older jobs show no badge.

- [ ] **Step 5: Verify profile filter**

The "Profile" dropdown in the controls bar should list distinct profile names from history. Changing it should filter the table client-side.

- [ ] **Step 6: Verify re-analyze**

Expand a job row by clicking the ▼ button. Click "↺ Re-analyze". It should show "Analyzing…", then "Done!", then reload the table with a new row at the top under the current active profile.

- [ ] **Step 7: Final commit if any loose ends**

```bash
git add -p  # stage any remaining changes
git commit -m "chore: cleanup after profile-on-history implementation"
```
