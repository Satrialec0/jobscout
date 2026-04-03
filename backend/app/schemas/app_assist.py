from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class CoverLetterRequest(BaseModel):
    job_title: str
    company: str
    job_description: str = ""
    direct_matches: list[dict] = []
    transferable: list[dict] = []
    gaps: list[dict] = []
    green_flags: list[str] = []
    red_flags: list[str] = []
    length: Literal["short", "medium", "long"] = "medium"


class CoverLetterResponse(BaseModel):
    cover_letter: str


class AppQuestionRequest(BaseModel):
    job_title: str
    company: str
    job_description: str = ""
    direct_matches: list[dict] = []
    transferable: list[dict] = []
    gaps: list[dict] = []
    question: str


class AppQuestionResponse(BaseModel):
    answer: str


class AppAssistData(BaseModel):
    cover_letter: str | None = None
    cover_letter_length: str | None = None
    salary_ask: int | None = None
    questions: list[dict] = []
    updated_at: datetime | None = None
