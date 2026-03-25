import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.schemas.analyze import AnalyzeRequest, AnalyzeResponse, JobHistoryItem
from app.schemas.interview_prep import InterviewPrepRequest, InterviewPrepResponse
from app.schemas.company_info import CompanyInfoRequest, CompanyInfoResponse
from app.services.claude import analyze_job
from app.models.repository import get_cached_analysis, save_analysis
from app.models.job import JobAnalysis
from app.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_dynamic_url(url: str) -> bool:
    """Returns True for URLs where multiple jobs share the same URL (e.g. hiring.cafe)."""
    return "hiring.cafe" in url


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_job_posting(
    request: AnalyzeRequest,
    db: Session = Depends(get_db)
) -> AnalyzeResponse:
    logger.info("Received analyze request: %s at %s", request.job_title, request.company)

    if request.url and not _is_dynamic_url(request.url):
        cached = get_cached_analysis(db, request.url)
        if cached:
            logger.info("Returning cached result for url: %s", request.url)
            salary_estimate = None
            if cached.salary_estimate:
                from app.schemas.analyze import SalaryEstimate
                try:
                    salary_estimate = SalaryEstimate(**cached.salary_estimate)
                except Exception:
                    pass

            return AnalyzeResponse(
                fit_score=cached.fit_score,
                should_apply=cached.should_apply,
                one_line_verdict=cached.one_line_verdict,
                direct_matches=cached.direct_matches,
                transferable=cached.transferable,
                gaps=cached.gaps,
                red_flags=cached.red_flags,
                green_flags=cached.green_flags,
                salary_estimate=salary_estimate,
            )

    elif request.url and _is_dynamic_url(request.url):
        cached = get_cached_analysis_by_title_company(
            db, request.job_title, request.company
        )
        if cached:
            logger.info(
                "Returning cached result for hiring.cafe job: %s at %s",
                request.job_title, request.company
            )
            salary_estimate = None
            if cached.salary_estimate:
                from app.schemas.analyze import SalaryEstimate
                try:
                    salary_estimate = SalaryEstimate(**cached.salary_estimate)
                except Exception:
                    pass

            return AnalyzeResponse(
                fit_score=cached.fit_score,
                should_apply=cached.should_apply,
                one_line_verdict=cached.one_line_verdict,
                direct_matches=cached.direct_matches,
                transferable=cached.transferable,
                gaps=cached.gaps,
                red_flags=cached.red_flags,
                green_flags=cached.green_flags,
                salary_estimate=salary_estimate,
            )

    try:
        result = analyze_job(
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description,
            listed_salary=request.listed_salary,
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
        url=request.url,
    )

    return result


def get_cached_analysis_by_title_company(
    db: Session,
    job_title: str,
    company: str
):
    """Cache lookup by job_title + company for sites with dynamic URLs."""
    return db.query(JobAnalysis)\
        .filter(
            JobAnalysis.job_title == job_title,
            JobAnalysis.company == company
        )\
        .order_by(JobAnalysis.created_at.desc())\
        .first()


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


@router.get("/score/{job_id}")
async def get_score_by_job_id(
    job_id: str,
    db: Session = Depends(get_db)
) -> dict:
    logger.info("Score lookup by job_id: %s", job_id)

    record = db.query(JobAnalysis)\
        .filter(JobAnalysis.url.contains(job_id))\
        .order_by(JobAnalysis.created_at.desc())\
        .first()

    if not record:
        raise HTTPException(status_code=404, detail="No score found for this job ID")

    return {
        "job_id": job_id,
        "fit_score": record.fit_score,
        "should_apply": record.should_apply,
        "one_line_verdict": record.one_line_verdict,
        "direct_matches": record.direct_matches,
        "transferable": record.transferable,
        "gaps": record.gaps,
        "red_flags": record.red_flags,
        "green_flags": record.green_flags,
        "job_title": record.job_title,
        "company": record.company,
        "job_description": record.job_description,
        "created_at": record.created_at.isoformat(),
        "salary_estimate": record.salary_estimate,
    }


@router.post("/company-info", response_model=CompanyInfoResponse)
async def get_company_info(request: CompanyInfoRequest) -> CompanyInfoResponse:
    logger.info("Extracting company info for: %s", request.company)
    from app.services.company_info import extract_company_info
    try:
        return extract_company_info(request)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during company info extraction")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/interview-prep", response_model=InterviewPrepResponse)
async def generate_interview_prep(request: InterviewPrepRequest) -> InterviewPrepResponse:
    logger.info("Generating interview prep for: %s at %s", request.job_title, request.company)
    from app.services.interview_prep import generate_prep_brief
    try:
        return generate_prep_brief(request)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during interview prep generation")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/applied/{job_id}")
async def mark_applied(
    job_id: str,
    db: Session = Depends(get_db)
) -> dict:
    logger.info("Marking job as applied: %s", job_id)

    record = db.query(JobAnalysis)\
        .filter(JobAnalysis.url.contains(job_id))\
        .order_by(JobAnalysis.created_at.desc())\
        .first()

    if not record:
        raise HTTPException(status_code=404, detail="No score found for this job ID")

    record.applied = True
    db.commit()
    logger.info("Marked job %s as applied", job_id)
    return {"job_id": job_id, "applied": True}