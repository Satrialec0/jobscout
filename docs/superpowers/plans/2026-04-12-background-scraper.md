# Background Scraper + Extension Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically scrape the user's hiring.cafe saved searches every hour, filter results against targeting signals, store matches in PostgreSQL, and email the user when new jobs are found — all without opening browser tabs.

**Architecture:** The Chrome extension reads the user's hiring.cafe session cookies on every navigation to the site and ships them (encrypted) to the FastAPI backend. APScheduler fires a poll cycle every hour using `asyncio.gather` across all saved searches. Matching jobs are stored in a `scraped_jobs` table; SendGrid sends email notifications. The extension gets three additions: cookie sync on navigation, a "Watch this search" button, and per-click application status sync.

**Tech Stack:** Python `apscheduler`, `sendgrid`, `cryptography.fernet` (already installed), SQLAlchemy, Alembic, TypeScript (Chrome extension)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/app/config.py` | Modify | Add `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` |
| `backend/app/models/scraper.py` | Create | ORM: `HiringCafeCredential`, `SavedSearch`, `ScrapedJob` |
| `backend/alembic/versions/a009_add_scraper_tables.py` | Create | DB migration |
| `backend/app/schemas/scraper.py` | Create | Pydantic request/response schemas |
| `backend/app/services/email.py` | Create | SendGrid email helpers |
| `backend/app/services/hiring_cafe.py` | Create | HTTP fetch against hiring.cafe API, auth error detection |
| `backend/app/services/scraper_poll.py` | Create | Poll cycle, targeting filter (server-side), dedup, insert |
| `backend/app/api/scraper.py` | Create | REST router: credentials, searches, scraped jobs |
| `backend/app/main.py` | Modify | Register scraper router, start APScheduler on startup |
| `backend/tests/test_scraper.py` | Create | Unit tests for scraper service logic |
| `extension/src/background/index.ts` | Modify | Handle `HIRING_CAFE_NAVIGATED`, sync cookies to backend |
| `extension/src/content/index.ts` | Modify | Send `HIRING_CAFE_NAVIGATED` on load, inject Watch button, intercept search-jobs fetch |
| `extension/src/dashboard/index.ts` | Modify | Fire per-click status PATCH after `chrome.storage` write |

---

### Task 1: Add SendGrid config settings

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/.env` (add placeholder keys)

- [ ] **Step 1: Add settings fields**

In `backend/app/config.py`, add two fields to the `Settings` class after `encryption_key`:

```python
sendgrid_api_key: str | None = None
sendgrid_from_email: str | None = None
```

Full updated `Settings` class:

```python
class Settings(BaseSettings):
    anthropic_api_key: str | None = None
    database_url: str
    environment: str = "development"
    encryption_key: str
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 720
    sendgrid_api_key: str | None = None
    sendgrid_from_email: str | None = None

    class Config:
        env_file = str(ENV_PATH)
        env_file_encoding = "utf-8"
```

- [ ] **Step 2: Add placeholders to .env**

Append to `backend/.env`:
```
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/config.py backend/.env
git commit -m "feat: add SendGrid config settings"
```

---

### Task 2: Create scraper ORM models

**Files:**
- Create: `backend/app/models/scraper.py`
- Test: `backend/tests/test_scraper.py`

- [ ] **Step 1: Write failing column tests**

Create `backend/tests/test_scraper.py`:

```python
from app.models.scraper import HiringCafeCredential, SavedSearch, ScrapedJob


def test_hiring_cafe_credential_columns():
    cols = {c.key for c in HiringCafeCredential.__table__.columns}
    assert cols == {"id", "user_id", "cookie_header", "updated_at"}


def test_saved_search_columns():
    cols = {c.key for c in SavedSearch.__table__.columns}
    assert cols == {"id", "user_id", "name", "search_state", "is_active", "created_at", "last_polled"}


def test_scraped_job_columns():
    cols = {c.key for c in ScrapedJob.__table__.columns}
    assert cols == {"id", "user_id", "saved_search_id", "object_id", "apply_url",
                    "title", "company", "description", "found_at", "is_read", "analysis_id"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_scraper.py -v
```

Expected: `ImportError: cannot import name 'HiringCafeCredential'`

- [ ] **Step 3: Create the models**

Create `backend/app/models/scraper.py`:

```python
from datetime import datetime, timezone
from sqlalchemy import Integer, String, Boolean, DateTime, Text, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class HiringCafeCredential(Base):
    """Stores the reconstructed Cookie header for a user's hiring.cafe session.
    All cookies for the domain are concatenated into a single header string,
    then Fernet-encrypted before storage."""
    __tablename__ = "hiring_cafe_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    cookie_header: Mapped[str] = mapped_column(Text, nullable=False)  # Fernet-encrypted
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class SavedSearch(Base):
    """A hiring.cafe search the user wants polled every hour."""
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    search_state: Mapped[dict] = mapped_column(JSON, nullable=False)  # decoded s= payload
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    last_polled: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)


class ScrapedJob(Base):
    """A job found by the background scraper that matches the user's targeting signals."""
    __tablename__ = "scraped_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    saved_search_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("saved_searches.id", ondelete="SET NULL"), nullable=True
    )
    object_id: Mapped[str] = mapped_column(String(200), nullable=False)  # hiring.cafe Algolia objectID
    apply_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    found_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    analysis_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("job_analyses.id", ondelete="SET NULL"), nullable=True, default=None
    )

    __table_args__ = (UniqueConstraint("user_id", "object_id", name="uq_scraped_job_user_object"),)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_scraper.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/scraper.py backend/tests/test_scraper.py
git commit -m "feat: add scraper ORM models with tests"
```

