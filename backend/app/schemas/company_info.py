from pydantic import BaseModel


class CompanyInfoRequest(BaseModel):
    company: str
    job_description: str = ""


class CompanyInfoResponse(BaseModel):
    employees: str | None = None
    website: str | None = None
    headquarters: str | None = None
    industry: str | None = None
