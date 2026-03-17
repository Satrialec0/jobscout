import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.schemas.analyze import AnalyzeRequest, AnalyzeResponse, JobHistoryItem
from app.services.claude import analyze_job
from app.models.repository import get_cached_analysis, save_analysis
from app.models.job import JobAnalysis
from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_job_posting(
    request: AnalyzeRequest,
    db: Session = Depends(get_db)
) -> AnalyzeResponse:
    logger.info("Received analyze request: %s at %s", request.job_title, request.company)

    if request.url:
        cached = get_cached_analysis(db, request.url)
        if cached:
            logger.info("Returning cached result for url: %s", request.url)
            return AnalyzeResponse(
                fit_score=cached.fit_score,
                should_apply=cached.should_apply,
                one_line_verdict=cached.one_line_verdict,
                direct_matches=cached.direct_matches,
                transferable=cached.transferable,
                gaps=cached.gaps,
                red_flags=cached.red_flags,
                green_flags=cached.green_flags,
            )

    try:
        result = analyze_job(
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description
        )
        logger.info("Analysis complete, fit_score: %s", result.fit_score)

    except ValueError as e:
        logger.warning("Analysis failed with validation error: %s", e)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error during analysis")
        raise HTTPException(status_code=500, detail="Internal server error")

    save_analysis(
        db=db,
        job_title=request.job_title,
        company=request.company,
        job_description=request.job_description,
        result=result,
        url=request.url
    )

    return result


@router.get("/history", response_model=list[JobHistoryItem])
async def get_history(
    db: Session = Depends(get_db),
    limit: int = 20
) -> list[JobHistoryItem]:
    logger.info("Fetching job history, limit: %s", limit)
    records = db.query(JobAnalysis)\
        .order_by(JobAnalysis.created_at.desc())\
        .limit(limit)\
        .all()
    return records