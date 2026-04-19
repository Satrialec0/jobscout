from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from app.models.user_profile import DEFAULT_INSTRUCTIONS


class ProfileCreate(BaseModel):
    name: str = Field(..., max_length=100)
    resume_text: Optional[str] = None
    instructions: str = DEFAULT_INSTRUCTIONS
    app_assist_instructions: Optional[str] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    resume_text: Optional[str] = None
    instructions: Optional[str] = None
    app_assist_instructions: Optional[str] = None


class ProfileResponse(BaseModel):
    id: int
    name: str
    resume_text: Optional[str]
    instructions: str
    app_assist_instructions: Optional[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ParseResumeResponse(BaseModel):
    text: str


class ActiveProfileResponse(BaseModel):
    id: int
    name: str