---

### Task 3: Create Alembic migration

**Files:**
- Create: `backend/alembic/versions/a009_add_scraper_tables.py`

- [ ] **Step 1: Generate migration**

```bash
cd backend && alembic revision --autogenerate -m "add scraper tables"
```

This creates a new file in `backend/alembic/versions/`. Rename it to `a009_add_scraper_tables.py`.

- [ ] **Step 2: Verify migration contents**

Open the generated file and confirm it contains `create_table` calls for `hiring_cafe_credentials`, `saved_searches`, and `scraped_jobs`. The autogenerated migration should include all three tables and the unique constraint on `scraped_jobs`.

- [ ] **Step 3: Run migration**

```bash
cd backend && alembic upgrade head
```

Expected output ends with: `Running upgrade ... -> ..., add scraper tables`

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/a009_add_scraper_tables.py
git commit -m "feat: add scraper tables migration"
```

---

### Task 4: Create Pydantic schemas

**Files:**
- Create: `backend/app/schemas/scraper.py`
- Test: `backend/tests/test_scraper.py` (append)

- [ ] **Step 1: Write failing schema tests**

Append to `backend/tests/test_scraper.py`:

```python
from app.schemas.scraper import (
    CredentialUpsertRequest,
    CredentialStatusResponse,
    SavedSearchCreate,
    SavedSearchUpdate,
    SavedSearchItem,
    ScrapedJobItem,
)
from datetime import datetime, timezone


def test_credential_upsert_request():
    req = CredentialUpsertRequest(cookie_header="session=abc123")
    assert req.cookie_header == "session=abc123"


def test_credential_status_response():
    resp = CredentialStatusResponse(active=True, last_used=None, last_error=None)
    assert resp.active is True


def test_saved_search_create():
    req = SavedSearchCreate(name="Senior Eng", search_state={"searchQuery": "senior engineer"})
    assert req.name == "Senior Eng"
    assert req.search_state["searchQuery"] == "senior engineer"


def test_saved_search_item():
    item = SavedSearchItem(
        id=1, name="Senior Eng", is_active=True,
        search_state={"searchQuery": "senior engineer"},
        created_at=datetime.now(timezone.utc), last_polled=None
    )
    assert item.id == 1


def test_scraped_job_item():
    item = ScrapedJobItem(
        id=1, object_id="abc", apply_url="https://example.com",
        title="Engineer", company="Acme", description="Build things",
        found_at=datetime.now(timezone.utc), is_read=False, analysis_id=None,
        saved_search_name=None
    )
    assert item.title == "Engineer"
    assert item.is_read is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_scraper.py::test_credential_upsert_request -v
```

Expected: `ImportError: cannot import name 'CredentialUpsertRequest'`

- [ ] **Step 3: Create schemas**

Create `backend/app/schemas/scraper.py`:

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Any


class CredentialUpsertRequest(BaseModel):
    cookie_header: str  # full reconstructed Cookie header value (unencrypted)


class CredentialStatusResponse(BaseModel):
    active: bool
    last_used: datetime | None
    last_error: str | None


class SavedSearchCreate(BaseModel):
    name: str
    search_state: dict[str, Any]  # decoded JSON from s= parameter


class SavedSearchUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class SavedSearchItem(BaseModel):
    id: int
    name: str
    is_active: bool
    search_state: dict[str, Any]
    created_at: datetime
    last_polled: datetime | None

    class Config:
        from_attributes = True


class ScrapedJobItem(BaseModel):
    id: int
    object_id: str
    apply_url: str
    title: str
    company: str
    description: str
    found_at: datetime
    is_read: bool
    analysis_id: int | None
    saved_search_name: str | None  # joined from saved_searches

    class Config:
        from_attributes = True


class AnalyzeScrapedJobResponse(BaseModel):
    """Returned when user clicks Analyze on a scraped job."""
    scraped_job_id: int
    analysis_id: int
    fit_score: int
    should_apply: bool
    one_line_verdict: str
    direct_matches: list
    transferable: list
    gaps: list
    red_flags: list[str]
    green_flags: list[str]
    salary_estimate: dict | None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_scraper.py -v
```

Expected: all schema tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/scraper.py backend/tests/test_scraper.py
git commit -m "feat: add scraper Pydantic schemas with tests"
```

---

### Task 5: Create email service

**Files:**
- Create: `backend/app/services/email.py`
- Test: `backend/tests/test_scraper.py` (append)

- [ ] **Step 1: Install sendgrid**

```bash
cd backend && pip install sendgrid
```

Add to `backend/requirements.txt` (or `pyproject.toml` if used):
```
sendgrid
```

- [ ] **Step 2: Write failing tests**

Append to `backend/tests/test_scraper.py`:

```python
from unittest.mock import patch, MagicMock
from app.services.email import build_match_email_body, build_expiry_email_body


def test_build_match_email_body_single():
    jobs = [{"title": "Software Engineer", "company": "Acme", "apply_url": "https://acme.com/apply"}]
    body = build_match_email_body(jobs)
    assert "Software Engineer" in body
    assert "Acme" in body
    assert "https://acme.com/apply" in body


def test_build_match_email_body_plural():
    jobs = [
        {"title": "Engineer", "company": "A", "apply_url": "https://a.com"},
        {"title": "Analyst", "company": "B", "apply_url": "https://b.com"},
    ]
    body = build_match_email_body(jobs)
    assert "2 new jobs" in body
    assert "Engineer" in body
    assert "Analyst" in body


