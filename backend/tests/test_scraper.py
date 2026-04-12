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
