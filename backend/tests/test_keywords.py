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


from app.schemas.keyword import (
    BlocklistResponse,
    BlocklistAddRequest,
    SignalItem,
    SignalUpsertRequest,
)


def test_blocklist_response_has_terms():
    r = BlocklistResponse(terms=["sales", "driver"])
    assert r.terms == ["sales", "driver"]


def test_blocklist_add_request_has_term():
    r = BlocklistAddRequest(term="sales rep")
    assert r.term == "sales rep"


def test_signal_item_fields():
    s = SignalItem(ngram="data science", hide_count=3, show_count=1)
    assert s.ngram == "data science"
    assert s.hide_count == 3
    assert s.show_count == 1


def test_signal_upsert_request_is_list():
    r = SignalUpsertRequest(signals=[SignalItem(ngram="foo", hide_count=1, show_count=0)])
    assert len(r.signals) == 1


import ast
import pathlib


def test_keywords_router_exists():
    src = pathlib.Path("app/api/keywords.py").read_text()
    tree = ast.parse(src)
    names = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    assert "get_blocklist" in names
    assert "add_to_blocklist" in names
    assert "remove_from_blocklist" in names
    assert "get_signals" in names
    assert "upsert_signals" in names


def test_keywords_router_registered_in_main():
    src = pathlib.Path("app/main.py").read_text()
    assert "keywords_router" in src or "keywords" in src