def test_build_expiry_email_body():
    body = build_expiry_email_body()
    assert "session" in body.lower()
    assert "hiring.cafe" in body
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_scraper.py::test_build_match_email_body_single -v
```

Expected: `ImportError: cannot import name 'build_match_email_body'`

- [ ] **Step 4: Create email service**

Create `backend/app/services/email.py`:

```python
import logging
from app.config import get_settings

logger = logging.getLogger(__name__)


def build_match_email_body(jobs: list[dict]) -> str:
    n = len(jobs)
    subject_noun = f"{n} new job" + ("s" if n != 1 else "")
    lines = [f"JobScout found {subject_noun} matching your profile:\n"]
    for job in jobs:
        lines.append(f"  {job['title']} at {job['company']}")
        lines.append(f"  {job['apply_url']}\n")
    lines.append("Open your dashboard to review and analyze them.")
    return "\n".join(lines)


def build_expiry_email_body() -> str:
    return (
        "Your hiring.cafe session has expired and JobScout has paused polling.\n\n"
        "Visit hiring.cafe in your browser to automatically refresh your session. "
        "Polling will resume within the hour."
    )


def send_email(to_email: str, subject: str, body: str) -> None:
    settings = get_settings()
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        logger.warning("SendGrid not configured — skipping email to %s", to_email)
        return

    try:
        import sendgrid as sg_module
        from sendgrid.helpers.mail import Mail
        client = sg_module.SendGridAPIClient(settings.sendgrid_api_key)
        message = Mail(
            from_email=settings.sendgrid_from_email,
            to_emails=to_email,
            subject=subject,
            plain_text_content=body,
        )
        response = client.send(message)
        logger.info("Email sent to %s, status %s", to_email, response.status_code)
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_scraper.py::test_build_match_email_body_single tests/test_scraper.py::test_build_match_email_body_plural tests/test_scraper.py::test_build_expiry_email_body -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/email.py backend/tests/test_scraper.py backend/requirements.txt
git commit -m "feat: add SendGrid email service with tests"
```

---

### Task 6: Create hiring.cafe fetch service

**Files:**
- Create: `backend/app/services/hiring_cafe.py`
- Test: `backend/tests/test_scraper.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_scraper.py`:

```python
from app.services.hiring_cafe import (
    build_search_url,
    parse_job_from_result,
    HiringCafeAuthError,
    HiringCafeRateLimitError,
)
import json
import urllib.parse


def test_build_search_url():
    state = {"searchQuery": "engineer", "workplaceTypes": ["Remote"]}
    url = build_search_url(state, page=0, size=40)
    assert "/api/search-jobs" in url
    assert "sv=control" in url
    assert "size=40" in url
    assert "page=0" in url
    # s= param should be present and URL-encoded
    assert "s=" in url
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    decoded = json.loads(urllib.parse.unquote(params["s"][0]))
    assert decoded["searchQuery"] == "engineer"


def test_parse_job_from_result():
    raw = {
        "objectID": "abc123",
        "apply_url": "https://example.com/apply",
        "job_information": {"title": "Software Engineer", "description": "Build stuff"},
        "enriched_company_data": {"name": "Acme Corp"},
    }
    job = parse_job_from_result(raw)
    assert job["object_id"] == "abc123"
    assert job["title"] == "Software Engineer"
    assert job["company"] == "Acme Corp"
    assert job["description"] == "Build stuff"
    assert job["apply_url"] == "https://example.com/apply"


def test_parse_job_missing_company():
    raw = {
        "objectID": "xyz",
        "apply_url": "https://example.com",
        "job_information": {"title": "Analyst", "description": "Analyse things"},
        "enriched_company_data": {},
    }
    job = parse_job_from_result(raw)
    assert job["company"] == ""
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_scraper.py::test_build_search_url -v
```

Expected: `ImportError: cannot import name 'build_search_url'`

- [ ] **Step 3: Create the service**

Create `backend/app/services/hiring_cafe.py`:

```python
import json
import logging
import urllib.parse
import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://hiring.cafe"


class HiringCafeAuthError(Exception):
    """Raised when the hiring.cafe session cookie is expired or invalid."""


class HiringCafeRateLimitError(Exception):
    """Raised on 503 — caller should apply exponential backoff."""


def build_search_url(search_state: dict, page: int = 0, size: int = 40) -> str:
    """Build the full /api/search-jobs URL from a decoded search state dict."""
    encoded = urllib.parse.quote(json.dumps(search_state))
    return f"{BASE_URL}/api/search-jobs?s={encoded}&size={size}&page={page}&sv=control"


def parse_job_from_result(raw: dict) -> dict:
    """Extract the fields we care about from a single hiring.cafe result object."""
    ji = raw.get("job_information") or {}
    co = raw.get("enriched_company_data") or {}
    return {
        "object_id": raw.get("objectID", ""),
        "apply_url": raw.get("apply_url", ""),
        "title": ji.get("title", ""),
        "company": co.get("name", ""),
        "description": ji.get("description", ""),
    }


