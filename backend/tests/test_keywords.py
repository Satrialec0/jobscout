# backend/tests/test_keywords.py
from app.models.keyword import UserKeywordBlocklist, ProfileKeywordSignal


def test_user_keyword_blocklist_columns():
    cols = {c.key for c in UserKeywordBlocklist.__table__.columns}
    assert "id" in cols
    assert "user_id" in cols
    assert "term" in cols
    assert "created_at" in cols


def test_profile_keyword_signal_columns():
    cols = {c.key for c in ProfileKeywordSignal.__table__.columns}
    assert "id" in cols
    assert "profile_id" in cols
    assert "ngram" in cols
    assert "hide_count" in cols
    assert "show_count" in cols
    assert "updated_at" in cols
