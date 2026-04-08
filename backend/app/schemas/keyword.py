from pydantic import BaseModel, Field
from typing import List


class BlocklistResponse(BaseModel):
    terms: List[str]


class BlocklistAddRequest(BaseModel):
    term: str = Field(..., min_length=1, max_length=200)


class SignalItem(BaseModel):
    ngram: str = Field(..., min_length=1, max_length=200)
    hide_count: int = Field(..., ge=0)
    show_count: int = Field(..., ge=0)


class SignalUpsertRequest(BaseModel):
    signals: List[SignalItem]
