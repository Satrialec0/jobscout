from fastapi import APIRouter, HTTPException
from app.schemas.analyze import AnalyzeRequest, AnalyzeResponse
from app.services.claude import analyze_job

print("[api/analyze.py] Loading analyze router")

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_job_posting(request: AnalyzeRequest) -> AnalyzeResponse:
    print(f"[api/analyze.py] Received request: {request.job_title} at {request.company}")

    try:
        result = analyze_job(
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description
        )
        print(f"[api/analyze.py] Analysis complete, fit_score: {result.fit_score}")
        return result

    except Exception as e:
        print(f"[api/analyze.py] Error during analysis: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))