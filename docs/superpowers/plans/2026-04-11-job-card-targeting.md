# Job Card Targeting & Green Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add green border-glow highlighting to hiring.cafe job cards that match the active user's profile keywords, learned target signals, or target companies, with a new Targeting panel in the Account section and company blocking in the renamed Avoiding panel.

**Architecture:** Parallel targeting system independent from the existing hide-signal infrastructure. Three new DB tables (`profile_target_keywords`, `profile_target_signals`, `companies`), new storage keys (`kw_target_*`, `kw_target_profile_*`, `company_target_*`, `company_block_*`), and a new `applyHCHighlight()` function called from `applyHCCardState` in the content script.

**Tech Stack:** Python/FastAPI/SQLAlchemy/Alembic (backend), TypeScript/Chrome Extensions MV3/Webpack (extension), Anthropic Claude API (resume keyword extraction), PostgreSQL 16.

---

## File Map

**Create:**
- `backend/alembic/versions/a008_add_targeting_tables.py` — migration for 3 new tables
- `backend/app/models/targeting.py` — ORM models: ProfileTargetKeyword, ProfileTargetSignal, Company
- `backend/app/schemas/targeting.py` — Pydantic schemas for all targeting endpoints
- `backend/app/services/keyword_extractor.py` — Claude-based resume keyword extraction
- `backend/app/api/targeting.py` — all targeting/company API routes
- `backend/tests/test_targeting.py` — model, schema, and router tests

**Modify:**
- `backend/app/main.py` — register targeting router
- `extension/src/background/index.ts` — seed targeting data, mine on 80+, mine on apply
- `extension/src/content/index.ts` — `applyHCHighlight()` function + call from `applyHCCardState`
- `extension/public/dashboard.html` — rename Avoiding panel, add Targeting panel HTML
- `extension/src/dashboard/index.ts` — Blocked Companies in Avoiding, `loadTargetingPanel()`

---

## Task 1: DB Migration — Three Targeting Tables

**Files:**
- Create: `backend/alembic/versions/a008_add_targeting_tables.py`

- [ ] **Step 1: Write the migration file**

```python
# backend/alembic/versions/a008_add_targeting_tables.py
"""add targeting tables

Revision ID: a008_add_targeting_tables
Revises: a007_add_keyword_tables
Create Date: 2026-04-11
"""
from alembic import op
import sqlalchemy as sa

revision = "a008_add_targeting_tables"
down_revision = "a007_add_keyword_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profile_target_keywords",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("keyword", sa.String(200), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),  # 'resume' | 'learned'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("profile_id", "keyword", name="uq_target_kw_profile_keyword"),
    )
    op.create_index(
        "ix_profile_target_keywords_profile_id",
        "profile_target_keywords",
        ["profile_id"],
    )

    op.create_table(
        "profile_target_signals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ngram", sa.String(200), nullable=False),
        sa.Column("target_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("show_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "profile_id", "ngram", name="uq_target_signal_profile_ngram"
        ),
    )
    op.create_index(
        "ix_profile_target_signals_profile_id",
        "profile_target_signals",
        ["profile_id"],
    )

    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=True,  # NULL = global block
        ),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("list_type", sa.String(10), nullable=False),  # 'target' | 'block'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # Partial unique indexes handle NULL profile_id correctly
    op.create_index(
        "ix_companies_profile_id", "companies", ["profile_id"]
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_block_name "
        "ON companies (name, list_type) WHERE profile_id IS NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_target_profile_name "
        "ON companies (profile_id, name, list_type) WHERE profile_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("uq_companies_target_profile_name", table_name="companies")
    op.drop_index("uq_companies_block_name", table_name="companies")
    op.drop_index("ix_companies_profile_id", table_name="companies")
    op.drop_table("companies")
    op.drop_index(
        "ix_profile_target_signals_profile_id", table_name="profile_target_signals"
    )
    op.drop_table("profile_target_signals")
    op.drop_index(
        "ix_profile_target_keywords_profile_id", table_name="profile_target_keywords"
    )
    op.drop_table("profile_target_keywords")
```

- [ ] **Step 2: Run the migration**

```bash
cd backend
alembic upgrade head
```

Expected output ends with: `Running upgrade a007_add_keyword_tables -> a008_add_targeting_tables`

- [ ] **Step 3: Verify tables exist**

```bash
docker exec -it jobscout-db-1 psql -U postgres -d jobscout -c "\dt profile_target* companies"
```

Expected: Lists `profile_target_keywords`, `profile_target_signals`, `companies`.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/a008_add_targeting_tables.py
git commit -m "feat: add targeting tables migration"
```

---

## Task 2: ORM Models

**Files:**
- Create: `backend/app/models/targeting.py`
- Test: `backend/tests/test_targeting.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_targeting.py
from app.models.targeting import ProfileTargetKeyword, ProfileTargetSignal, Company


def test_profile_target_keyword_columns():
    cols = {c.key for c in ProfileTargetKeyword.__table__.columns}
    assert cols == {"id", "profile_id", "keyword", "source", "created_at"}


def test_profile_target_signal_columns():
    cols = {c.key for c in ProfileTargetSignal.__table__.columns}
    assert cols == {"id", "profile_id", "ngram", "target_count", "show_count", "updated_at"}


