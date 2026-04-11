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
