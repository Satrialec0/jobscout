from typing import List, Optional
from pydantic import BaseModel, Field


class TargetKeywordItem(BaseModel):
    id: int
    keyword: str
    source: str  # 'resume' | 'learned'


class TargetKeywordAddRequest(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=200)
    source: str = Field(default="learned")


class TargetSignalItem(BaseModel):
    ngram: str = Field(..., min_length=1, max_length=200)
    target_count: int = Field(..., ge=0)
    show_count: int = Field(..., ge=0)


class TargetSignalUpsertRequest(BaseModel):
    signals: List[TargetSignalItem]


class CompanyItem(BaseModel):
    id: int
    name: str
    list_type: str
    profile_id: Optional[int]


class CompanyAddRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)
    profile_id: Optional[int] = None  # None = global block


class CompaniesResponse(BaseModel):
    targets: List[CompanyItem]
    blocks: List[CompanyItem]
