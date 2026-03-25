from pydantic import BaseModel


class InterviewPrepRequest(BaseModel):
    job_title: str
    company: str
    job_description: str = ""
    direct_matches: list[dict] = []
    transferable: list[dict] = []
    gaps: list[dict] = []
    green_flags: list[str] = []
    red_flags: list[str] = []


class QuestionWithTalkingPoint(BaseModel):
    question: str
    talking_points: list[str]


class GapStrategy(BaseModel):
    gap: str
    strategy: str


class InterviewPrepResponse(BaseModel):
    questions: list[QuestionWithTalkingPoint]
    research_prompts: list[str]
    gap_strategies: list[GapStrategy]
    questions_to_ask: list[str] = []
