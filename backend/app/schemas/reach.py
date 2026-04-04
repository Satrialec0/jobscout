from pydantic import BaseModel
from typing import Optional


class ReachJobInput(BaseModel):
    job_id: str
    title: str
    company: str
    url: str
    site: str
    skills: Optional[list[str]] = None
    description: Optional[str] = None
    score: Optional[int] = None
    verdict: Optional[str] = None
    gaps: Optional[list[dict]] = None


class ClusterRequest(BaseModel):
    jobs: list[ReachJobInput]


class ClusterResult(BaseModel):
    job_id: str
    group_name: str
    group_id: str


class ClusterResponse(BaseModel):
    groups: list[ClusterResult]


class ReachAnalyzeRequest(BaseModel):
    group_name: str
    jobs: list[ReachJobInput]


class SkillTheme(BaseModel):
    skill: str
    frequency: int
    detail: str


class ExperienceGap(BaseModel):
    gap: str
    detail: str


class ActionableStep(BaseModel):
    step: str
    detail: str


class ReachAnalyzeResponse(BaseModel):
    group_name: str
    skill_themes: list[SkillTheme]
    experience_gaps: list[ExperienceGap]
    actionable_steps: list[ActionableStep]
    summary: str
