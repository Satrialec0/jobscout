# Resume Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded candidate profile in all Claude service prompts with dynamic per-user profiles stored in PostgreSQL, each with a resume and custom analysis instructions.

**Architecture:** A new `user_profiles` table stores named profiles per user. Each API route handler that calls a Claude service fetches the user's active profile once via indexed DB query and passes `resume_text` + `instructions` into the service call. Services become stateless with respect to candidate data. The dashboard Account tab gains a two-panel layout with a Profiles section for CRUD and resume upload.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, pypdf, python-docx, python-multipart, pytest, TypeScript (Chrome extension dashboard)

---

## File Map

**Create:**
- `backend/app/models/user_profile.py` — UserProfile SQLAlchemy model + DEFAULT_INSTRUCTIONS constant
- `backend/app/schemas/profile.py` — Pydantic schemas: ProfileCreate, ProfileUpdate, ProfileResponse, ParseResumeResponse
- `backend/app/services/resume_parser.py` — PDF/DOCX text extraction (never persists file)
- `backend/app/api/profiles.py` — Profile CRUD + parse-resume + activate endpoints
- `backend/alembic/versions/a005_add_user_profiles.py` — Migration for user_profiles table
- `backend/tests/test_profiles.py` — Unit tests for resume parser + integration tests for profile API

**Modify:**
- `backend/requirements.txt` — Add pypdf, python-docx, python-multipart
- `backend/app/main.py` — Register profiles router at `/api/v1/profiles`
- `backend/app/services/claude.py` — Accept `resume_text` + `instructions`, build prompt dynamically
- `backend/app/services/cover_letter.py` — Same
- `backend/app/services/interview_prep.py` — Same
- `backend/app/services/app_questions.py` — Same
- `backend/app/services/reach.py` — Same for both `cluster_reach_jobs` and `analyze_reach_group`
- `backend/app/api/analyze.py` — Add `_get_active_profile()` helper; inject profile into `/analyze`, `/interview-prep`, `/cover-letter`, `/app-question` handlers
- `backend/app/api/reach.py` — Add `db` dependency + inject profile into both handlers
- `extension/public/dashboard.html` — Restructure Account tab into two-panel layout + add Profiles panel + CSS
- `extension/src/dashboard/index.ts` — Add profile management functions + wire up Profiles panel UI

---

## Task 1: Add Python Dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add the three libraries**

Open `backend/requirements.txt` and add these three lines after the existing entries:

```
pypdf==5.4.0
python-docx==1.1.2
python-multipart==0.0.20
```

- [ ] **Step 2: Install inside the running container**

```bash
docker compose exec backend pip install pypdf==5.4.0 python-docx==1.1.2 python-multipart==0.0.20
```

Expected: `Successfully installed pypdf-5.4.0 python-docx-1.1.2 python-multipart-0.0.20` (versions may vary if exact pins changed; adjust if pip reports a conflict)

- [ ] **Step 3: Verify imports work**

```bash
docker compose exec backend python -c "import pypdf; import docx; import multipart; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add pypdf, python-docx, python-multipart dependencies"
```

---

## Task 2: Create UserProfile Model

**Files:**
- Create: `backend/app/models/user_profile.py`

- [ ] **Step 1: Write the model**

Create `backend/app/models/user_profile.py`:

```python
from datetime import datetime, timezone
from sqlalchemy import Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

DEFAULT_INSTRUCTIONS = (
    "Analyze this job for overall fit based on my resume. "
    "Highlight skill gaps and strengths, and flag any responsibilities "
    "or requirements I should pay special attention to."
)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    resume_text: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default=DEFAULT_INSTRUCTIONS)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
```

- [ ] **Step 2: Verify import works**

```bash
docker compose exec backend python -c "from app.models.user_profile import UserProfile, DEFAULT_INSTRUCTIONS; print(DEFAULT_INSTRUCTIONS[:30])"
```

Expected: `Analyze this job for overall fi`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/user_profile.py
git commit -m "feat: add UserProfile model"
```

---

## Task 3: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/a005_add_user_profiles.py`

- [ ] **Step 1: Create the migration file**

Create `backend/alembic/versions/a005_add_user_profiles.py`:

```python
"""add user_profiles table

Revision ID: a005
Revises: a004
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa

revision = "a005"
down_revision = "a004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("resume_text", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_user_profiles_user_id", "user_profiles", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_profiles_user_id", table_name="user_profiles")
    op.drop_table("user_profiles")
```

- [ ] **Step 2: Check the revision ID of the most recent existing migration**

```bash
docker compose exec backend alembic heads
```

If the current head is not `a004`, update `down_revision` in the file above to match the actual current head revision ID.

- [ ] **Step 3: Run the migration**

```bash
docker compose exec backend alembic upgrade head
```

Expected: `Running upgrade a004 -> a005, add user_profiles table`

- [ ] **Step 4: Verify table was created**

```bash
docker compose exec db psql -U postgres -d jobscout -c "\d user_profiles"
```

Expected: table with columns id, user_id, name, resume_text, instructions, is_active, created_at.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/a005_add_user_profiles.py
git commit -m "feat: migration to add user_profiles table"
```

---

## Task 4: Profile Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/profile.py`

- [ ] **Step 1: Write the schemas**

Create `backend/app/schemas/profile.py`:

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from app.models.user_profile import DEFAULT_INSTRUCTIONS


class ProfileCreate(BaseModel):
    name: str = Field(..., max_length=100)
    resume_text: Optional[str] = None
    instructions: str = DEFAULT_INSTRUCTIONS


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    resume_text: Optional[str] = None
    instructions: Optional[str] = None


class ProfileResponse(BaseModel):
    id: int
    name: str
    resume_text: Optional[str]
    instructions: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ParseResumeResponse(BaseModel):
    text: str
```

- [ ] **Step 2: Verify import works**

```bash
docker compose exec backend python -c "from app.schemas.profile import ProfileCreate, ProfileResponse; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/profile.py
git commit -m "feat: add profile Pydantic schemas"
```

---

## Task 5: Resume Parser Service + Tests

**Files:**
- Create: `backend/app/services/resume_parser.py`
- Create: `backend/tests/test_profiles.py`

- [ ] **Step 1: Write the failing tests first**

Create `backend/tests/test_profiles.py`:

```python
import io
import pytest