async def fetch_search(search_state: dict, cookie_header: str) -> list[dict]:
    """Fetch one page of results for a saved search.

    Args:
        search_state: Decoded JSON dict representing the search filters.
        cookie_header: Raw Cookie header value (e.g. "session=abc; other=xyz").

    Returns:
        List of parsed job dicts (object_id, apply_url, title, company, description).

    Raises:
        HiringCafeAuthError: If the response is HTML (expired/invalid session).
        HiringCafeRateLimitError: If the server returns 503.
    """
    url = build_search_url(search_state)
    headers = {
        "Cookie": cookie_header,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, headers=headers)

    if response.status_code == 503:
        raise HiringCafeRateLimitError(f"503 from hiring.cafe")

    if response.status_code == 403:
        raise HiringCafeAuthError("403 — session likely expired")

    content_type = response.headers.get("content-type", "")
    if "text/html" in content_type:
        raise HiringCafeAuthError("HTML response — session expired or invalid")

    try:
        data = response.json()
    except Exception as e:
        raise HiringCafeAuthError(f"Non-JSON response: {e}") from e

    results = data.get("results", [])
    return [parse_job_from_result(r) for r in results if r.get("objectID")]
```

- [ ] **Step 4: Install httpx**

```bash
cd backend && pip install httpx
```

Add to `backend/requirements.txt`:
```
httpx
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_scraper.py::test_build_search_url tests/test_scraper.py::test_parse_job_from_result tests/test_scraper.py::test_parse_job_missing_company -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/hiring_cafe.py backend/tests/test_scraper.py backend/requirements.txt
git commit -m "feat: add hiring.cafe fetch service with tests"
```

---

### Task 7: Create scraper poll service

**Files:**
- Create: `backend/app/services/scraper_poll.py`
- Test: `backend/tests/test_scraper.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_scraper.py`:

```python
from app.services.scraper_poll import tokenize_title, job_matches_signals


def test_tokenize_title_basic():
    tokens = tokenize_title("Senior Software Engineer")
    assert "senior" in tokens
    assert "software" in tokens
    assert "engineer" in tokens


def test_tokenize_title_strips_punctuation():
    tokens = tokenize_title("Sr. Engineer (Remote)")
    assert "sr" in tokens or "sr." not in tokens
    assert "engineer" in tokens
    # parentheses and punctuation stripped
    assert "remote" in tokens


def test_job_matches_signals_profile_keyword():
    job = {"title": "Senior Python Engineer", "company": "Acme"}
    signals = {
        "profile_keywords": ["python"],
        "target_signals": [],
        "target_companies": [],
    }
    assert job_matches_signals(job, signals) is True


def test_job_matches_signals_company():
    job = {"title": "Engineer", "company": "Acme Corp"}
    signals = {
        "profile_keywords": [],
        "target_signals": [],
        "target_companies": ["acme corp"],
    }
    assert job_matches_signals(job, signals) is True


def test_job_matches_signals_no_match():
    job = {"title": "Sales Manager", "company": "Retail Inc"}
    signals = {
        "profile_keywords": ["python", "engineer"],
        "target_signals": [],
        "target_companies": ["acme"],
    }
    assert job_matches_signals(job, signals) is False


def test_job_matches_signals_learned():
    job = {"title": "Data Engineer at Scale", "company": "Unknown"}
    signals = {
        "profile_keywords": [],
        "target_signals": [{"ngram": "data engineer", "target_count": 5, "show_count": 1}],
        "target_companies": [],
    }
    assert job_matches_signals(job, signals) is True


def test_job_matches_signals_learned_below_threshold():
    job = {"title": "Data Engineer", "company": "Unknown"}
    signals = {
        "profile_keywords": [],
        # target_count=2 < 3 threshold
        "target_signals": [{"ngram": "data engineer", "target_count": 2, "show_count": 1}],
        "target_companies": [],
    }
    assert job_matches_signals(job, signals) is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_scraper.py::test_tokenize_title_basic -v
```

Expected: `ImportError: cannot import name 'tokenize_title'`

- [ ] **Step 3: Create the poll service**

Create `backend/app/services/scraper_poll.py`:

```python
import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.scraper import HiringCafeCredential, SavedSearch, ScrapedJob
from app.models.job import JobAnalysis
from app.models.targeting import ProfileTargetKeyword, ProfileTargetSignal, Company
from app.models.user import User
from app.models.user_profile import UserProfile
from app.services.encryption import decrypt, encrypt
from app.services.hiring_cafe import fetch_search, HiringCafeAuthError, HiringCafeRateLimitError
from app.services.email import build_match_email_body, build_expiry_email_body, send_email

logger = logging.getLogger(__name__)

_MIN_TARGET_COUNT = 3
_MIN_CONFIDENCE = 0.70


def tokenize_title(title: str) -> list[str]:
    """Lowercase and split a job title into individual word tokens."""
    cleaned = re.sub(r"[^\w\s]", "", title.lower())
    return [w for w in cleaned.split() if w]


