from pydantic import BaseModel
from typing import Optional


class AnalyzeRequest(BaseModel):
    job_title: str
    company: str
    job_description: str
    url: Optional[str] = None


class ScoreCategory(BaseModel):
    item: str
    detail: str


class AnalyzeResponse(BaseModel):
    fit_score: int
    should_apply: bool
    one_line_verdict: str
    direct_matches: list[ScoreCategory]
    transferable: list[ScoreCategory]
    gaps: list[ScoreCategory]
    red_flags: list[str]
    green_flags: list[str]