def test_company_columns():
    cols = {c.key for c in Company.__table__.columns}
    assert cols == {"id", "profile_id", "name", "list_type", "created_at"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pytest tests/test_targeting.py::test_profile_target_keyword_columns -v
```

Expected: `FAILED` — `ModuleNotFoundError: No module named 'app.models.targeting'`

- [ ] **Step 3: Write the models**

```python
# backend/app/models/targeting.py
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class ProfileTargetKeyword(Base):
    __tablename__ = "profile_target_keywords"
    __table_args__ = (
        UniqueConstraint("profile_id", "keyword", name="uq_target_kw_profile_keyword"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    keyword: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # 'resume' | 'learned'
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class ProfileTargetSignal(Base):
    __tablename__ = "profile_target_signals"
    __table_args__ = (
        UniqueConstraint("profile_id", "ngram", name="uq_target_signal_profile_ngram"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ngram: Mapped[str] = mapped_column(String(200), nullable=False)
    target_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    show_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    list_type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'target' | 'block'
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
pytest tests/test_targeting.py::test_profile_target_keyword_columns tests/test_targeting.py::test_profile_target_signal_columns tests/test_targeting.py::test_company_columns -v
```

Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/targeting.py backend/tests/test_targeting.py
git commit -m "feat: add targeting ORM models"
```

---

## Task 3: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/targeting.py`
- Test: `backend/tests/test_targeting.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_targeting.py`:

```python
from app.schemas.targeting import (
    TargetKeywordItem,
    TargetKeywordAddRequest,
    TargetSignalItem,
    TargetSignalUpsertRequest,
    CompanyItem,
    CompanyAddRequest,
    CompaniesResponse,
)


def test_target_keyword_item():
    item = TargetKeywordItem(id=1, keyword="python", source="resume")
    assert item.keyword == "python"
    assert item.source == "resume"


def test_target_signal_item():
    item = TargetSignalItem(ngram="data science", target_count=3, show_count=1)
    assert item.ngram == "data science"
    assert item.target_count == 3


def test_company_item():
    item = CompanyItem(id=1, name="Acme Corp", list_type="block", profile_id=None)
    assert item.name == "Acme Corp"
    assert item.list_type == "block"


def test_companies_response():
    r = CompaniesResponse(
        targets=[CompanyItem(id=1, name="Google", list_type="target", profile_id=5)],
        blocks=[CompanyItem(id=2, name="Spam Co", list_type="block", profile_id=None)],
    )
    assert len(r.targets) == 1
    assert len(r.blocks) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
pytest tests/test_targeting.py -k "target_keyword_item or target_signal_item or company_item or companies_response" -v
```

Expected: `FAILED` — `ModuleNotFoundError: No module named 'app.schemas.targeting'`

- [ ] **Step 3: Write the schemas**

```python
# backend/app/schemas/targeting.py
from typing import List, Optional
from pydantic import BaseModel, Field


class TargetKeywordItem(BaseModel):
    id: int
    keyword: str
    source: str  # 'resume' | 'learned'


class TargetKeywordAddRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=200)
    source: str = Field(default="learned")


class TargetSignalItem(BaseModel):
    ngram: str = Field(..., min_length=1, max_length=200)
    target_count: int = Field(..., ge=0)
    show_count: int = Field(..., ge=0)


class TargetSignalUpsertRequest(BaseModel):
    signals: List[TargetSignalItem]


class CompanyItem(BaseModel):
    id: int
    name: str
    list_type: str
    profile_id: Optional[int]


class CompanyAddRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)
    profile_id: Optional[int] = None  # None = global block


class CompaniesResponse(BaseModel):
    targets: List[CompanyItem]
    blocks: List[CompanyItem]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
pytest tests/test_targeting.py -k "target_keyword_item or target_signal_item or company_item or companies_response" -v
```

Expected: 4 PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/targeting.py backend/tests/test_targeting.py
git commit -m "feat: add targeting Pydantic schemas"
```

---

## Task 4: Resume Keyword Extraction Service

**Files:**
- Create: `backend/app/services/keyword_extractor.py`
- Test: `backend/tests/test_targeting.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_targeting.py`:

```python
from app.services.keyword_extractor import extract_keywords_from_resume


def test_extract_keywords_returns_list_for_empty_resume():
    result = extract_keywords_from_resume(None)
    assert result == []


def test_extract_keywords_returns_list_for_blank_resume():
    result = extract_keywords_from_resume("   ")
    assert result == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
pytest tests/test_targeting.py -k "extract_keywords" -v
```

Expected: `FAILED` — `ModuleNotFoundError`

- [ ] **Step 3: Write the service**

```python
# backend/app/services/keyword_extractor.py
import json
import logging
from typing import Optional
import anthropic
from app.config import get_settings

logger = logging.getLogger(__name__)

_EXTRACTION_PROMPT = """Extract technical skills, tools, technologies, programming languages, frameworks, domain keywords, and relevant professional skills from this resume text.

Return ONLY a JSON array of strings. No explanation, no markdown, no code blocks. Example:
["Python", "FastAPI", "PostgreSQL", "machine learning", "REST APIs"]

Resume text:
{resume_text}"""


def extract_keywords_from_resume(resume_text: Optional[str]) -> list[str]:
    """Call Claude to extract skills/keywords from resume_text.
    Returns empty list if resume_text is None or blank.
    """
    if not resume_text or not resume_text.strip():
        return []

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": _EXTRACTION_PROMPT.format(resume_text=resume_text.strip()),
                }
            ],
        )
        raw = message.content[0].text.strip()
        # Strip markdown code blocks if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        keywords = json.loads(raw.strip())
        if not isinstance(keywords, list):
            return []
        return [str(k).strip() for k in keywords if str(k).strip()]
    except Exception as e:
        logger.error("Keyword extraction failed: %s", e)
        return []
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
pytest tests/test_targeting.py -k "extract_keywords" -v
```

Expected: 2 PASSED (these tests don't call Claude — they test the early-return paths)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/keyword_extractor.py backend/tests/test_targeting.py
git commit -m "feat: add resume keyword extraction service"
```

---

## Task 5: Targeting API Routes

**Files:**
- Create: `backend/app/api/targeting.py`
- Test: `backend/tests/test_targeting.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_targeting.py`:

```python
import ast
import pathlib


def test_targeting_router_functions_exist():
    src = pathlib.Path("app/api/targeting.py").read_text()
    tree = ast.parse(src)
    names = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "get_target_keywords" in names
    assert "add_target_keyword" in names
    assert "delete_target_keyword" in names
    assert "reset_target_keywords" in names
    assert "get_target_signals" in names
    assert "upsert_target_signals" in names
    assert "get_companies" in names
    assert "add_target_company" in names
    assert "delete_target_company" in names
    assert "add_block_company" in names
    assert "delete_block_company" in names
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pytest tests/test_targeting.py::test_targeting_router_functions_exist -v
```

Expected: `FAILED` — `ModuleNotFoundError`

- [ ] **Step 3: Write the API routes**

```python
# backend/app/api/targeting.py
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.user_profile import UserProfile
from app.models.targeting import ProfileTargetKeyword, ProfileTargetSignal, Company
from app.schemas.targeting import (
    TargetKeywordItem,
    TargetKeywordAddRequest,
    TargetSignalItem,
    TargetSignalUpsertRequest,
    CompanyItem,
    CompanyAddRequest,
    CompaniesResponse,
)
from app.services.keyword_extractor import extract_keywords_from_resume

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_owned_profile(profile_id: int, current_user: User, db: Session) -> UserProfile:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


# ── Target Keywords ──────────────────────────────────────────────────────────

@router.get("/profiles/{profile_id}/target-keywords", response_model=list[TargetKeywordItem])
def get_target_keywords(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TargetKeywordItem]:
    profile = _get_owned_profile(profile_id, current_user, db)
    rows = (
        db.query(ProfileTargetKeyword)
        .filter(ProfileTargetKeyword.profile_id == profile_id)
        .order_by(ProfileTargetKeyword.created_at)
        .all()
    )
    # Lazy extraction: if no resume keywords exist yet, extract from resume
    has_resume_keywords = any(r.source == "resume" for r in rows)
    if not has_resume_keywords and profile.resume_text:
        keywords = extract_keywords_from_resume(profile.resume_text)
        for kw in keywords:
            kw_lower = kw.lower().strip()
            if not kw_lower:
                continue
            existing = (
                db.query(ProfileTargetKeyword)
                .filter(
                    ProfileTargetKeyword.profile_id == profile_id,
                    ProfileTargetKeyword.keyword == kw_lower,
                )
                .first()
            )
            if not existing:
                db.add(ProfileTargetKeyword(
                    profile_id=profile_id,
                    keyword=kw_lower,
                    source="resume",
                ))
        db.commit()
        rows = (
            db.query(ProfileTargetKeyword)
            .filter(ProfileTargetKeyword.profile_id == profile_id)
            .order_by(ProfileTargetKeyword.created_at)
            .all()
        )
    return [TargetKeywordItem(id=r.id, keyword=r.keyword, source=r.source) for r in rows]


@router.post("/profiles/{profile_id}/target-keywords", status_code=201)
def add_target_keyword(
    profile_id: int,
    body: TargetKeywordAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _get_owned_profile(profile_id, current_user, db)
    kw = body.keyword.lower().strip()
    existing = (
        db.query(ProfileTargetKeyword)
        .filter(ProfileTargetKeyword.profile_id == profile_id, ProfileTargetKeyword.keyword == kw)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Keyword already exists")
    db.add(ProfileTargetKeyword(profile_id=profile_id, keyword=kw, source=body.source))
    db.commit()
    logger.info("Added target keyword '%s' for profile %d", kw, profile_id)
    return {"keyword": kw}


@router.delete("/profiles/{profile_id}/target-keywords/{keyword}", status_code=204)
def delete_target_keyword(
    profile_id: int,
    keyword: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _get_owned_profile(profile_id, current_user, db)
    row = (
        db.query(ProfileTargetKeyword)
        .filter(
            ProfileTargetKeyword.profile_id == profile_id,
            ProfileTargetKeyword.keyword == keyword.lower().strip(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Keyword not found")
    db.delete(row)
    db.commit()


@router.post("/profiles/{profile_id}/target-keywords/reset", status_code=200)
def reset_target_keywords(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Re-extract resume keywords, replacing all source='resume' entries."""
    profile = _get_owned_profile(profile_id, current_user, db)
    # Delete existing resume-sourced keywords
    db.query(ProfileTargetKeyword).filter(
        ProfileTargetKeyword.profile_id == profile_id,
        ProfileTargetKeyword.source == "resume",
    ).delete()
    db.commit()
    keywords = extract_keywords_from_resume(profile.resume_text)
    for kw in keywords:
        kw_lower = kw.lower().strip()
        if not kw_lower:
            continue
        existing = (
            db.query(ProfileTargetKeyword)
            .filter(
                ProfileTargetKeyword.profile_id == profile_id,
                ProfileTargetKeyword.keyword == kw_lower,
            )
            .first()
        )
        if not existing:
            db.add(ProfileTargetKeyword(profile_id=profile_id, keyword=kw_lower, source="resume"))
    db.commit()
    count = db.query(ProfileTargetKeyword).filter(
        ProfileTargetKeyword.profile_id == profile_id,
        ProfileTargetKeyword.source == "resume",
    ).count()
    logger.info("Reset resume keywords for profile %d: %d keywords", profile_id, count)
    return {"reset": count}


# ── Target Signals ────────────────────────────────────────────────────────────

@router.get("/keywords/target-signals/{profile_id}", response_model=list[TargetSignalItem])
def get_target_signals(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TargetSignalItem]:
    _get_owned_profile(profile_id, current_user, db)
    rows = (
        db.query(ProfileTargetSignal)
        .filter(ProfileTargetSignal.profile_id == profile_id)
        .all()
    )
    return [
        TargetSignalItem(ngram=r.ngram, target_count=r.target_count, show_count=r.show_count)
        for r in rows
    ]


@router.put("/keywords/target-signals/{profile_id}", status_code=204)
def upsert_target_signals(
    profile_id: int,
    body: TargetSignalUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _get_owned_profile(profile_id, current_user, db)
    now = datetime.now(timezone.utc)
    for item in body.signals:
        existing = (
            db.query(ProfileTargetSignal)
            .filter(
                ProfileTargetSignal.profile_id == profile_id,
                ProfileTargetSignal.ngram == item.ngram,
            )
            .first()
        )
        if existing:
            existing.target_count = item.target_count
            existing.show_count = item.show_count
            existing.updated_at = now
        else:
            db.add(ProfileTargetSignal(
                profile_id=profile_id,
                ngram=item.ngram,
                target_count=item.target_count,
                show_count=item.show_count,
                updated_at=now,
            ))
    db.commit()
    logger.info("Upserted %d target signals for profile %d", len(body.signals), profile_id)


# ── Companies ─────────────────────────────────────────────────────────────────

@router.get("/companies", response_model=CompaniesResponse)
def get_companies(
    profile_id: Optional[int] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CompaniesResponse:
    """Return target companies for the given profile_id and all global block companies."""
    targets = []
    if profile_id:
        _get_owned_profile(profile_id, current_user, db)
        target_rows = (
            db.query(Company)
            .filter(Company.profile_id == profile_id, Company.list_type == "target")
            .order_by(Company.created_at)
            .all()
        )
        targets = [
            CompanyItem(id=r.id, name=r.name, list_type=r.list_type, profile_id=r.profile_id)
            for r in target_rows
        ]
    block_rows = (
        db.query(Company)
        .filter(Company.profile_id.is_(None), Company.list_type == "block")
        .order_by(Company.created_at)
        .all()
    )
    blocks = [
        CompanyItem(id=r.id, name=r.name, list_type=r.list_type, profile_id=r.profile_id)
        for r in block_rows
    ]
    return CompaniesResponse(targets=targets, blocks=blocks)


@router.post("/companies/target", status_code=201)
def add_target_company(
    body: CompanyAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not body.profile_id:
        raise HTTPException(status_code=400, detail="profile_id required for target companies")
    _get_owned_profile(body.profile_id, current_user, db)
    name = body.name.strip()
    existing = (
        db.query(Company)
        .filter(
            Company.profile_id == body.profile_id,
            Company.name == name,
            Company.list_type == "target",
        )
        .first()
    )
    if existing:
        return {"id": existing.id, "name": name}
    entry = Company(profile_id=body.profile_id, name=name, list_type="target")
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "name": name}


@router.delete("/companies/target/{company_id}", status_code=204)
def delete_target_company(
    company_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = db.query(Company).filter(Company.id == company_id, Company.list_type == "target").first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    if row.profile_id:
        _get_owned_profile(row.profile_id, current_user, db)
    db.delete(row)
    db.commit()


@router.post("/companies/block", status_code=201)
def add_block_company(
    body: CompanyAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    name = body.name.strip()
    existing = (
        db.query(Company)
        .filter(Company.profile_id.is_(None), Company.name == name, Company.list_type == "block")
        .first()
    )
    if existing:
        return {"id": existing.id, "name": name}
    entry = Company(profile_id=None, name=name, list_type="block")
    db.add(entry)
    db.commit()
    db.refresh(entry)
    logger.info("Added blocked company '%s'", name)
    return {"id": entry.id, "name": name}


@router.delete("/companies/block/{company_id}", status_code=204)
def delete_block_company(
    company_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = (
        db.query(Company)
        .filter(Company.id == company_id, Company.list_type == "block", Company.profile_id.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(row)
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
pytest tests/test_targeting.py::test_targeting_router_functions_exist -v
```

Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/targeting.py backend/tests/test_targeting.py
git commit -m "feat: add targeting API routes"
```

---

## Task 6: Register Targeting Router in main.py

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_targeting.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_targeting.py`:

```python
def test_targeting_router_registered_in_main():
    src = pathlib.Path("app/main.py").read_text()
    assert "targeting_router" in src or "targeting" in src
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pytest tests/test_targeting.py::test_targeting_router_registered_in_main -v
```

Expected: `FAILED`

- [ ] **Step 3: Register the router in main.py**

In `backend/app/main.py`, add after the `keywords_router` import and registration:

```python
# Add to imports at top of file:
from app.api.targeting import router as targeting_router

# Add after the keywords_router include:
app.include_router(targeting_router, prefix="/api/v1", tags=["targeting"])
```

The import block should look like:
```python
from app.api.analyze import router as analyze_router
from app.api.auth import router as auth_router
from app.api.reach import router as reach_router
from app.api.profiles import router as profiles_router
from app.api.keywords import router as keywords_router
from app.api.targeting import router as targeting_router
```

And the router registration block:
```python
app.include_router(analyze_router, prefix="/api/v1", tags=["analysis"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(reach_router, prefix="/api/v1/reach", tags=["reach"])
app.include_router(profiles_router, prefix="/api/v1/profiles", tags=["profiles"])
app.include_router(keywords_router, prefix="/api/v1/keywords", tags=["keywords"])
app.include_router(targeting_router, prefix="/api/v1", tags=["targeting"])
```

- [ ] **Step 4: Run all targeting tests to verify they pass**

```bash
cd backend
pytest tests/test_targeting.py -v
```

Expected: All PASSED

- [ ] **Step 5: Start the backend and verify routes appear in docs**

```bash
cd backend
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs and confirm you see routes under the `targeting` tag:
- `GET /api/v1/profiles/{profile_id}/target-keywords`
- `POST /api/v1/profiles/{profile_id}/target-keywords`
- `DELETE /api/v1/profiles/{profile_id}/target-keywords/{keyword}`
- `POST /api/v1/profiles/{profile_id}/target-keywords/reset`
- `GET /api/v1/keywords/target-signals/{profile_id}`
- `PUT /api/v1/keywords/target-signals/{profile_id}`
- `GET /api/v1/companies`
- `POST /api/v1/companies/target`
- `DELETE /api/v1/companies/target/{company_id}`
- `POST /api/v1/companies/block`
- `DELETE /api/v1/companies/block/{company_id}`

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_targeting.py
git commit -m "feat: register targeting router in main"
```

---

## Task 7: Extension Background — Seed Targeting Data on Login & Profile Switch

> **Dependency:** Complete Task 8 before Step 3 of this task. Step 3 adds a call to `flushTargetSignals()` which is defined in Task 8. Steps 1–2 of this task are independent and can be done first.

**Files:**
- Modify: `extension/src/background/index.ts`

This task adds three new functions (`seedTargetKeywords`, `seedTargetSignals`, `seedCompanies`) and calls them from `seedKeywordData()` and the `SWITCH_PROFILE` handler.

- [ ] **Step 1: Add `seedTargetKeywords` after `seedSignals` in background/index.ts**

Find the line `async function seedKeywordData(): Promise<void> {` (around line 64) and add the three new seed functions before it:

```typescript
async function seedTargetKeywords(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/profiles/${profileId}/target-keywords`, { headers });
    if (!r.ok) return;
    const keywords: Array<{ id: number; keyword: string; source: string }> = await r.json();
    const updates: Record<string, boolean> = {};
    for (const kw of keywords) {
      updates[`kw_target_profile_${kw.keyword}`] = true;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed target keywords:", err);
  }
}

