import logging
from fastapi import APIRouter, HTTPException
from app.schemas.analyze import AnalyzeRequest, AnalyzeResponse
from app.services.claude import analyze_job

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_job_posting(request: AnalyzeRequest) -> AnalyzeResponse:
    logger.info("Received analyze request: %s at %s", request.job_title, request.company)

    try:
        result = analyze_job(
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description
        )
        logger.info("Analysis complete, fit_score: %s", result.fit_score)
        return result

    except ValueError as e:
        logger.warning("Analysis failed with validation error: %s", e)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error during analysis")
        raise HTTPException(status_code=500, detail="Internal server error")