from app.models.scraper import HiringCafeCredential, SavedSearch, ScrapedJob
from app.schemas.scraper import (
    CredentialUpsertRequest,
    CredentialStatusResponse,
    SavedSearchCreate,
    SavedSearchUpdate,
    SavedSearchItem,
    ScrapedJobItem,
)
from datetime import datetime, timezone


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


# ── Schema tests ──────────────────────────────────────────────────────────────

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


# ── Email service tests ───────────────────────────────────────────────────────

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