async function seedTargetSignals(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/keywords/target-signals/${profileId}`, { headers });
    if (!r.ok) return;
    const signals: Array<{ ngram: string; target_count: number; show_count: number }> = await r.json();
    const updates: Record<string, { targetCount: number; showCount: number }> = {};
    for (const sig of signals) {
      updates[`kw_target_${sig.ngram}`] = { targetCount: sig.target_count, showCount: sig.show_count };
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed target signals:", err);
  }
}

async function seedCompanies(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/companies?profile_id=${profileId}`, { headers });
    if (!r.ok) return;
    const data: {
      targets: Array<{ id: number; name: string }>;
      blocks: Array<{ id: number; name: string }>;
    } = await r.json();
    const updates: Record<string, boolean> = {};
    for (const c of data.targets) {
      updates[`company_target_${c.name.toLowerCase()}`] = true;
    }
    for (const c of data.blocks) {
      updates[`company_block_${c.name.toLowerCase()}`] = true;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed companies:", err);
  }
}
```

- [ ] **Step 2: Update `seedKeywordData` to call the new seed functions**

Find `seedKeywordData` (around line 64) and update it:

```typescript
async function seedKeywordData(): Promise<void> {
  await seedBlocklist();
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/profiles/active`, { headers });
    if (!r.ok) return;
    const profile: { id: number; name: string } | null = await r.json();
    if (!profile) return;
    chrome.storage.local.set({ active_profile_id: profile.id, active_profile_name: profile.name });
    await seedSignals(profile.id);
    await seedTargetKeywords(profile.id);
    await seedTargetSignals(profile.id);
    await seedCompanies(profile.id);
  } catch (err) {
    console.error("[JobScout BG] Failed to seed keyword data:", err);
  }
}
```

- [ ] **Step 3: Update the `SWITCH_PROFILE` handler to clear and re-seed targeting keys**

Find the `SWITCH_PROFILE` handler (around line 406). Replace the key-clearing section so it also clears `kw_target_*`, `kw_target_profile_*`, and `company_target_*` keys (leave `company_block_*` — those are global):

```typescript
if (message.type === "SWITCH_PROFILE") {
  if (syncTimer !== null) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  flushSignals().then(async () => {
    await flushTargetSignals();
    chrome.storage.local.get(null, async (items) => {
      const keysToRemove = Object.keys(items).filter(
        (k) =>
          k.startsWith("kw_hide_") ||
          k.startsWith("kw_show_") ||
          k.startsWith("kw_target_") ||
          k.startsWith("company_target_"),
      );
      if (keysToRemove.length > 0) {
        await new Promise<void>((resolve) =>
          chrome.storage.local.remove(keysToRemove, resolve),
        );
      }

      chrome.storage.local.set({
        active_profile_id: message.profileId,
        active_profile_name: message.profileName ?? null,
      });
      await seedSignals(message.profileId as number);
      await seedTargetKeywords(message.profileId as number);
      await seedTargetSignals(message.profileId as number);
      await seedCompanies(message.profileId as number);

      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "PROFILE_SWITCHED" }).catch(() => {});
          }
        });
      });

      sendResponse({ success: true });
    });
  });
  return true;
}
```

- [ ] **Step 4: Build and verify no TypeScript errors**

```bash
cd extension
pnpm build
```

Expected: Build completes with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat: seed targeting data on login and profile switch"
```

---

## Task 8: Extension Background — Target Signal Flush

**Files:**
- Modify: `extension/src/background/index.ts`

This task adds the debounced flush for `kw_target_*` signals, mirroring the existing `flushSignals` for hide signals.

- [ ] **Step 1: Add dirty target ngrams tracking and `flushTargetSignals` after `flushSignals`**

Find the line `// Watch for kw_* changes written by the content script` (around line 120) and add this before it:

```typescript
// ===== TARGET SIGNAL SYNC =====

const dirtyTargetNgrams = new Set<string>();
let targetSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTargetSignalSync(): void {
  if (targetSyncTimer !== null) clearTimeout(targetSyncTimer);
  targetSyncTimer = setTimeout(() => {
    targetSyncTimer = null;
    flushTargetSignals();
  }, SYNC_DEBOUNCE_MS);
}

async function flushTargetSignals(): Promise<void> {
  if (dirtyTargetNgrams.size === 0) return;
  const toFlush = Array.from(dirtyTargetNgrams);
  dirtyTargetNgrams.clear();

  const targetKeys = toFlush.map((ng) => `kw_target_${ng}`);

  chrome.storage.local.get(["active_profile_id", ...targetKeys], async (data) => {
    const profileId = data["active_profile_id"] as number | undefined;
    if (!profileId) return;

    const payload = toFlush.map((ng) => ({
      ngram: ng,
      target_count: (data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined)?.targetCount ?? 0,
      show_count: (data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined)?.showCount ?? 0,
    }));

    const headers = await getAuthHeaders();
    fetch(`${BACKEND_URL}/keywords/target-signals/${profileId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ signals: payload }),
    }).catch((err) => console.error("[JobScout BG] Target signal sync failed:", err));
  });
}
```

- [ ] **Step 2: Watch `kw_target_*` changes in the storage listener**

Find the `chrome.storage.onChanged.addListener` block (around line 120) and update it:

```typescript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of Object.keys(changes)) {
    if (key.startsWith("kw_hide_") || key.startsWith("kw_show_")) {
      dirtyNgrams.add(key.replace(/^kw_(?:hide|show)_/, ""));
    }
    if (key.startsWith("kw_target_") && !key.startsWith("kw_target_profile_")) {
      dirtyTargetNgrams.add(key.replace(/^kw_target_/, ""));
    }
  }
  if (dirtyNgrams.size > 0) scheduleSyncSignals();
  if (dirtyTargetNgrams.size > 0) scheduleTargetSignalSync();
});
```

- [ ] **Step 3: Flush target signals on suspend**

Find `chrome.runtime.onSuspend.addListener` and update:

```typescript
chrome.runtime.onSuspend.addListener(() => {
  if (syncTimer !== null) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (targetSyncTimer !== null) {
    clearTimeout(targetSyncTimer);
    targetSyncTimer = null;
  }
  flushSignals();
  flushTargetSignals();
});
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd extension
pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat: add target signal flush with debounced sync"
```

---

## Task 9: Extension Background — Mine Signals on Analysis and Apply

**Files:**
- Modify: `extension/src/background/index.ts`

- [ ] **Step 1: Add a `mineTargetSignalsFromAnalysis` helper after `flushTargetSignals`**

```typescript
function mineTargetSignalsFromAnalysis(
  greenFlags: string[],
  company: string,
  profileId: number,
): void {
  if (!profileId) return;

  // Extract ngrams from each green_flag string
  const allNgrams: string[] = [];
  for (const flag of greenFlags) {
    const words = flag
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    allNgrams.push(...words);
    for (let i = 0; i < words.length - 1; i++) {
      allNgrams.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  if (allNgrams.length === 0 && !company) return;

  const targetKeys = allNgrams.map((ng) => `kw_target_${ng}`);
  chrome.storage.local.get(targetKeys, (data) => {
    const updates: Record<string, { targetCount: number; showCount: number }> = {};
    for (const ng of allNgrams) {
      const existing = (data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined) ?? { targetCount: 0, showCount: 0 };
      updates[`kw_target_${ng}`] = { targetCount: existing.targetCount + 1, showCount: existing.showCount };
    }
    chrome.storage.local.set(updates);
  });

  // Store target company (idempotent)
  if (company) {
    const key = `company_target_${company.toLowerCase()}`;
    chrome.storage.local.set({ [key]: true });
    // Persist to backend
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/companies/target`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: company, profile_id: profileId }),
      }).catch(() => {});
    });
  }
}
```

- [ ] **Step 2: Add `mineTargetSignalsFromTitle` helper**

```typescript
function mineTargetSignalsFromTitle(title: string): void {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const ngrams: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    ngrams.push(`${words[i]} ${words[i + 1]}`);
  }

  if (ngrams.length === 0) return;

  const targetKeys = ngrams.map((ng) => `kw_target_${ng}`);
  chrome.storage.local.get(targetKeys, (data) => {
    const updates: Record<string, { targetCount: number; showCount: number }> = {};
    for (const ng of ngrams) {
      const existing = (data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined) ?? { targetCount: 0, showCount: 0 };
      updates[`kw_target_${ng}`] = { targetCount: existing.targetCount + 1, showCount: existing.showCount };
    }
    chrome.storage.local.set(updates);
  });
}
```

- [ ] **Step 3: Call `mineTargetSignalsFromAnalysis` in the ANALYZE_JOB handler**

Find the `fetchAnalysis(message.payload).then(async (result) => {` block (around line 196). After the line `console.log("[JobScout BG] Analysis complete, fit_score:", result.fit_score);`, add:

```typescript
// Mine target signals from high-scoring analyses
if (result.fit_score >= 80) {
  chrome.storage.local.get("active_profile_id", (profileData) => {
    const profileId = profileData["active_profile_id"] as number | undefined;
    if (profileId) {
      mineTargetSignalsFromAnalysis(
        result.green_flags ?? [],
        message.payload.company ?? "",
        profileId,
      );
    }
  });
}
```

- [ ] **Step 4: Call `mineTargetSignalsFromTitle` in the UPDATE_JOB_STATUS handler when status is "applied"**

Find the `UPDATE_JOB_STATUS` handler (around line 377). After the lines that set storage and before the backend sync, add:

```typescript
// Mine title ngrams when user marks a job as applied
if (message.status === "applied" && message.jobId) {
  chrome.storage.local.get(`score_jobid_${message.jobId}`, (data) => {
    const stored = data[`score_jobid_${message.jobId}`] as { jobTitle?: string } | undefined;
    if (stored?.jobTitle) {
      mineTargetSignalsFromTitle(stored.jobTitle);
    }
  });
}
```

- [ ] **Step 5: Build and verify no errors**

```bash
cd extension
pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat: mine target signals from high-score analyses and apply clicks"
```

---

## Task 10: Extension Content Script — applyHCHighlight

**Files:**
- Modify: `extension/src/content/index.ts`

- [ ] **Step 1: Add `applyHCHighlight` function after `undimCard`**

Find `function undimCard(card: Element): void {` (around line 268) and add the new function after it:

```typescript
function applyHCHighlight(card: Element, title: string, company: string): void {
  // Don't add highlight if card is already dimmed
  if ((card as HTMLElement).style.opacity === "0.35") return;

  const titleLower = title.toLowerCase();
  const companyLower = company.toLowerCase();

  // Collect all keys needed for a single storage read
  const titleWords = titleLower
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const titleNgrams: string[] = [...titleWords];
  for (let i = 0; i < titleWords.length - 1; i++) {
    titleNgrams.push(`${titleWords[i]} ${titleWords[i + 1]}`);
  }

  const targetSignalKeys = titleNgrams.map((ng) => `kw_target_${ng}`);
  const profileKwKeys = titleNgrams.map((ng) => `kw_target_profile_${ng}`);
  const companyTargetKey = `company_target_${companyLower}`;
  const companyBlockKey = `company_block_${companyLower}`;

  chrome.storage.local.get(
    [...targetSignalKeys, ...profileKwKeys, companyTargetKey, companyBlockKey],
    (data) => {
      // Re-check dim state after async read — card may have been dimmed since we started
      if ((card as HTMLElement).style.opacity === "0.35") return;

      // Company block → already handled by dim, but double-check
      if (data[companyBlockKey]) return;

      let shouldHighlight = false;

      // Company target match
      if (data[companyTargetKey]) {
        shouldHighlight = true;
      }

      // Profile keyword match (always-on)
      if (!shouldHighlight) {
        for (const key of profileKwKeys) {
          if (data[key]) { shouldHighlight = true; break; }
        }
      }

      // Learned target signal match (threshold: count >= 3, confidence >= 70%)
      if (!shouldHighlight) {
        for (const ng of titleNgrams) {
          const entry = data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined;
          if (!entry) continue;
          const total = entry.targetCount + entry.showCount;
          const confidence = total > 0 ? entry.targetCount / total : 0;
          if (entry.targetCount >= 3 && confidence >= 0.7) {
            shouldHighlight = true;
            break;
          }
        }
      }

      if (shouldHighlight) {
        (card as HTMLElement).style.boxShadow = "0 0 0 2px #4ade80";
        (card as HTMLElement).style.borderRadius = "inherit";
        card.setAttribute("data-jobscout-highlighted", "true");
      } else {
        removeHCHighlight(card);
      }
    },
  );
}

function removeHCHighlight(card: Element): void {
  (card as HTMLElement).style.boxShadow = "";
  card.removeAttribute("data-jobscout-highlighted");
}
```

- [ ] **Step 2: Call `applyHCHighlight` from `applyHCCardState`**

Find `applyHCCardState` (around line 1315). After the line `applyVisibility(card, jobId, undefined, title);`, add:

```typescript
applyHCHighlight(card, title, company);
```

The function call should come after `applyVisibility` so the dim check inside `applyHCHighlight` reads the correct opacity state:

```typescript
function applyHCCardState(
  card: Element,
  titleSpan: HTMLElement,
  companySpan: HTMLElement | null,
): void {
  const title = titleSpan.innerText.trim();
  if (!title || title.length < 3) return;

  const company = companySpan?.innerText?.trim() ?? "";
  const jobId = buildHCJobId(title, company);

  card.setAttribute("data-jobscout-hc-id", jobId);

  card.querySelectorAll("[data-jobscout-badge]").forEach((el) => el.remove());
  card.querySelectorAll("[data-jobscout-profile-pill]").forEach((el) => el.remove());
  const existingBtn = card.querySelector("[data-jobscout-vis-btn]");
  if (existingBtn) existingBtn.remove();
  undimCard(card);
  removeHCHighlight(card);  // clear stale highlight from previous carousel position

  applyVisibility(card, jobId, undefined, title);
  applyHCHighlight(card, title, company);  // ← ADD THIS LINE

  // ... rest of the function unchanged
```

- [ ] **Step 3: Also re-run `applyHCHighlight` in `reEvaluateAllCards` for hiring-cafe cards**

Find the `reEvaluateAllCards` function (around line 139). In the loop body, after `applyVisibility(card, jobId, undefined, cardTitle);`, add:

```typescript
// Re-apply highlight for hiring-cafe cards
if (detectSite(window.location.href) === "hiring-cafe") {
  const companySpan = card.querySelector<HTMLElement>(
    "span.font-bold:not([class*='line-clamp'])",
  );
  const company = companySpan?.innerText?.trim() ?? "";
  applyHCHighlight(card, cardTitle, company);
}
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd extension
pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 5: Manual smoke test**
  - Load the extension in Chrome from `extension/dist/`
  - Navigate to hiring.cafe
  - Open browser console and confirm no errors from `[JobScout]` logs
  - If you have a profile with resume text, activate it and verify no console errors when cards load

- [ ] **Step 6: Commit**

```bash
git add extension/src/content/index.ts
git commit -m "feat: add applyHCHighlight for green border glow on target-matching cards"
```

---

## Task 11: Dashboard HTML — Rename Avoiding Panel + Add Targeting Panel

**Files:**
- Modify: `extension/public/dashboard.html`

- [ ] **Step 1: Rename "Keyword Filters" to "Avoiding" in the nav button and panel**

In `extension/public/dashboard.html`, find and replace:

Old:
```html
<button class="account-nav-btn" data-panel="keyword-filters">Keyword Filters</button>
```

New:
```html
<button class="account-nav-btn" data-panel="keyword-filters">Avoiding</button>
```

Also update the panel heading inside `panel-keyword-filters`:

Old:
```html
<h3>Keyword Filters</h3>
<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Job cards with titles containing these terms will be automatically dimmed.</p>
```

New:
```html
<h3>Keyword Filters</h3>
<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Job cards with titles containing these terms will be automatically dimmed.</p>
```

(The internal `h3` stays "Keyword Filters" for now — just the nav button label changes to "Avoiding".)

- [ ] **Step 2: Add Blocked Companies section to panel-keyword-filters**

Find the closing `</div>` of `panel-keyword-filters` (after the `kw-filter-list` ul). Add a new section before that closing div:

```html
<div class="account-section" style="margin-top:28px;">
  <h3>Blocked Companies</h3>
  <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Jobs from these companies will be automatically dimmed regardless of score.</p>
  <div style="display:flex;gap:8px;margin-bottom:12px;">
    <input type="text" id="company-block-input" placeholder="e.g. Acme Corp" autocomplete="off" style="flex:1;background:var(--bg,#0d1117);border:1px solid var(--border,#1e293b);border-radius:6px;padding:8px 10px;color:inherit;font-size:13px;">
    <button class="btn-save-profile" id="btn-add-company-block">Add</button>
  </div>
  <div id="company-block-error" style="display:none;color:#e94560;font-size:12px;margin-bottom:8px;"></div>
  <ul id="company-block-list" style="list-style:none;padding:0;margin:0;"></ul>
</div>
```

- [ ] **Step 3: Add Targeting nav button and panel**

After the Avoiding nav button, add:
```html
<button class="account-nav-btn" data-panel="targeting">Targeting</button>
```

After the closing `</div>` of `panel-keyword-filters`, add the Targeting panel:

```html
<div class="account-panel" id="panel-targeting">

  <div class="account-section">
    <h3>Profile Keywords</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Keywords extracted from your active profile's resume. Cards matching these are always highlighted green.</p>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input type="text" id="target-kw-input" placeholder="e.g. react" autocomplete="off" style="flex:1;background:var(--bg,#0d1117);border:1px solid var(--border,#1e293b);border-radius:6px;padding:8px 10px;color:inherit;font-size:13px;">
      <button class="btn-save-profile" id="btn-add-target-kw">Add</button>
      <button class="btn-save-profile" id="btn-reset-target-kw" style="background:var(--bg,#0d1117);border:1px solid var(--border,#1e293b);" title="Re-extract from resume">Reset</button>
    </div>
    <div id="target-kw-error" style="display:none;color:#e94560;font-size:12px;margin-bottom:8px;"></div>
    <ul id="target-kw-list" style="list-style:none;padding:0;margin:0;"></ul>
  </div>

  <div class="account-section" style="margin-top:28px;">
    <h3>Learned Target Keywords</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Built automatically from jobs you applied to and high-scoring analyses. Active when count ≥ 3 and confidence ≥ 70%.</p>
    <div id="target-signals-list" style="margin-top:8px;"></div>
  </div>

  <div class="account-section" style="margin-top:28px;">
    <h3>Target Companies</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Cards from these companies are highlighted green. Built from your high-scoring analyses.</p>
    <ul id="target-companies-list" style="list-style:none;padding:0;margin:0;"></ul>
  </div>

</div>
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd extension
pnpm build
```

Expected: Build completes without errors. The dashboard.html is copied to `dist/` by CopyPlugin.

- [ ] **Step 5: Commit**

```bash
git add extension/public/dashboard.html
git commit -m "feat: add Avoiding rename and Targeting panel to dashboard HTML"
```

---

## Task 12: Dashboard JS — Blocked Companies in Avoiding Panel

**Files:**
- Modify: `extension/src/dashboard/index.ts`

- [ ] **Step 1: Add Blocked Companies state and render function**

Find the `// ── Keyword Filters panel` section (around line 1510) and add before it:

```typescript
// ── Blocked Companies ─────────────────────────────────────────────────────────

interface CompanyEntry { id: number; name: string; }

let blockedCompanies: CompanyEntry[] = [];

function renderBlockedCompaniesList(): void {
  const list = document.getElementById("company-block-list");
  if (!list) return;
  if (blockedCompanies.length === 0) {
    list.innerHTML = '<li style="font-size:12px;color:var(--text-muted);padding:8px 0;">No blocked companies yet.</li>';
    return;
  }
  list.innerHTML = blockedCompanies
    .map(
      (c) =>
        `<li style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#1e293b);font-size:13px;">` +
        `<span>${c.name}</span>` +
        `<button data-block-id="${c.id}" style="background:none;border:none;color:var(--text-muted);font-size:15px;cursor:pointer;padding:2px 6px;border-radius:4px;">×</button>` +
        `</li>`,
    )
    .join("");
}

async function loadBlockedCompanies(): Promise<void> {
  const token = await getToken();
  if (!token) return;
  try {
    const r = await fetch(`${process.env.BACKEND_URL}/companies`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const data: { targets: CompanyEntry[]; blocks: CompanyEntry[] } = await r.json();
    blockedCompanies = data.blocks;
    renderBlockedCompaniesList();
  } catch (err) {
    console.error("[JobScout] Failed to load blocked companies:", err);
  }
}
```

- [ ] **Step 2: Add event listeners for the Blocked Companies section**

Add after `loadBlockedCompanies`:

```typescript
document.getElementById("btn-add-company-block")?.addEventListener("click", async () => {
  const input = document.getElementById("company-block-input") as HTMLInputElement;
  const errEl = document.getElementById("company-block-error");
  const name = input.value.trim();
  if (errEl) errEl.style.display = "none";
  if (!name) return;
  if (blockedCompanies.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    if (errEl) { errEl.textContent = "Company already blocked."; errEl.style.display = "block"; }
    return;
  }

  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/companies/block`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (r.ok) {
    const data: { id: number; name: string } = await r.json();
    blockedCompanies.unshift({ id: data.id, name: data.name });
    renderBlockedCompaniesList();
    input.value = "";
    // Seed into extension storage immediately
    chrome.storage.local.set({ [`company_block_${name.toLowerCase()}`]: true });
  } else {
    if (errEl) { errEl.textContent = "Failed to add company. Please try again."; errEl.style.display = "block"; }
  }
});

document.getElementById("company-block-list")?.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-block-id]");
  if (!btn) return;
  const id = Number(btn.dataset.blockId);
  const entry = blockedCompanies.find((c) => c.id === id);
  if (!entry) return;

  const prev = [...blockedCompanies];
  blockedCompanies = blockedCompanies.filter((c) => c.id !== id);
  renderBlockedCompaniesList();

  const token = await getToken();
  if (!token) return;
  const r = await fetch(
    `${process.env.BACKEND_URL}/companies/block/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    blockedCompanies = prev;
    renderBlockedCompaniesList();
  } else {
    chrome.storage.local.remove(`company_block_${entry.name.toLowerCase()}`);
  }
});
```

- [ ] **Step 3: Call `loadBlockedCompanies` when the Avoiding panel loads**

Find `loadKeywordFiltersPanel` (around line 1514). At the end of that function, add a call to load the companies:

```typescript
async function loadKeywordFiltersPanel(): Promise<void> {
  const token = await getToken();
  if (!token) return;
  try {
    const r = await fetch(`${process.env.BACKEND_URL}/keywords/blocklist`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const data: { terms: string[] } = await r.json();
    kwFilterTerms = data.terms;
    renderKwFilterList();
  } catch (err) {
    console.error("[JobScout] Failed to load keyword filters:", err);
  }
  await loadBlockedCompanies();  // ← ADD THIS LINE
}
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd extension
pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/dashboard/index.ts
git commit -m "feat: add blocked companies section to Avoiding panel"
```

---

## Task 13: Dashboard JS — loadTargetingPanel

**Files:**
- Modify: `extension/src/dashboard/index.ts`

- [ ] **Step 1: Add Targeting panel state and render functions**

Find the `// ── Account sidebar navigation` section and add before it:

```typescript
// ── Targeting panel ──────────────────────────────────────────────────────────

interface TargetKeywordEntry { id: number; keyword: string; source: string; }
interface TargetSignalEntry { ngram: string; target_count: number; show_count: number; }

let targetKeywords: TargetKeywordEntry[] = [];
let targetCompanies: CompanyEntry[] = [];

function renderTargetKeywordList(): void {
  const list = document.getElementById("target-kw-list");
  if (!list) return;
  if (targetKeywords.length === 0) {
    list.innerHTML = '<li style="font-size:12px;color:var(--text-muted);padding:8px 0;">No profile keywords yet. Upload a resume in Profiles to auto-generate, or add manually.</li>';
    return;
  }
  list.innerHTML = targetKeywords
    .map(
      (kw) =>
        `<li style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#1e293b);font-size:13px;">` +
        `<span>${kw.keyword}<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">${kw.source === "resume" ? "resume" : "manual"}</span></span>` +
        `<button data-target-kw-id="${kw.id}" data-target-kw="${kw.keyword.replace(/"/g, "&quot;")}" style="background:none;border:none;color:var(--text-muted);font-size:15px;cursor:pointer;padding:2px 6px;border-radius:4px;">×</button>` +
        `</li>`,
    )
    .join("");
}

function renderTargetSignalsList(signals: TargetSignalEntry[]): void {
  const container = document.getElementById("target-signals-list");
  if (!container) return;
  if (signals.length === 0) {
    container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">No learned signals yet. Apply to jobs or analyze high-scoring listings to build signal.</p>';
    return;
  }
  const sorted = [...signals].sort((a, b) => {
    const confA = a.target_count + a.show_count > 0 ? a.target_count / (a.target_count + a.show_count) : 0;
    const confB = b.target_count + b.show_count > 0 ? b.target_count / (b.target_count + b.show_count) : 0;
    return confB - confA || b.target_count - a.target_count;
  });
  container.innerHTML = sorted
    .map((sig) => {
      const total = sig.target_count + sig.show_count;
      const conf = total > 0 ? Math.round((sig.target_count / total) * 100) : 0;
      const isActive = sig.target_count >= 3 && conf >= 70;
      return (
        `<div style="padding:8px 0;border-bottom:1px solid var(--border,#1e293b);">` +
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">` +
        `<span style="font-size:13px;">${sig.ngram}</span>` +
        `<span style="font-size:11px;color:${isActive ? "#4ade80" : "var(--text-muted)"};">${isActive ? "● active" : "building signal"}</span>` +
        `</div>` +
        `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-muted);">` +
        `<span>target: ${sig.target_count}</span><span>show: ${sig.show_count}</span><span>${conf}% confidence</span>` +
        `</div>` +
        `<div style="height:3px;background:var(--border,#1e293b);border-radius:2px;margin-top:4px;">` +
        `<div style="height:100%;width:${conf}%;background:${isActive ? "#4ade80" : "#64748b"};border-radius:2px;transition:width 0.3s;"></div>` +
        `</div>` +
        `</div>`
      );
    })
    .join("");
}

function renderTargetCompaniesList(): void {
  const list = document.getElementById("target-companies-list");
  if (!list) return;
  if (targetCompanies.length === 0) {
    list.innerHTML = '<li style="font-size:12px;color:var(--text-muted);padding:8px 0;">No target companies yet. Analyze high-scoring jobs to build this list automatically.</li>';
    return;
  }
  list.innerHTML = targetCompanies
    .map(
      (c) =>
        `<li style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border,#1e293b);font-size:13px;">` +
        `<span>${c.name}</span>` +
        `<button data-target-company-id="${c.id}" style="background:none;border:none;color:var(--text-muted);font-size:15px;cursor:pointer;padding:2px 6px;border-radius:4px;">×</button>` +
        `</li>`,
    )
    .join("");
}

async function loadTargetingPanel(): Promise<void> {
  const token = await getToken();
  if (!token) return;

  // Get active profile id from storage
  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get("active_profile_id", (items) => resolve(items)),
  );
  const profileId = stored["active_profile_id"] as number | undefined;

  if (!profileId) {
    const container = document.getElementById("panel-targeting");
    if (container) {
      container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:16px;">No active profile. Activate a profile in the Profiles tab to use targeting.</p>';
    }
    return;
  }

  // Load profile keywords
  try {
    const r = await fetch(
      `${process.env.BACKEND_URL}/profiles/${profileId}/target-keywords`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (r.ok) {
      targetKeywords = await r.json();
      renderTargetKeywordList();
    }
  } catch (err) {
    console.error("[JobScout] Failed to load target keywords:", err);
  }

  // Load target signals
  try {
    const r = await fetch(
      `${process.env.BACKEND_URL}/keywords/target-signals/${profileId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (r.ok) {
      const signals: TargetSignalEntry[] = await r.json();
      renderTargetSignalsList(signals);
    }
  } catch (err) {
    console.error("[JobScout] Failed to load target signals:", err);
  }

  // Load target companies
  try {
    const r = await fetch(
      `${process.env.BACKEND_URL}/companies?profile_id=${profileId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (r.ok) {
      const data: { targets: CompanyEntry[]; blocks: CompanyEntry[] } = await r.json();
      targetCompanies = data.targets;
      renderTargetCompaniesList();
    }
  } catch (err) {
    console.error("[JobScout] Failed to load target companies:", err);
  }
}
```

- [ ] **Step 2: Add event listeners for Profile Keywords add/delete/reset**

Add after `loadTargetingPanel`:

```typescript
document.getElementById("btn-add-target-kw")?.addEventListener("click", async () => {
  const input = document.getElementById("target-kw-input") as HTMLInputElement;
  const errEl = document.getElementById("target-kw-error");
  const keyword = input.value.trim().toLowerCase();
  if (errEl) errEl.style.display = "none";
  if (!keyword) return;
  if (targetKeywords.some((k) => k.keyword === keyword)) {
    if (errEl) { errEl.textContent = "Keyword already exists."; errEl.style.display = "block"; }
    return;
  }

  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get("active_profile_id", (items) => resolve(items)),
  );
  const profileId = stored["active_profile_id"] as number | undefined;
  if (!profileId) return;

  const token = await getToken();
  if (!token) return;
  const r = await fetch(
    `${process.env.BACKEND_URL}/profiles/${profileId}/target-keywords`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, source: "learned" }),
    },
  );
  if (r.ok) {
    const data: { keyword: string } = await r.json();
    // Reload to get id
    await loadTargetingPanel();
    input.value = "";
    chrome.storage.local.set({ [`kw_target_profile_${keyword}`]: true });
  } else {
    if (errEl) { errEl.textContent = "Failed to add keyword."; errEl.style.display = "block"; }
  }
});

