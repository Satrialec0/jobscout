from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AnalyzeRequest(BaseModel):
    job_title: str
    company: str
    job_description: str
    url: Optional[str] = None
    listed_salary: Optional[str] = None


class ScoreCategory(BaseModel):
    item: str
    detail: str


class SalaryEstimate(BaseModel):
    low: int
    high: int
    currency: str = "USD"
    per: str = "year"
    confidence: str
    assessment: Optional[str] = None


class AnalyzeResponse(BaseModel):
    fit_score: int
    should_apply: bool
    one_line_verdict: str
    direct_matches: list[ScoreCategory]
    transferable: list[ScoreCategory]
    gaps: list[ScoreCategory]
    red_flags: list[str]
    green_flags: list[str]
    salary_estimate: Optional[SalaryEstimate] = None
    db_id: Optional[int] = None


class JobHistoryItem(BaseModel):
    id: int
    url: Optional[str]
    job_title: str
    company: str
    fit_score: int
    should_apply: bool
    one_line_verdict: str
    created_at: datetime
    status: Optional[str] = None
    applied_date: Optional[datetime] = None
    notes: Optional[str] = None
    salary_estimate: Optional[dict] = None
    direct_matches: list = []
    transferable: list = []
    gaps: list = []
    red_flags: list[str] = []
    green_flags: list[str] = []

    class Config:
        from_attributes = True


class UpdateStatusRequest(BaseModel):
    status: Optional[str] = None
    applied_date: Optional[datetime] = None
    notes: Optional[str] = None


class ClaimItem(BaseModel):
    job_id: str
    title: str = ""
    company: str = ""


class ClaimRequest(BaseModel):
    jobs: list[ClaimItem]


class ClaimResult(BaseModel):
    job_id: str
    db_id: int


class PushStatusItem(BaseModel):
    job_id: str
    title: str
    company: str
    status: str


class PushStatusRequest(BaseModel):
    jobs: list[PushStatusItem]