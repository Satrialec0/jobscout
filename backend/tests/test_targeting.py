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


from app.services.keyword_extractor import extract_keywords_from_resume


def test_extract_keywords_returns_list_for_empty_resume():
    result = extract_keywords_from_resume(None)
    assert result == []


def test_extract_keywords_returns_list_for_blank_resume():
    result = extract_keywords_from_resume("   ")
    assert result == []


import ast
import pathlib


def test_targeting_router_registered_in_main():
    src = pathlib.Path("app/main.py").read_text()
    assert "targeting_router" in src or "targeting" in src


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
