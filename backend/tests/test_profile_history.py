# backend/tests/test_profile_history.py
"""Tests for profile attribution on history feature."""
import pytest
from app.models.job import JobAnalysis


def test_job_analysis_has_profile_columns():
    """JobAnalysis model must expose profile_id and profile_name."""
    cols = {c.key for c in JobAnalysis.__table__.columns}
    assert "profile_id" in cols
    assert "profile_name" in cols
