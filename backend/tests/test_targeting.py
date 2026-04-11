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