document.getElementById("target-kw-list")?.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-target-kw-id]");
  if (!btn) return;
  const id = Number(btn.dataset.targetKwId);
  const keyword = btn.dataset.targetKw!;

  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get("active_profile_id", (items) => resolve(items)),
  );
  const profileId = stored["active_profile_id"] as number | undefined;
  if (!profileId) return;

  const prev = [...targetKeywords];
  targetKeywords = targetKeywords.filter((k) => k.id !== id);
  renderTargetKeywordList();

  const token = await getToken();
  if (!token) return;
  const r = await fetch(
    `${process.env.BACKEND_URL}/profiles/${profileId}/target-keywords/${encodeURIComponent(keyword)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    targetKeywords = prev;
    renderTargetKeywordList();
  } else {
    chrome.storage.local.remove(`kw_target_profile_${keyword}`);
  }
});

document.getElementById("btn-reset-target-kw")?.addEventListener("click", async () => {
  const stored = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get("active_profile_id", (items) => resolve(items)),
  );
  const profileId = stored["active_profile_id"] as number | undefined;
  if (!profileId) return;

  const token = await getToken();
  if (!token) return;
  const r = await fetch(
    `${process.env.BACKEND_URL}/profiles/${profileId}/target-keywords/reset`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (r.ok) {
    await loadTargetingPanel();
    // Re-seed profile keywords in storage
    const kwR = await fetch(
      `${process.env.BACKEND_URL}/profiles/${profileId}/target-keywords`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (kwR.ok) {
      const kws: TargetKeywordEntry[] = await kwR.json();
      // Clear old profile kw keys
      const allKeys = await new Promise<string[]>((resolve) =>
        chrome.storage.local.get(null, (items) => resolve(Object.keys(items))),
      );
      const oldKeys = allKeys.filter((k) => k.startsWith("kw_target_profile_"));
      chrome.storage.local.remove(oldKeys);
      const updates: Record<string, boolean> = {};
      for (const kw of kws) {
        updates[`kw_target_profile_${kw.keyword}`] = true;
      }
      chrome.storage.local.set(updates);
    }
  }
});

document.getElementById("target-companies-list")?.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-target-company-id]");
  if (!btn) return;
  const id = Number(btn.dataset.targetCompanyId);
  const entry = targetCompanies.find((c) => c.id === id);
  if (!entry) return;

  const prev = [...targetCompanies];
  targetCompanies = targetCompanies.filter((c) => c.id !== id);
  renderTargetCompaniesList();

  const token = await getToken();
  if (!token) return;
  const r = await fetch(
    `${process.env.BACKEND_URL}/companies/target/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    targetCompanies = prev;
    renderTargetCompaniesList();
  } else {
    chrome.storage.local.remove(`company_target_${entry.name.toLowerCase()}`);
  }
});
```

- [ ] **Step 3: Wire up Targeting panel in the sidebar navigation**

Find the account sidebar navigation listener (around line 1602):

```typescript
document.querySelectorAll<HTMLButtonElement>(".account-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".account-nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".account-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panelId = `panel-${btn.dataset.panel}`;
    document.getElementById(panelId)?.classList.add("active");
    if (btn.dataset.panel === "profiles") loadProfilesPanel();
    if (btn.dataset.panel === "keyword-filters") loadKeywordFiltersPanel();
    if (btn.dataset.panel === "targeting") loadTargetingPanel();  // ← ADD THIS LINE
  });
});
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd extension
pnpm build
```

Expected: Build completes with no errors.

- [ ] **Step 5: Full smoke test**
  - Reload extension in Chrome
  - Open the dashboard (toolbar icon → History button or direct URL)
  - Click Account tab → verify "Avoiding" label on nav button
  - Click Avoiding → verify Blocked Companies section appears
  - Click Targeting → verify Profile Keywords, Learned Target Keywords, and Target Companies sections appear
  - If no active profile, verify the "No active profile" message renders
  - Open backend server logs, confirm no 500 errors during panel load

- [ ] **Step 6: Commit**

```bash
git add extension/src/dashboard/index.ts
git commit -m "feat: add loadTargetingPanel with profile keywords, signals, and target companies"
```

---

## Task 14: Final Integration Test & Cleanup

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
pytest -v
```

Expected: All tests PASS with no failures.

- [ ] **Step 2: Run a full extension build**

```bash
cd extension
pnpm build
```

Expected: No TypeScript errors, no webpack warnings about missing exports.

- [ ] **Step 3: Manual end-to-end test on hiring.cafe**
  - Ensure backend is running (`uvicorn app.main:app --reload`)
  - Log in through the extension popup
  - Navigate to hiring.cafe
  - Open a job modal and let it analyze
  - If score >= 80: open browser console, confirm `mineTargetSignalsFromAnalysis` log or check `chrome.storage.local` for `kw_target_*` entries
  - Return to card list, confirm a green border appears on matching cards
  - Open dashboard → Account → Targeting: verify Target Companies list shows the mined company
  - Open dashboard → Account → Avoiding: verify Blocked Companies section is visible and functional

- [ ] **Step 4: Commit any final fixes discovered during smoke testing**

```bash
git add -p  # stage only relevant changes
git commit -m "fix: resolve smoke test issues from targeting integration"
```
