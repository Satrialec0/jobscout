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


# ── hiring.cafe fetch service tests ──────────────────────────────────────────

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