def test_extract_docx_returns_text():
    """DOCX extraction returns the paragraph text from the document."""
    from docx import Document
    from app.services.resume_parser import _extract_docx

    doc = Document()
    doc.add_paragraph("Jane Doe - Software Engineer")
    doc.add_paragraph("Skills: Python, SQL, AWS")
    buf = io.BytesIO()
    doc.save(buf)

    result = _extract_docx(buf.getvalue())

    assert "Jane Doe" in result
    assert "Python" in result


def test_extract_docx_empty_doc_returns_empty_string():
    from docx import Document
    from app.services.resume_parser import _extract_docx

    doc = Document()
    buf = io.BytesIO()
    doc.save(buf)

    result = _extract_docx(buf.getvalue())

    assert result == ""


def test_extract_unsupported_type_raises():
    """Uploading a plain text file raises an HTTP 400 error."""
    from fastapi import UploadFile
    from fastapi.testclient import TestClient
    from app.main import app
    import unittest.mock as mock

    # Mock get_current_user to bypass auth
    from app.api.deps import get_current_user
    from app.models.user import User

    fake_user = User(id=1, email="test@test.com", password_hash="x", anthropic_api_key=None)

    app.dependency_overrides[get_current_user] = lambda: fake_user

    client = TestClient(app)
    response = client.post(
        "/api/v1/profiles/parse-resume",
        files={"file": ("resume.txt", b"plain text content", "text/plain")},
    )

    app.dependency_overrides.clear()

    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail (module not found is expected)**

```bash
docker compose exec backend pytest tests/test_profiles.py -v 2>&1 | head -30
```

Expected: ERRORS due to `app.services.resume_parser` not existing yet.

- [ ] **Step 3: Create the resume parser service**

Create `backend/app/services/resume_parser.py`:

```python
import io
import logging
from fastapi import UploadFile, HTTPException

logger = logging.getLogger(__name__)


async def extract_resume_text(file: UploadFile) -> str:
    """Extract text from a PDF or DOCX upload. Never persists the file."""
    content = await file.read()
    content_type = file.content_type or ""
    filename = file.filename or ""

    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        return _extract_pdf(content)
    elif content_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ) or filename.lower().endswith((".docx", ".doc")):
        return _extract_docx(content)
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a PDF or DOCX file.",
        )


def _extract_pdf(content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


def _extract_docx(content: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(content))
    paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
    return "\n".join(paragraphs).strip()
```

- [ ] **Step 4: Run tests — all should pass**

```bash
docker compose exec backend pytest tests/test_profiles.py -v
```

Expected: 3 tests pass (`test_extract_docx_returns_text`, `test_extract_docx_empty_doc_returns_empty_string`, `test_extract_unsupported_type_raises`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/resume_parser.py backend/tests/test_profiles.py
git commit -m "feat: add resume parser service with DOCX and PDF extraction"
```

---

## Task 6: Profile API Router — CRUD

**Files:**
- Create: `backend/app/api/profiles.py`

- [ ] **Step 1: Create the profiles router with CRUD endpoints**

Create `backend/app/api/profiles.py`:

```python
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.user_profile import UserProfile, DEFAULT_INSTRUCTIONS
from app.schemas.profile import ProfileCreate, ProfileUpdate, ProfileResponse, ParseResumeResponse
from app.services.resume_parser import extract_resume_text

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[ProfileResponse])
def list_profiles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProfileResponse]:
    return (
        db.query(UserProfile)
        .filter(UserProfile.user_id == current_user.id)
        .order_by(UserProfile.created_at)
        .all()
    )


