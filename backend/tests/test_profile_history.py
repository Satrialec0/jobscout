# backend/tests/test_profile_history.py
"""Tests for profile attribution on history feature."""
import pytest
from app.models.job import JobAnalysis


def test_job_analysis_has_profile_columns():
    """JobAnalysis model must expose profile_id and profile_name."""
    cols = {c.key for c in JobAnalysis.__table__.columns}
    assert "profile_id" in cols
    assert "profile_name" in cols


from app.schemas.analyze import JobHistoryItem
from app.schemas.profile import ActiveProfileResponse


def test_job_history_item_has_profile_fields():
    """JobHistoryItem must include optional profile_id and profile_name."""
    fields = JobHistoryItem.model_fields
    assert "profile_id" in fields
    assert "profile_name" in fields


def test_active_profile_response_schema():
    """ActiveProfileResponse must have id and name."""
    r = ActiveProfileResponse(id=1, name="Senior IC")
    assert r.id == 1
    assert r.name == "Senior IC"


import inspect
from app.models.repository import save_analysis


def test_save_analysis_accepts_profile_params():
    """save_analysis must accept profile_id and profile_name keyword args."""
    sig = inspect.signature(save_analysis)
    assert "profile_id" in sig.parameters
    assert "profile_name" in sig.parameters
