from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Any


class CredentialUpsertRequest(BaseModel):
    cookie_header: str  # full reconstructed Cookie header value (unencrypted)


class CredentialStatusResponse(BaseModel):
    active: bool
    last_used: datetime | None
    last_error: str | None


class SavedSearchCreate(BaseModel):
    name: str
    search_state: dict[str, Any]  # decoded JSON from s= parameter


class SavedSearchUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class SavedSearchItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_active: bool
    search_state: dict[str, Any]
    created_at: datetime
    last_polled: datetime | None


class ScrapedJobItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    object_id: str
    apply_url: str
    title: str
    company: str
    description: str
    found_at: datetime
    is_read: bool
    analysis_id: int | None
    saved_search_name: str | None  # joined from saved_searches


class AnalyzeScrapedJobResponse(BaseModel):
    """Returned when user clicks Analyze on a scraped job."""
    scraped_job_id: int
    analysis_id: int
    fit_score: int
    should_apply: bool
    one_line_verdict: str
    direct_matches: list
    transferable: list
    gaps: list
    red_flags: list[str]
    green_flags: list[str]
    salary_estimate: dict | None