@router.post("", response_model=ProfileResponse, status_code=201)
def create_profile(
    body: ProfileCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    profile = UserProfile(
        user_id=current_user.id,
        name=body.name,
        resume_text=body.resume_text,
        instructions=body.instructions,
        is_active=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    logger.info("Created profile '%s' for user %d", body.name, current_user.id)
    return profile


@router.put("/{profile_id}", response_model=ProfileResponse)
def update_profile(
    profile_id: int,
    body: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    if body.name is not None:
        profile.name = body.name
    if body.resume_text is not None:
        profile.resume_text = body.resume_text
    if body.instructions is not None:
        profile.instructions = body.instructions
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=204)
def delete_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.delete(profile)
    db.commit()


@router.post("/parse-resume", response_model=ParseResumeResponse)
async def parse_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> ParseResumeResponse:
    """Extract text from a PDF or DOCX upload. Does NOT save the file or the text."""
    text = await extract_resume_text(file)
    if not text:
        raise HTTPException(
            status_code=422,
            detail="Could not extract text from the uploaded file. Try a different file.",
        )
    return ParseResumeResponse(text=text)


@router.post("/{profile_id}/activate", response_model=ProfileResponse)
def activate_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    """Set a profile as active. Flips all other profiles for this user to inactive."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    # Deactivate all other profiles for this user in one query
    db.query(UserProfile).filter(
        UserProfile.user_id == current_user.id,
        UserProfile.id != profile_id,
    ).update({"is_active": False})
    profile.is_active = True
    db.commit()
    db.refresh(profile)
    logger.info("Activated profile '%s' (id=%d) for user %d", profile.name, profile_id, current_user.id)
    return profile
```

**Important:** `parse-resume` is registered before `{profile_id}/activate` intentionally. FastAPI matches routes in registration order — `parse-resume` as a literal path segment will not conflict with the `{profile_id}` pattern because they differ in path depth.

- [ ] **Step 2: Verify the router imports cleanly**

```bash
docker compose exec backend python -c "from app.api.profiles import router; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/profiles.py
git commit -m "feat: add profile CRUD API router with resume parse endpoint"
```

---

## Task 7: Register Profiles Router

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Register the router**

In `backend/app/main.py`, add the import and `include_router` call:

```python
# Add this import alongside the existing router imports (around line 7-9):
from app.api.profiles import router as profiles_router

# Add this line after the existing include_router calls (around line 36):
app.include_router(profiles_router, prefix="/api/v1/profiles", tags=["profiles"])
```

- [ ] **Step 2: Verify the server starts and new routes appear**

```bash
docker compose exec backend python -c "from app.main import app; routes = [r.path for r in app.routes]; print([r for r in routes if 'profile' in r])"
```

Expected: list containing `/api/v1/profiles`, `/api/v1/profiles/{profile_id}`, `/api/v1/profiles/parse-resume`, `/api/v1/profiles/{profile_id}/activate`

- [ ] **Step 3: Smoke test the list endpoint (should return empty array)**

```bash
# Get a token first — substitute a real registered user's credentials
TOKEN=$(curl -s -X POST http://localhost:8001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8001/api/v1/profiles \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: `[]`

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: register profiles router at /api/v1/profiles"
```

---

## Task 8: Refactor claude.py — Dynamic Profile Injection

**Files:**
- Modify: `backend/app/services/claude.py`

- [ ] **Step 1: Split SYSTEM_PROMPT into base + dynamic builder**

In `backend/app/services/claude.py`, replace the `SYSTEM_PROMPT` constant and update `analyze_job()`:

Replace lines 11–70 (the `SYSTEM_PROMPT = """..."""` block) with:

```python
_BASE_PROMPT = """You are an expert job application strategist analyzing job fit for a specific candidate.

SCORING INSTRUCTIONS:
Analyze the job description and return ONLY a valid JSON object with no markdown, no code blocks, no explanation.
The JSON must exactly match this schema:
{
  "fit_score": <integer 0-100>,
  "should_apply": <boolean>,
  "one_line_verdict": "<one sentence max>",
  "direct_matches": [{"item": "<skill/experience>", "detail": "<why it matches>"}],
  "transferable": [{"item": "<skill/experience>", "detail": "<how to reframe>"}],
  "gaps": [{"item": "<missing requirement>", "detail": "<honest assessment>"}],
  "red_flags": ["<concerning aspect of the role>"],
  "green_flags": ["<strong positive signal>"],
  "salary_estimate": {
    "low": <integer, annual USD>,
    "high": <integer, annual USD>,
    "currency": "USD",
    "per": "year",
    "confidence": "<low|medium|high>",
    "assessment": "<one sentence comparing to listed salary, or null if no listed salary>"
  }
}

SALARY ESTIMATION INSTRUCTIONS:
- Always provide a salary_estimate based on: job title, seniority, company type/size, location signals, industry, and required experience
- Base estimates on current US market rates for 2025-2026
- If the job description lists a salary, set assessment to a one-sentence evaluation of whether it is below market, at market, or above market for this role and location
- If no salary is listed, set assessment to null
- Use these rough anchors for clean energy / engineering roles in the Northeast US:
  - Entry level (0-2 yrs): $65k-$85k
  - Mid level (3-5 yrs): $85k-$120k
  - Senior (5-8 yrs): $110k-$150k
  - Staff/Lead (8+ yrs): $140k-$200k
  - Adjust up 15-25% for NYC/SF, down 10-15% for remote or midwest roles
  - Adjust up for specialized skills (PE license, specific software, niche domain)
  - Adjust up for product/commercial roles vs pure engineering roles
- confidence should be "high" if the JD gives strong signals (title, location, years experience), "medium" if partial signals, "low" if minimal context

SCORING RUBRIC:
- 80-100: Strong match, apply immediately
- 60-79: Good match with some gaps, worth applying
- 40-59: Partial match, apply only if role is high priority
- Below 40: Significant gaps, not recommended

Be honest about gaps. Do not oversell. Flag real mismatches."""


def _build_system_prompt(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""{_BASE_PROMPT}

CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""
```

- [ ] **Step 2: Update the `analyze_job` function signature and body**

Replace the `analyze_job` function signature (line 123 onwards) — add `resume_text` and `instructions` parameters and call `_build_system_prompt`:

```python
def analyze_job(
    job_title: str,
    company: str,
    job_description: str,
    listed_salary: str | None = None,
    api_key: str | None = None,
    resume_text: str = "",
    instructions: str = "",
) -> AnalyzeResponse:
    logger.info("Starting analysis: %s at %s", job_title, company)

    if not api_key:
        settings = get_settings()
        api_key = settings.anthropic_api_key
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = _build_system_prompt(resume_text, instructions)
    salary_context = f"\nLISTED SALARY: {listed_salary}" if listed_salary else "\nLISTED SALARY: Not provided"

    user_message = f"""Please analyze this job posting for fit:

JOB TITLE: {job_title}
COMPANY: {company}{salary_context}

JOB DESCRIPTION:
{job_description}"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}]
        )
    except RateLimitError as e:
        logger.error("Claude API rate limit hit: %s", e)
        raise ValueError("Rate limit reached. Please wait a moment and try again.") from e
    except APIConnectionError as e:
        logger.error("Claude API connection error: %s", e)
        raise ValueError("Could not connect to Claude API. Check your internet connection.") from e
    except APIStatusError as e:
        logger.error("Claude API status error %s: %s", e.status_code, e.message)
        raise ValueError(f"Claude API error {e.status_code}: {e.message}") from e

    logger.info(
        "Claude response received, stop_reason: %s, tokens used: %s",
        message.stop_reason,
        message.usage.input_tokens + message.usage.output_tokens
    )

    return _parse_response(message.content[0].text, listed_salary)
```

- [ ] **Step 3: Verify import works**

```bash
docker compose exec backend python -c "from app.services.claude import analyze_job, _build_system_prompt; print(_build_system_prompt('My resume', 'Analyze fit')[:60])"
```

Expected: first 60 chars of the assembled prompt starting with "You are an expert"

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/claude.py
git commit -m "feat: refactor claude.py to accept dynamic resume_text and instructions"
```

---

## Task 9: Refactor cover_letter.py, interview_prep.py, app_questions.py

**Files:**
- Modify: `backend/app/services/cover_letter.py`
- Modify: `backend/app/services/interview_prep.py`
- Modify: `backend/app/services/app_questions.py`

All three follow the same pattern as Task 8: replace the hardcoded `CANDIDATE PROFILE` block in `SYSTEM_PROMPT` with a dynamic builder, and add `resume_text` + `instructions` parameters to the service function.

- [ ] **Step 1: Refactor cover_letter.py**

In `backend/app/services/cover_letter.py`:

Replace the `SYSTEM_PROMPT = """..."""` block (lines 9–34) with:

```python
_BASE_PROMPT = """You are an expert cover letter writer crafting a targeted, professional cover letter on behalf of a specific candidate.

INSTRUCTIONS:
- Write the cover letter as plain text, ready to paste into an application — no markdown, no headers, no subject line.
- Start directly with "Dear Hiring Team," unless a specific salutation is appropriate.
- Structure: brief opening hook → 1-2 paragraphs connecting the candidate's specific experience to this role's needs → closing with clear interest and call to action.
- Draw on the analysis results (direct matches, transferable skills, gaps) to make the letter targeted, not generic.
- Lean into accomplishments and specificity — avoid hollow phrases like "passionate about" or "strong communication skills."
- Do not use bullet points. Prose only.
- Tone: confident, direct, professional but not stiff. Matches a senior individual contributor applying to growth-oriented tech or energy companies.
- Do NOT include a date, address block, or signature line — just the letter body starting from the salutation.
- Do NOT include a closing salutation like "Sincerely" or "Best regards" — end after the final sentence of the letter body."""


def _build_system_prompt(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""{_BASE_PROMPT}

CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""
```

Update the `generate_cover_letter` function signature to add `resume_text` and `instructions`, and replace `system=SYSTEM_PROMPT` with `system=_build_system_prompt(resume_text, instructions)`:

```python
def generate_cover_letter(
    request: CoverLetterRequest,
    api_key: str | None = None,
    resume_text: str = "",
    instructions: str = "",
) -> CoverLetterResponse:
    logger.info("Generating cover letter for: %s at %s (length: %s)", request.job_title, request.company, request.length)

    if not api_key:
        settings = get_settings()
        api_key = settings.anthropic_api_key
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = _build_system_prompt(resume_text, instructions)
    word_count_instruction = LENGTH_INSTRUCTIONS[request.length]
    jd_section = f"\nJOB DESCRIPTION:\n{request.job_description}" if request.job_description.strip() else "\nJOB DESCRIPTION: Not available — use the analysis results below."

    user_message = f"""Write a cover letter for this job application.

Length target: {word_count_instruction}

JOB TITLE: {request.job_title}
COMPANY: {request.company}
{jd_section}

ANALYSIS RESULTS:
Direct Matches: {request.direct_matches}
Transferable Skills: {request.transferable}
Gaps: {request.gaps}
Green Flags: {request.green_flags}
Red Flags: {request.red_flags}"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1200,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}]
        )
    except RateLimitError as e:
        logger.error("Claude API rate limit hit: %s", e)
        raise ValueError("Rate limit reached. Please wait a moment and try again.") from e
    except APIConnectionError as e:
        logger.error("Claude API connection error: %s", e)
        raise ValueError("Could not connect to Claude API. Check your internet connection.") from e
    except APIStatusError as e:
        logger.error("Claude API status error %s: %s", e.status_code, e.message)
        raise ValueError(f"Claude API error {e.status_code}: {e.message}") from e

    logger.info(
        "Cover letter response received, stop_reason: %s, tokens: %s",
        message.stop_reason,
        message.usage.input_tokens + message.usage.output_tokens
    )

    return CoverLetterResponse(cover_letter=message.content[0].text.strip())
```

- [ ] **Step 2: Refactor interview_prep.py**

In `backend/app/services/interview_prep.py`, read the full file first, then:

Replace the `SYSTEM_PROMPT` block — remove the `CANDIDATE PROFILE` section and keep only the role description and JSON schema instructions. Add the `_build_system_prompt` builder. Add `resume_text: str = ""` and `instructions: str = ""` parameters to `generate_prep_brief()`. Replace `system=SYSTEM_PROMPT` with `system=_build_system_prompt(resume_text, instructions)`.

The `_build_system_prompt` for interview_prep follows the identical pattern:

```python
def _build_system_prompt(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""{_BASE_PROMPT}

CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""
```

Where `_BASE_PROMPT` is the existing `SYSTEM_PROMPT` content with the `CANDIDATE PROFILE:` block (lines 12–25) removed.

- [ ] **Step 3: Refactor app_questions.py**

Same pattern as above. In `backend/app/services/app_questions.py`:

Remove the `CANDIDATE PROFILE:` block from `SYSTEM_PROMPT` → rename to `_BASE_PROMPT`. Add `_build_system_prompt(resume_text, instructions)`. Add `resume_text: str = ""` and `instructions: str = ""` to `generate_app_answer()`. Replace `system=SYSTEM_PROMPT` → `system=_build_system_prompt(resume_text, instructions)`.

- [ ] **Step 4: Verify all three import cleanly**

```bash
docker compose exec backend python -c "
from app.services.cover_letter import generate_cover_letter
from app.services.interview_prep import generate_prep_brief
from app.services.app_questions import generate_app_answer
print('ok')
"
```

Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/cover_letter.py backend/app/services/interview_prep.py backend/app/services/app_questions.py
git commit -m "feat: refactor cover_letter, interview_prep, app_questions services to accept dynamic profile"
```

---

## Task 10: Refactor reach.py Services

**Files:**
- Modify: `backend/app/services/reach.py`

- [ ] **Step 1: Replace CANDIDATE_CONTEXT with dynamic parameters**

In `backend/app/services/reach.py`, replace the `CANDIDATE_CONTEXT` constant (lines 18–21) and update both functions.

Delete the `CANDIDATE_CONTEXT` constant entirely. Add `resume_text: str = ""` and `instructions: str = ""` to both `cluster_reach_jobs` and `analyze_reach_group`.

In each function, replace `{CANDIDATE_CONTEXT}` in the prompt f-string with a dynamic section:

```python
def _candidate_context(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""
```

Updated `cluster_reach_jobs` signature:

```python
def cluster_reach_jobs(
    jobs: list[ReachJobInput],
    api_key: str,
    resume_text: str = "",
    instructions: str = "",
) -> ClusterResponse:
```

In the prompt f-string, replace `{CANDIDATE_CONTEXT}\n\n` with `{_candidate_context(resume_text, instructions)}\n\n`.

Updated `analyze_reach_group` signature:

```python
def analyze_reach_group(
    group_name: str,
    jobs: list[ReachJobInput],
    api_key: str,
    resume_text: str = "",
    instructions: str = "",
) -> ReachAnalyzeResponse:
```

Same substitution in its prompt f-string.

- [ ] **Step 2: Verify import**

```bash
docker compose exec backend python -c "from app.services.reach import cluster_reach_jobs, analyze_reach_group; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/reach.py
git commit -m "feat: refactor reach services to accept dynamic candidate profile"
```

---

## Task 11: Update analyze.py Route Handlers

**Files:**
- Modify: `backend/app/api/analyze.py`

- [ ] **Step 1: Add the _get_active_profile helper**

After the `_build_analyze_response` function (around line 37), add this helper. Also add the import for `UserProfile` at the top of the file alongside the other model imports:

```python
# Add to imports at top of file:
from app.models.user_profile import UserProfile
```

```python
# Add after _build_analyze_response function:
def _get_active_profile(user_id: int, db: Session) -> UserProfile:
    """Fetch the user's active profile. Raises 400 if none is set."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == user_id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        raise HTTPException(
            status_code=400,
            detail="No active profile found. Please create and activate a profile in the dashboard before analyzing jobs.",
        )
    return profile
```

- [ ] **Step 2: Update the /analyze handler**

In `analyze_job_posting` (around line 59), fetch the profile after the `api_key` line and pass it to `analyze_job()`:

```python
# After: api_key = _require_api_key(current_user)
# Add:
profile = _get_active_profile(current_user.id, db)
```

Then update the `analyze_job(...)` call (around line 103):

```python
result = analyze_job(
    job_title=request.job_title,
    company=request.company,
    job_description=request.job_description,
    listed_salary=request.listed_salary,
    api_key=api_key,
    resume_text=profile.resume_text or "",
    instructions=profile.instructions,
)
```

- [ ] **Step 3: Update the /interview-prep handler**

The `generate_interview_prep` handler (line 232) currently has no `db` parameter. Add it and fetch the profile:

```python
@router.post("/interview-prep", response_model=InterviewPrepResponse)
async def generate_interview_prep(
    request: InterviewPrepRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InterviewPrepResponse:
    logger.info("Generating interview prep for: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.interview_prep import generate_prep_brief
    try:
        return generate_prep_brief(
            request,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during interview prep generation")
        raise HTTPException(status_code=500, detail="Internal server error")
```

- [ ] **Step 4: Update the /cover-letter handler**

Same pattern — add `db`, fetch profile, pass to service:

```python
@router.post("/cover-letter", response_model=CoverLetterResponse)
async def generate_cover_letter_endpoint(
    request: CoverLetterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CoverLetterResponse:
    logger.info("Generating cover letter for: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.cover_letter import generate_cover_letter
    try:
        return generate_cover_letter(
            request,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during cover letter generation")
        raise HTTPException(status_code=500, detail="Internal server error")
```

- [ ] **Step 5: Update the /app-question handler**

```python
@router.post("/app-question", response_model=AppQuestionResponse)
async def generate_app_question_endpoint(
    request: AppQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppQuestionResponse:
    logger.info("Generating app answer for: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.app_questions import generate_app_answer
    try:
        return generate_app_answer(
            request,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during app question generation")
        raise HTTPException(status_code=500, detail="Internal server error")
```

- [ ] **Step 6: Verify the server still starts cleanly**

```bash
docker compose logs backend --tail 10
```

Expected: `Application startup complete.` with no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/analyze.py
git commit -m "feat: inject active profile into analyze, interview-prep, cover-letter, app-question handlers"
```

---

## Task 12: Update reach.py API Handlers

**Files:**
- Modify: `backend/app/api/reach.py`

- [ ] **Step 1: Add DB dependency and profile injection to both handlers**

In `backend/app/api/reach.py`, add these imports at the top:

```python
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_profile import UserProfile
```

Add the `_get_active_profile` helper (identical to analyze.py):

```python
def _get_active_profile(user_id: int, db: Session) -> UserProfile:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == user_id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        raise HTTPException(
            status_code=400,
            detail="No active profile found. Please create and activate a profile in the dashboard.",
        )
    return profile
```

Update `cluster_reach_jobs` handler to add `db` and pass profile:

```python
@router.post("/cluster", response_model=ClusterResponse)
async def cluster_reach_jobs(
    request: ClusterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ClusterResponse:
    if len(request.jobs) < 2:
        raise HTTPException(
            status_code=422,
            detail="At least 2 reach jobs are required for clustering.",
        )
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.reach import cluster_reach_jobs as _cluster
    try:
        return _cluster(
            request.jobs,
            api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during reach clustering")
        raise HTTPException(status_code=500, detail="Internal server error")
```

Update `analyze_reach_group` handler:

```python
@router.post("/analyze", response_model=ReachAnalyzeResponse)
async def analyze_reach_group(
    request: ReachAnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReachAnalyzeResponse:
    if len(request.jobs) == 0:
        raise HTTPException(
            status_code=422,
            detail="At least 1 job is required for analysis.",
        )
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.reach import analyze_reach_group as _analyze
    try:
        return _analyze(
            request.group_name,
            request.jobs,
            api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during reach analysis")
        raise HTTPException(status_code=500, detail="Internal server error")
```

- [ ] **Step 2: Verify server still starts**

```bash
docker compose logs backend --tail 5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/reach.py
git commit -m "feat: inject active profile into reach cluster and analyze handlers"
```

---

## Task 13: Dashboard HTML — Restructure Account Tab

**Files:**
- Modify: `extension/public/dashboard.html`

- [ ] **Step 1: Add CSS for the two-panel Account layout**

In `dashboard.html`, find the `/* Account tab */` CSS comment (around line 595). Replace the entire `/* Account tab */` section (`.account-wrap`, `.account-section`, `.account-section h3`) with:

```css
/* Account tab — two-panel layout */
.account-layout {
  display: flex;
  height: calc(100vh - 56px);
  overflow: hidden;
}

.account-sidebar {
  width: 160px;
  background: #0a0f1a;
  border-right: 1px solid #1e293b;
  padding: 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.account-nav-btn {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  padding: 9px 12px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background 0.15s, color 0.15s;
}

.account-nav-btn:hover {
  background: #1e293b;
  color: #e2e8f0;
}

.account-nav-btn.active {
  background: #1e293b;
  color: #38bdf8;
}

.account-content {
  flex: 1;
  overflow-y: auto;
}

.account-panel {
  display: none;
  max-width: 480px;
  margin: 40px auto;
  padding: 0 24px;
}

.account-panel.active {
  display: block;
}

.account-section {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 10px;
  padding: 24px;
  margin-bottom: 20px;
}

.account-section h3 {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 18px;
  padding-bottom: 10px;
  border-bottom: 1px solid #1e293b;
}

/* Profiles panel */
.profiles-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.profiles-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: #e2e8f0;
  margin: 0;
}

.profile-card {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-card.is-active {
  border-color: #0369a1;
}

.profile-card-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-card-name {
  font-size: 13px;
  font-weight: 500;
  color: #e2e8f0;
}

.active-badge {
  font-size: 10px;
  background: #0c4a6e;
  color: #38bdf8;
  border: 1px solid #0369a1;
  border-radius: 4px;
  padding: 2px 6px;
}

.profile-card-actions {
  display: flex;
  gap: 6px;
}

.btn-profile-action {
  background: #1e293b;
  border: 1px solid #334155;
  color: #94a3b8;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-profile-action:hover {
  background: #334155;
  color: #e2e8f0;
}

.btn-profile-action.activate {
  color: #38bdf8;
  border-color: #0369a1;
}

.btn-profile-action.delete {
  color: #f87171;
  border-color: #7f1d1d;
}

.btn-new-profile {
  background: #0c4a6e;
  border: 1px solid #0369a1;
  color: #38bdf8;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-new-profile:hover {
  background: #075985;
}

/* Profile editor */
.profile-editor {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 10px;
  padding: 20px;
  margin-top: 12px;
}

.profile-editor-label {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  margin-bottom: 5px;
  display: block;
}

.profile-editor-input {
  background: #1e293b;
  border: 1px solid #334155;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  width: 100%;
  margin-bottom: 14px;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.profile-editor-input:focus {
  outline: none;
  border-color: #38bdf8;
}

.profile-editor-textarea {
  background: #1e293b;
  border: 1px solid #334155;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
  width: 100%;
  resize: vertical;
  font-family: inherit;
  margin-bottom: 14px;
  box-sizing: border-box;
  min-height: 120px;
}

.profile-editor-textarea:focus {
  outline: none;
  border-color: #38bdf8;
}

.resume-upload-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.btn-upload-resume {
  background: #1e293b;
  border: 1px dashed #475569;
  color: #94a3b8;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-upload-resume:hover {
  background: #334155;
  color: #e2e8f0;
}

.resume-parse-status {
  font-size: 11px;
  color: #64748b;
}

.profile-editor-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.active-profile-indicator {
  font-size: 11px;
  color: #38bdf8;
  margin-left: 8px;
}
```

- [ ] **Step 2: Restructure the Account tab HTML**

Find the `<div class="tab-panel" id="tab-account">` block (lines 1111–1176) and replace it entirely with:

```html
<div class="tab-panel" id="tab-account">
  <div class="account-layout">

    <nav class="account-sidebar">
      <button class="account-nav-btn active" data-panel="account-details">Account Details</button>
      <button class="account-nav-btn" data-panel="profiles">Profiles</button>
    </nav>

    <div class="account-content">

      <!-- Account Details panel (existing content) -->
      <div class="account-panel active" id="panel-account-details">

        <div class="account-section">
          <h3>Profile</h3>
          <div class="form-row">
            <div class="form-group">
              <label for="acc-first">First Name</label>
              <input type="text" id="acc-first" placeholder="First name" />
            </div>
            <div class="form-group">
              <label for="acc-last">Last Name</label>
              <input type="text" id="acc-last" placeholder="Last name" />
            </div>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label for="acc-email">Email</label>
            <input type="email" id="acc-email" placeholder="your@email.com" />
          </div>
          <div class="form-actions">
            <button class="btn-save" id="btn-save-profile">Save Changes</button>
          </div>
          <div class="account-msg" id="profile-msg"></div>
        </div>

        <div class="account-section">
          <h3>Change Password</h3>
          <div class="form-group" style="margin-bottom:14px">
            <label for="acc-cur-pw">Current Password</label>
            <input type="password" id="acc-cur-pw" placeholder="••••••••" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="acc-new-pw">New Password</label>
              <input type="password" id="acc-new-pw" placeholder="••••••••" />
            </div>
            <div class="form-group">
              <label for="acc-confirm-pw">Confirm</label>
              <input type="password" id="acc-confirm-pw" placeholder="••••••••" />
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-save" id="btn-save-password">Update Password</button>
          </div>
          <div class="account-msg" id="password-msg"></div>
        </div>

        <div class="account-section">
          <h3>Anthropic API Key</h3>
          <div class="form-group" style="margin-bottom:14px">
            <label for="acc-api-key">API Key</label>
            <input type="password" id="acc-api-key" placeholder="sk-ant-..." />
          </div>
          <div class="form-actions">
            <button class="btn-save" id="btn-save-apikey">Save Key</button>
          </div>
          <div class="account-msg" id="apikey-msg"></div>
        </div>

        <div class="account-section">
          <div class="account-meta" id="acc-meta"></div>
          <button class="btn-logout" id="btn-logout" style="margin-top:16px">Sign Out</button>
        </div>

      </div>

      <!-- Profiles panel -->
      <div class="account-panel" id="panel-profiles">

        <div class="profiles-header">
          <h3>Profiles <span class="active-profile-indicator" id="active-profile-label"></span></h3>
          <button class="btn-new-profile" id="btn-new-profile">+ New Profile</button>
        </div>

        <div id="profiles-list"></div>

        <!-- Profile editor (hidden by default) -->
        <div class="profile-editor" id="profile-editor" style="display:none">
          <label class="profile-editor-label" for="profile-name-input">Profile Name</label>
          <input
            class="profile-editor-input"
            type="text"
            id="profile-name-input"
            placeholder="e.g. PM Pivot, Software Engineer"
          />

          <label class="profile-editor-label">Resume (PDF or DOCX)</label>
          <div class="resume-upload-row">
            <button class="btn-upload-resume" id="btn-upload-resume">Upload Resume</button>
            <span class="resume-parse-status" id="resume-parse-status"></span>
          </div>
          <input type="file" id="profile-resume-file" accept=".pdf,.docx" style="display:none" />

          <label class="profile-editor-label" for="profile-resume-text">Resume Text (editable after upload)</label>
          <textarea
            class="profile-editor-textarea"
            id="profile-resume-text"
            placeholder="Upload a PDF or DOCX above, then edit the extracted text here if needed."
            rows="10"
          ></textarea>

          <label class="profile-editor-label" for="profile-instructions">Analysis Instructions</label>
          <textarea
            class="profile-editor-textarea"
            id="profile-instructions"
            rows="4"
          ></textarea>

          <div class="profile-editor-actions">
            <button class="btn-save" id="btn-save-profile-edit">Save Profile</button>
            <button class="btn-profile-action" id="btn-cancel-profile-edit">Cancel</button>
          </div>
          <div class="account-msg" id="profile-editor-msg"></div>
        </div>

      </div>

    </div>
  </div>
</div>
```

- [ ] **Step 3: Build the extension**

```bash
cd extension && pnpm build
```

Expected: `webpack compiled successfully`

- [ ] **Step 4: Reload extension in Chrome and open dashboard — Account tab should show two-panel layout**

Go to `chrome://extensions`, reload the extension, open the dashboard, click Account tab. You should see "Account Details" and "Profiles" in the left sidebar. Clicking each should show/hide the panels (JS not wired yet — clicking won't switch yet, that's Task 14).

- [ ] **Step 5: Commit**

```bash
git add extension/public/dashboard.html
git commit -m "feat: restructure Account tab into two-panel layout with Profiles section"
```

---

## Task 14: Dashboard TypeScript — Profile Management

**Files:**
- Modify: `extension/src/dashboard/index.ts`

- [ ] **Step 1: Add profile type definitions**

Near the top of `extension/src/dashboard/index.ts`, after the existing interface definitions (around line 100), add:

```typescript
interface UserProfile {
  id: number;
  name: string;
  resume_text: string | null;
  instructions: string;
  is_active: boolean;
  created_at: string;
}

const DEFAULT_INSTRUCTIONS =
  "Analyze this job for overall fit based on my resume. " +
  "Highlight skill gaps and strengths, and flag any responsibilities " +
  "or requirements I should pay special attention to.";
```

- [ ] **Step 2: Add profile state variable**

After the existing state variables (`let allJobs`, `let sortCol`, etc.), add:

```typescript
let profiles: UserProfile[] = [];
let editingProfileId: number | null = null; // null = creating new
```

- [ ] **Step 3: Add profile API functions**

After the `getToken` function (around line 1171), add these profile API helpers:

```typescript
async function fetchProfiles(): Promise<UserProfile[]> {
  const token = await getToken();
  if (!token) return [];
  try {
    const r = await fetch(`${process.env.BACKEND_URL}/profiles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    return r.json();
  } catch {
    return [];
  }
}

async function createProfile(name: string, resumeText: string, instructions: string): Promise<UserProfile | null> {
  const token = await getToken();
  if (!token) return null;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, resume_text: resumeText || null, instructions }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "Failed to create profile");
  return r.json();
}

async function updateProfile(id: number, name: string, resumeText: string, instructions: string): Promise<UserProfile | null> {
  const token = await getToken();
  if (!token) return null;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, resume_text: resumeText || null, instructions }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "Failed to update profile");
  return r.json();
}

async function deleteProfile(id: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to delete profile");
}

async function activateProfile(id: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to activate profile");
}

async function parseResume(file: File): Promise<string> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/parse-resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "Failed to parse resume");
  const data: { text: string } = await r.json();
  return data.text;
}
```

- [ ] **Step 4: Add profile rendering function**

After the API helpers, add:

```typescript
function renderProfiles(): void {
  const list = document.getElementById("profiles-list");
  const label = document.getElementById("active-profile-label");
  if (!list) return;

  const active = profiles.find((p) => p.is_active);
  if (label) label.textContent = active ? `— ${active.name}` : "";

  if (profiles.length === 0) {
    list.innerHTML = `<div style="color:#64748b;font-size:13px;padding:12px 0">No profiles yet. Create one to start analyzing jobs.</div>`;
    return;
  }

  list.innerHTML = profiles
    .map(
      (p) => `
    <div class="profile-card${p.is_active ? " is-active" : ""}" data-id="${p.id}">
      <div class="profile-card-left">
        <span class="profile-card-name">${p.name}</span>
        ${p.is_active ? '<span class="active-badge">Active</span>' : ""}
      </div>
      <div class="profile-card-actions">
        ${!p.is_active ? `<button class="btn-profile-action activate" data-action="activate" data-id="${p.id}">Set Active</button>` : ""}
        <button class="btn-profile-action" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="btn-profile-action delete" data-action="delete" data-id="${p.id}">Delete</button>
      </div>
    </div>`
    )
    .join("");
}

function openEditor(profile?: UserProfile): void {
  editingProfileId = profile?.id ?? null;
  const editor = document.getElementById("profile-editor");
  const nameInput = document.getElementById("profile-name-input") as HTMLInputElement;
  const resumeText = document.getElementById("profile-resume-text") as HTMLTextAreaElement;
  const instructions = document.getElementById("profile-instructions") as HTMLTextAreaElement;
  const status = document.getElementById("resume-parse-status");
  const msg = document.getElementById("profile-editor-msg");

  if (!editor || !nameInput || !resumeText || !instructions) return;

  nameInput.value = profile?.name ?? "";
  resumeText.value = profile?.resume_text ?? "";
  instructions.value = profile?.instructions ?? DEFAULT_INSTRUCTIONS;
  if (status) status.textContent = "";
  if (msg) { msg.textContent = ""; msg.className = "account-msg"; }

  editor.style.display = "block";
  nameInput.focus();
}

function closeEditor(): void {
  const editor = document.getElementById("profile-editor");
  if (editor) editor.style.display = "none";
  editingProfileId = null;
}
```

- [ ] **Step 5: Add loadProfilesPanel function and wire event listeners**

After `loadAccountTab` (around line 1205), add:

```typescript
async function loadProfilesPanel(): Promise<void> {
  profiles = await fetchProfiles();
  renderProfiles();
}
```

Find the section of the code where account tab event listeners are wired up (the part that sets up `btn-save-profile`, `btn-save-password`, etc.). This is likely inside a `DOMContentLoaded` listener or an `initAccountTab` function. Add the following profile event wiring in the same place:

```typescript
// Account sidebar navigation
document.querySelectorAll<HTMLButtonElement>(".account-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".account-nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".account-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panelId = `panel-${btn.dataset.panel}`;
    document.getElementById(panelId)?.classList.add("active");
    if (btn.dataset.panel === "profiles") loadProfilesPanel();
  });
});

// New profile button
document.getElementById("btn-new-profile")?.addEventListener("click", () => openEditor());

// Profile list — event delegation for activate / edit / delete
document.getElementById("profiles-list")?.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>("[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === "activate") {
    try {
      await activateProfile(id);
      profiles = await fetchProfiles();
      renderProfiles();
    } catch (err) {
      console.error("Activate failed:", err);
    }
  } else if (action === "edit") {
    const profile = profiles.find((p) => p.id === id);
    if (profile) openEditor(profile);
  } else if (action === "delete") {
    if (!confirm(`Delete profile "${profiles.find((p) => p.id === id)?.name}"?`)) return;
    try {
      await deleteProfile(id);
      profiles = profiles.filter((p) => p.id !== id);
      renderProfiles();
      closeEditor();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }
});

// Resume file upload button
document.getElementById("btn-upload-resume")?.addEventListener("click", () => {
  document.getElementById("profile-resume-file")?.click();
});

document.getElementById("profile-resume-file")?.addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const status = document.getElementById("resume-parse-status");
  const resumeText = document.getElementById("profile-resume-text") as HTMLTextAreaElement;
  if (status) status.textContent = "Extracting text…";
  try {
    const text = await parseResume(file);
    if (resumeText) resumeText.value = text;
    if (status) status.textContent = "Text extracted — review and edit below.";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (status) status.textContent = msg;
  }
  input.value = ""; // reset so same file can be re-uploaded
});

// Save profile editor
document.getElementById("btn-save-profile-edit")?.addEventListener("click", async () => {
  const nameInput = document.getElementById("profile-name-input") as HTMLInputElement;
  const resumeText = document.getElementById("profile-resume-text") as HTMLTextAreaElement;
  const instructions = document.getElementById("profile-instructions") as HTMLTextAreaElement;
  const msg = document.getElementById("profile-editor-msg");

  const name = nameInput?.value.trim();
  if (!name) {
    if (msg) { msg.textContent = "Profile name is required."; msg.className = "account-msg error"; }
    return;
  }

  try {
    if (editingProfileId !== null) {
      await updateProfile(editingProfileId, name, resumeText?.value ?? "", instructions?.value ?? DEFAULT_INSTRUCTIONS);
    } else {
      await createProfile(name, resumeText?.value ?? "", instructions?.value ?? DEFAULT_INSTRUCTIONS);
    }
    profiles = await fetchProfiles();
    renderProfiles();
    closeEditor();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Save failed";
    if (msg) { msg.textContent = errMsg; msg.className = "account-msg error"; }
  }
});

// Cancel profile editor
document.getElementById("btn-cancel-profile-edit")?.addEventListener("click", closeEditor);
```

- [ ] **Step 6: Build and test**

```bash
cd extension && pnpm build
```

Expected: `webpack compiled successfully`

Reload the extension. Open the dashboard → Account tab → Profiles. You should be able to:
- Create a new profile (name + instructions, no resume)
- See it listed
- Set it as active (Active badge appears)
- Edit it, upload a resume file, see extracted text in textarea, save
- Delete a profile

- [ ] **Step 7: Commit**

```bash
git add extension/src/dashboard/index.ts
git commit -m "feat: add profile management UI to dashboard (list, create, edit, activate, delete, resume upload)"
```

---

## Task 15: End-to-End Smoke Test

- [ ] **Step 1: Create a profile via the dashboard**

1. Open the dashboard
2. Go to Account → Profiles
3. Click "+ New Profile"
4. Enter name: "Test Profile"
5. Upload your resume PDF or DOCX
6. Confirm the extracted text looks correct in the textarea
7. Edit instructions if desired
8. Click "Save Profile"
9. Click "Set Active" on the new profile

- [ ] **Step 2: Analyze a job**

Browse to a LinkedIn or Indeed job listing with the extension active. The job should be analyzed using your resume. The fit score and analysis should now reflect your actual resume content rather than the old hardcoded profile.

- [ ] **Step 3: Verify backend received the profile data**

```bash
docker compose logs backend --tail 20
```

Expected: logs showing analysis running, no profile-related errors.

- [ ] **Step 4: Verify a user without a profile gets a clear error**

If you have a second test account with no profile, attempting to analyze a job via the extension should result in an error message referencing "No active profile found."

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: resume profiles — end-to-end smoke test complete"
```