def _ngrams(tokens: list[str], n: int) -> list[str]:
    return [" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def job_matches_signals(job: dict, signals: dict) -> bool:
    """Return True if a job matches any of the user's targeting signals.

    signals dict shape:
      {
        "profile_keywords": list[str],       # always-active keywords (lowercase)
        "target_signals": list[dict],        # {"ngram": str, "target_count": int, "show_count": int}
        "target_companies": list[str],       # lowercase company names
      }
    """
    title_lower = job.get("title", "").lower()
    company_lower = job.get("company", "").lower()
    tokens = tokenize_title(job.get("title", ""))
    title_ngrams = set(tokens) | set(_ngrams(tokens, 2)) | set(_ngrams(tokens, 3))

    # Profile keywords — always active
    for kw in signals["profile_keywords"]:
        if kw.lower() in title_lower:
            return True

    # Target companies
    for co in signals["target_companies"]:
        if co.lower() in company_lower:
            return True

    # Learned target signals — threshold: count >= 3 AND confidence >= 70%
    for sig in signals["target_signals"]:
        tc = sig["target_count"]
        sc = sig["show_count"]
        if tc < _MIN_TARGET_COUNT:
            continue
        confidence = tc / (tc + sc) if (tc + sc) > 0 else 0
        if confidence < _MIN_CONFIDENCE:
            continue
        if sig["ngram"].lower() in title_ngrams:
            return True

    return False


def _load_signals_for_user(user_id: int, db: Session) -> dict:
    """Load all targeting signals for a user's active profile from the DB."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == user_id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        return {"profile_keywords": [], "target_signals": [], "target_companies": []}

    keywords = (
        db.query(ProfileTargetKeyword.keyword)
        .filter(ProfileTargetKeyword.profile_id == profile.id)
        .all()
    )
    signals = (
        db.query(ProfileTargetSignal)
        .filter(ProfileTargetSignal.profile_id == profile.id)
        .all()
    )
    companies = (
        db.query(Company.name)
        .filter(Company.profile_id == profile.id, Company.list_type == "target")
        .all()
    )

    return {
        "profile_keywords": [k.keyword.lower() for k in keywords],
        "target_signals": [
            {"ngram": s.ngram, "target_count": s.target_count, "show_count": s.show_count}
            for s in signals
        ],
        "target_companies": [c.name.lower() for c in companies],
    }


def _is_new_job(object_id: str, apply_url: str, user_id: int, db: Session) -> bool:
    """Return True if this job has not been seen by this user before."""
    in_scraped = (
        db.query(ScrapedJob.id)
        .filter(ScrapedJob.user_id == user_id, ScrapedJob.object_id == object_id)
        .first()
    )
    if in_scraped:
        return False

    in_analyzed = (
        db.query(JobAnalysis.id)
        .filter(JobAnalysis.user_id == user_id, JobAnalysis.url == apply_url)
        .first()
    )
    return in_analyzed is None


async def _fetch_with_backoff(search_state: dict, cookie_header: str, max_retries: int = 3) -> list[dict]:
    """Fetch search results with exponential backoff on rate limit errors."""
    delay = 120  # seconds
    for attempt in range(max_retries):
        try:
            return await fetch_search(search_state, cookie_header)
        except HiringCafeRateLimitError:
            if attempt == max_retries - 1:
                raise
            logger.warning("Rate limited by hiring.cafe, backing off %ds", delay)
            await asyncio.sleep(delay)
            delay *= 2
    return []


async def poll_user(user_id: int) -> None:
    """Run one poll cycle for a single user. Called by APScheduler."""
    db: Session = SessionLocal()
    try:
        cred = db.query(HiringCafeCredential).filter(
            HiringCafeCredential.user_id == user_id
        ).first()
        if not cred:
            return

        cookie_header = decrypt(cred.cookie_header)

        searches = (
            db.query(SavedSearch)
            .filter(SavedSearch.user_id == user_id, SavedSearch.is_active.is_(True))
            .all()
        )
        if not searches:
            return

        signals = _load_signals_for_user(user_id, db)
        user = db.query(User).filter(User.id == user_id).first()

        # Fetch all searches concurrently
        tasks = [_fetch_with_backoff(s.search_state, cookie_header) for s in searches]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        new_jobs: list[dict] = []

        for search, result in zip(searches, results):
            if isinstance(result, HiringCafeAuthError):
                logger.warning("Auth error for user %d — disabling credential", user_id)
                db.delete(cred)
                db.commit()
                if user:
                    send_email(
                        user.email,
                        "JobScout: Your hiring.cafe session has expired",
                        build_expiry_email_body(),
                    )
                return

            if isinstance(result, Exception):
                logger.error("Error polling search %d for user %d: %s", search.id, user_id, result)
                continue

            for job in result:
                if not _is_new_job(job["object_id"], job["apply_url"], user_id, db):
                    continue
                if not job_matches_signals(job, signals):
                    continue

                scraped = ScrapedJob(
                    user_id=user_id,
                    saved_search_id=search.id,
                    object_id=job["object_id"],
                    apply_url=job["apply_url"],
                    title=job["title"],
                    company=job["company"],
                    description=job["description"],
                )
                db.add(scraped)
                new_jobs.append(job)

            search.last_polled = datetime.now(timezone.utc)

        db.commit()

        if new_jobs and user:
            n = len(new_jobs)
            send_email(
                user.email,
                f"JobScout: {n} new job{'s' if n != 1 else ''} match your profile",
                build_match_email_body(new_jobs),
            )
            logger.info("Emailed %d new jobs to user %d", n, user_id)

    except Exception:
        logger.exception("Unexpected error in poll_user(%d)", user_id)
        db.rollback()
    finally:
        db.close()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_scraper.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scraper_poll.py backend/tests/test_scraper.py
git commit -m "feat: add scraper poll service with targeting filter and dedup"
```

---

### Task 8: Create scraper API router

**Files:**
- Create: `backend/app/api/scraper.py`

- [ ] **Step 1: Create the router**

Create `backend/app/api/scraper.py`:

```python
import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.scraper import HiringCafeCredential, SavedSearch, ScrapedJob
from app.models.job import JobAnalysis
from app.models.user import User
from app.schemas.scraper import (
    CredentialUpsertRequest,
    CredentialStatusResponse,
    SavedSearchCreate,
    SavedSearchUpdate,
    SavedSearchItem,
    ScrapedJobItem,
    AnalyzeScrapedJobResponse,
)
from app.services.encryption import encrypt
from app.services.claude import analyze_job as run_claude
from app.models.repository import save_analysis
from app.api.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_SEARCHES_PER_USER = 5


# ── Credentials ──────────────────────────────────────────────────────────────

@router.post("/scraper/credentials", status_code=204)
async def upsert_credentials(
    request: CredentialUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    encrypted = encrypt(request.cookie_header)
    existing = db.query(HiringCafeCredential).filter(
        HiringCafeCredential.user_id == current_user.id
    ).first()
    if existing:
        existing.cookie_header = encrypted
    else:
        db.add(HiringCafeCredential(user_id=current_user.id, cookie_header=encrypted))
    db.commit()
    logger.info("Upserted hiring.cafe credential for user %d", current_user.id)


@router.delete("/scraper/credentials", status_code=204)
async def delete_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    db.query(HiringCafeCredential).filter(
        HiringCafeCredential.user_id == current_user.id
    ).delete()
    db.commit()


@router.get("/scraper/credentials/status", response_model=CredentialStatusResponse)
async def get_credential_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CredentialStatusResponse:
    cred = db.query(HiringCafeCredential).filter(
        HiringCafeCredential.user_id == current_user.id
    ).first()
    if not cred:
        return CredentialStatusResponse(active=False, last_used=None, last_error=None)
    return CredentialStatusResponse(active=True, last_used=cred.updated_at, last_error=None)


# ── Saved Searches ────────────────────────────────────────────────────────────

@router.get("/scraper/searches", response_model=list[SavedSearchItem])
async def list_searches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SavedSearch]:
    return (
        db.query(SavedSearch)
        .filter(SavedSearch.user_id == current_user.id)
        .order_by(SavedSearch.created_at)
        .all()
    )


@router.post("/scraper/searches", response_model=SavedSearchItem, status_code=201)
async def create_search(
    request: SavedSearchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedSearch:
    count = db.query(SavedSearch).filter(SavedSearch.user_id == current_user.id).count()
    if count >= _MAX_SEARCHES_PER_USER:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_SEARCHES_PER_USER} saved searches allowed")
    search = SavedSearch(user_id=current_user.id, name=request.name, search_state=request.search_state)
    db.add(search)
    db.commit()
    db.refresh(search)
    return search


@router.patch("/scraper/searches/{search_id}", response_model=SavedSearchItem)
async def update_search(
    search_id: int,
    request: SavedSearchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedSearch:
    search = db.query(SavedSearch).filter(
        SavedSearch.id == search_id, SavedSearch.user_id == current_user.id
    ).first()
    if not search:
        raise HTTPException(status_code=404, detail="Search not found")
    if request.name is not None:
        search.name = request.name
    if request.is_active is not None:
        search.is_active = request.is_active
    db.commit()
    db.refresh(search)
    return search


@router.delete("/scraper/searches/{search_id}", status_code=204)
async def delete_search(
    search_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    deleted = db.query(SavedSearch).filter(
        SavedSearch.id == search_id, SavedSearch.user_id == current_user.id
    ).delete()
    if not deleted:
        raise HTTPException(status_code=404, detail="Search not found")
    db.commit()


# ── Scraped Jobs ──────────────────────────────────────────────────────────────

@router.get("/scraper/jobs", response_model=list[ScrapedJobItem])
async def list_scraped_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    rows = (
        db.query(ScrapedJob, SavedSearch.name.label("search_name"))
        .outerjoin(SavedSearch, ScrapedJob.saved_search_id == SavedSearch.id)
        .filter(ScrapedJob.user_id == current_user.id, ScrapedJob.is_read.is_(False))
        .order_by(ScrapedJob.found_at.desc())
        .all()
    )
    result = []
    for job, search_name in rows:
        item = ScrapedJobItem(
            id=job.id, object_id=job.object_id, apply_url=job.apply_url,
            title=job.title, company=job.company, description=job.description,
            found_at=job.found_at, is_read=job.is_read, analysis_id=job.analysis_id,
            saved_search_name=search_name,
        )
        result.append(item)
    return result


@router.post("/scraper/jobs/{job_id}/dismiss", status_code=204)
async def dismiss_scraped_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    job = db.query(ScrapedJob).filter(
        ScrapedJob.id == job_id, ScrapedJob.user_id == current_user.id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.is_read = True
    db.commit()


@router.post("/scraper/jobs/{job_id}/analyze", response_model=AnalyzeScrapedJobResponse)
async def analyze_scraped_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyzeScrapedJobResponse:
    from app.models.user_profile import UserProfile
    from app.api.analyze import _require_api_key, _get_active_profile

    job = db.query(ScrapedJob).filter(
        ScrapedJob.id == job_id, ScrapedJob.user_id == current_user.id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)

    try:
        result = run_claude(
            job_title=job.title,
            company=job.company,
            job_description=job.description,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    saved = save_analysis(
        db=db,
        job_title=job.title,
        company=job.company,
        job_description=job.description,
        result=result,
        url=job.apply_url,
        user_id=current_user.id,
        profile_id=profile.id,
        profile_name=profile.name,
    )

    job.is_read = True
    job.analysis_id = saved.id
    db.commit()

    return AnalyzeScrapedJobResponse(
        scraped_job_id=job.id,
        analysis_id=saved.id,
        fit_score=result.fit_score,
        should_apply=result.should_apply,
        one_line_verdict=result.one_line_verdict,
        direct_matches=result.direct_matches,
        transferable=result.transferable,
        gaps=result.gaps,
        red_flags=result.red_flags,
        green_flags=result.green_flags,
        salary_estimate=result.salary_estimate.model_dump() if result.salary_estimate else None,
    )
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/scraper.py
git commit -m "feat: add scraper API router (credentials, searches, scraped jobs)"
```

---

### Task 9: Register router and APScheduler in main.py

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Install APScheduler**

```bash
cd backend && pip install apscheduler
```

Add to `backend/requirements.txt`:
```
apscheduler
```

- [ ] **Step 2: Update main.py**

Replace the contents of `backend/app/main.py` with:

```python
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.analyze import router as analyze_router
from app.api.auth import router as auth_router
from app.api.reach import router as reach_router
from app.api.profiles import router as profiles_router
from app.api.keywords import router as keywords_router
from app.api.targeting import router as targeting_router
from app.api.scraper import router as scraper_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)


def _schedule_scraper(scheduler: AsyncIOScheduler) -> None:
    """Register one hourly job per active user, staggered by user_id."""
    from app.database import SessionLocal
    from app.models.scraper import HiringCafeCredential
    from app.services.scraper_poll import poll_user

    db = SessionLocal()
    try:
        user_ids = [row.user_id for row in db.query(HiringCafeCredential.user_id).all()]
    finally:
        db.close()

    for user_id in user_ids:
        minute_offset = user_id % 60
        scheduler.add_job(
            poll_user,
            "cron",
            minute=minute_offset,
            args=[user_id],
            id=f"scraper_user_{user_id}",
            replace_existing=True,
        )
        logger.info("Scheduled scraper for user %d at minute %d", user_id, minute_offset)

    if not user_ids:
        logger.info("No credentials registered — scraper not scheduled")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()
    _schedule_scraper(scheduler)
    scheduler.start()
    logger.info("APScheduler started")
    yield
    scheduler.shutdown()
    logger.info("APScheduler stopped")


logger.info("Starting JobScout API")

app = FastAPI(
    title="JobScout API",
    description="Real-time job fit scoring using Claude AI",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router, prefix="/api/v1", tags=["analysis"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(reach_router, prefix="/api/v1/reach", tags=["reach"])
app.include_router(profiles_router, prefix="/api/v1/profiles", tags=["profiles"])
app.include_router(keywords_router, prefix="/api/v1/keywords", tags=["keywords"])
app.include_router(targeting_router, prefix="/api/v1", tags=["targeting"])
app.include_router(scraper_router, prefix="/api/v1", tags=["scraper"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.2.0"}


_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "web")


@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/login.html")


@app.get("/{filename}")
async def serve_static(filename: str):
    file_path = os.path.join(_static_dir, filename)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")
```

**Note:** `_schedule_scraper` only registers jobs for users who already have credentials stored. New users get their job registered when they first POST to `/scraper/credentials` — add a helper call to `_schedule_scraper` in the credentials endpoint after the first upsert. For now, a restart picks up new users.

- [ ] **Step 3: Verify server starts**

```bash
cd backend && uvicorn app.main:app --reload
```

Expected: Server starts, log shows `APScheduler started`, no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py backend/requirements.txt
git commit -m "feat: register scraper router and APScheduler in main"
```

---

### Task 10: Extension — cookie sync on hiring.cafe navigation

**Files:**
- Modify: `extension/src/content/index.ts`
- Modify: `extension/src/background/index.ts`
- Modify: `extension/public/manifest.json`

- [ ] **Step 1: Add `cookies` permission to manifest**

Open `extension/public/manifest.json`. Add `"cookies"` to the `permissions` array:

```json
"permissions": ["storage", "cookies", "alarms", "notifications"]
```

(Add `"cookies"` to whatever permissions are already listed.)

- [ ] **Step 2: Send HIRING_CAFE_NAVIGATED from content script**

In `extension/src/content/index.ts`, at the top of the section that runs on hiring.cafe page load (where the URL matching happens), add:

```typescript
// Near the top of the hiring.cafe URL handler, after confirming we're on hiring.cafe:
if (window.location.hostname === 'hiring.cafe') {
  chrome.runtime.sendMessage({ type: 'HIRING_CAFE_NAVIGATED' });
}
```

Place this call in the same block that currently triggers `applyHCCardState` or similar hiring.cafe-specific logic. It should fire once per page load.

- [ ] **Step 3: Handle HIRING_CAFE_NAVIGATED in background worker**

In `extension/src/background/index.ts`, add a handler in the `chrome.runtime.onMessage` listener:

```typescript
if (message.type === 'HIRING_CAFE_NAVIGATED') {
  syncHiringCafeCookies();
  return;
}
```

Add the `syncHiringCafeCookies` function (outside the listener):

```typescript
async function syncHiringCafeCookies(): Promise<void> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'hiring.cafe' });
    if (cookies.length === 0) return;

    // Reconstruct a full Cookie header string
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const data = await chrome.storage.local.get('auth_jwt');
    const jwt = data.auth_jwt as string | undefined;
    if (!jwt) return;

    await fetch(`${BACKEND_URL}/api/v1/scraper/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ cookie_header: cookieHeader }),
    });
  } catch (err) {
    console.error('[JobScout] Failed to sync hiring.cafe cookies:', err);
  }
}
```

- [ ] **Step 4: Build and test manually**

```bash
cd extension && pnpm build
```

Load the extension in Chrome, navigate to hiring.cafe, open the background service worker console (`chrome://extensions` → JobScout → Service Worker). Verify no errors. Navigate to `hiring.cafe` and confirm the log shows no exceptions. Check that `POST /api/v1/scraper/credentials` returns 204 by watching the backend logs.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/index.ts extension/src/background/index.ts extension/public/manifest.json
git commit -m "feat: sync hiring.cafe cookies to backend on navigation"
```

---

### Task 11: Extension — "Watch this search" button

**Files:**
- Modify: `extension/src/content/index.ts`

- [ ] **Step 1: Add fetch interceptor and button injection**

In `extension/src/content/index.ts`, add the following code that runs on hiring.cafe pages. Place it near the existing hiring.cafe-specific initialization code:

```typescript
// ── Watch This Search ──────────────────────────────────────────────────────

let _lastSearchState: Record<string, unknown> | null = null;

function installSearchStateInterceptor(): void {
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/search-jobs') && url.includes('s=')) {
      try {
        const urlObj = new URL(url, window.location.origin);
        const sParam = urlObj.searchParams.get('s');
        if (sParam) {
          _lastSearchState = JSON.parse(decodeURIComponent(sParam));
        }
      } catch { /* ignore parse errors */ }
    }
    return origFetch(input, init);
  };
}

function injectWatchButton(): void {
  if (document.getElementById('js-watch-search-btn')) return;

  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('searchState')) return;

  const btn = document.createElement('button');
  btn.id = 'js-watch-search-btn';
  btn.textContent = '⭐ Watch this search';
  btn.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: #4ade80; color: #0f172a; border: none; border-radius: 8px;
    padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;

  btn.addEventListener('click', async () => {
    if (!_lastSearchState) {
      btn.textContent = '⚠ No search state captured yet — scroll to trigger a search';
      return;
    }

    const searchQuery: string = ((_lastSearchState as Record<string, unknown>)['searchQuery'] as string) || 'Saved Search';
    const name = `${searchQuery} (${new Date().toLocaleDateString()})`;

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REGISTER_SEARCH',
        payload: { name, search_state: _lastSearchState },
      });
      if (response?.ok) {
        btn.textContent = '✓ Watching';
        btn.style.background = '#1e293b';
        btn.style.color = '#4ade80';
      } else {
        btn.textContent = response?.error || 'Error — try again';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = 'Error — try again';
      btn.disabled = false;
    }
  });

  document.body.appendChild(btn);
}

// Initialize on hiring.cafe
if (window.location.hostname === 'hiring.cafe') {
  installSearchStateInterceptor();
  // Inject button after short delay to let the page framework mount
  setTimeout(injectWatchButton, 1500);
  // Re-check on URL changes (SPA navigation)
  const _origPushState = history.pushState.bind(history);
  history.pushState = function(...args) {
    _origPushState(...args);
    setTimeout(injectWatchButton, 1500);
  };
}
```

- [ ] **Step 2: Handle REGISTER_SEARCH in background worker**

In `extension/src/background/index.ts`, add inside the `chrome.runtime.onMessage` listener:

```typescript
if (message.type === 'REGISTER_SEARCH') {
  const { name, search_state } = message.payload;
  try {
    const data = await chrome.storage.local.get('auth_jwt');
    const jwt = data.auth_jwt as string | undefined;
    if (!jwt) { sendResponse({ ok: false, error: 'Not logged in' }); return; }

    const r = await fetch(`${BACKEND_URL}/api/v1/scraper/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ name, search_state }),
    });
    if (r.ok) {
      sendResponse({ ok: true });
    } else {
      const err = await r.json();
      sendResponse({ ok: false, error: err.detail || 'Failed to register search' });
    }
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
  return true; // keep message channel open for async response
}
```

- [ ] **Step 3: Build and test manually**

```bash
cd extension && pnpm build
```

Navigate to hiring.cafe, apply any filters, scroll so results load. The "Watch this search" button should appear in the bottom-right. Click it. Check backend logs for `POST /api/v1/scraper/searches 201`. Check `GET /api/v1/scraper/searches` returns the new entry.

- [ ] **Step 4: Commit**

```bash
git add extension/src/content/index.ts extension/src/background/index.ts
git commit -m "feat: inject Watch this search button on hiring.cafe"
```

---

### Task 12: Extension — per-click application status sync

**Files:**
- Modify: `extension/src/dashboard/index.ts`

- [ ] **Step 1: Find the cycleStatus function**

Search `extension/src/dashboard/index.ts` for the function that cycles through application statuses (likely called `cycleStatus` or similar — it writes to `chrome.storage.local` using the `status_<jobId>` key pattern and shows/hides status pills).

- [ ] **Step 2: Add per-click PATCH after storage write**

Inside the status cycle handler, after the `chrome.storage.local.set(...)` call, add a fire-and-forget PATCH:

```typescript
// After: await chrome.storage.local.set({ [`status_${jobId}`]: newStatus });
// Add:
(async () => {
  try {
    const stored = await chrome.storage.local.get([`score_jobid_${jobId}`, 'auth_jwt']);
    const jwt = stored.auth_jwt as string | undefined;
    const score = stored[`score_jobid_${jobId}`] as { dbId?: number } | undefined;
    const dbId = score?.dbId;
    if (!jwt || !dbId) return;

    await fetch(`${BACKEND_URL}/api/v1/job/${dbId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ status: newStatus }),
    });
  } catch { /* non-blocking */ }
})();
```

Replace `jobId` and `newStatus` with the actual variable names used in the dashboard code.

- [ ] **Step 3: Build and test manually**

```bash
cd extension && pnpm build
```

Open the extension dashboard. Click a status pill on any job that has a `dbId`. Check the backend logs for `PATCH /api/v1/job/{id}/status 200`. Verify the `status` column updated in the DB.

- [ ] **Step 4: Commit**

```bash
git add extension/src/dashboard/index.ts
git commit -m "feat: sync application status to backend on every status click"
```
