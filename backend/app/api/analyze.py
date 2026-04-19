import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.orm import Session
from app.schemas.analyze import AnalyzeRequest, AnalyzeResponse, JobHistoryItem, UpdateStatusRequest, ClaimRequest, ClaimResult, ClaimItem, PushStatusRequest
from app.schemas.interview_prep import InterviewPrepRequest, InterviewPrepResponse
from app.schemas.company_info import CompanyInfoRequest, CompanyInfoResponse
from app.schemas.app_assist import CoverLetterRequest, CoverLetterResponse, AppQuestionRequest, AppQuestionResponse, AppAssistData
from app.services.claude import analyze_job
from app.models.repository import get_cached_analysis, save_analysis, update_job_status
from app.models.job import JobAnalysis
from app.models.application_data import ApplicationData
from app.models.user import User
from app.models.user_profile import UserProfile
from app.database import get_db
from app.api.deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_dynamic_url(url: str) -> bool:
    """Returns True for URLs where multiple jobs share the same URL (e.g. hiring.cafe)."""
    return "hiring.cafe" in url


def _require_api_key(user: User) -> str:
    if not user.anthropic_api_key:
        raise HTTPException(
            status_code=402,
            detail="No API key configured. Please add your Anthropic API key in Settings.",
        )
    from app.services.encryption import decrypt
    return decrypt(user.anthropic_api_key)


def _get_active_profile(user_id: int, db: Session) -> UserProfile:
    """Fetch the user's active profile. Raises 400 if none is set."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == user_id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        raise HTTPException(
            status_code=400,
            detail="No active profile found. Please create and activate a profile in the dashboard before analyzing jobs.",
        )
    return profile


def _build_analyze_response(cached: JobAnalysis) -> AnalyzeResponse:
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
        db_id=cached.id,
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_job_posting(
    request: AnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyzeResponse:
    logger.info("Received analyze request: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)

    cached_result = None
    if request.url and not _is_dynamic_url(request.url):
        cached_result = get_cached_analysis(db, request.url)
    elif request.url and _is_dynamic_url(request.url):
        cached_result = get_cached_analysis_by_title_company(db, request.job_title, request.company)

    if cached_result:
        # Check if this user already has their own row for this job
        user_row = (
            db.query(JobAnalysis)
            .filter(JobAnalysis.url == request.url, JobAnalysis.user_id == current_user.id)
            .order_by(JobAnalysis.created_at.desc())
            .first()
        ) if request.url else None

        if user_row:
            logger.info("Returning user's cached result for url: %s", request.url)
            return _build_analyze_response(user_row)

        # Reuse cached Claude result but save a new row for this user
        logger.info("Saving cached result for new user: %s", request.url)
        response = _build_analyze_response(cached_result)
        new_row = save_analysis(
            db=db,
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description,
            result=response,
            url=request.url,
            user_id=current_user.id,
            profile_id=profile.id,
            profile_name=profile.name,
        )
        response.db_id = new_row.id
        return response

    try:
        result = analyze_job(
            job_title=request.job_title,
            company=request.company,
            job_description=request.job_description,
            listed_salary=request.listed_salary,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
        logger.info("Analysis complete, fit_score: %s", result.fit_score)
    except ValueError as e:
        logger.warning("Analysis failed with validation error: %s", e)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during analysis")
        raise HTTPException(status_code=500, detail="Internal server error")

    saved = save_analysis(
        db=db,
        job_title=request.job_title,
        company=request.company,
        job_description=request.job_description,
        result=result,
        url=request.url,
        user_id=current_user.id,
        profile_id=profile.id,
        profile_name=profile.name,
    )
    result.db_id = saved.id
    return result


def get_cached_analysis_by_title_company(db: Session, job_title: str, company: str):
    """Cache lookup by job_title + company for sites with dynamic URLs."""
    return (
        db.query(JobAnalysis)
        .filter(JobAnalysis.job_title == job_title, JobAnalysis.company == company)
        .order_by(JobAnalysis.created_at.desc())
        .first()
    )


@router.get("/history/stats")
async def get_history_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    profile_id: Optional[int] = None,
) -> dict:
    from sqlalchemy import func, case
    q = db.query(JobAnalysis).filter(JobAnalysis.user_id == current_user.id)
    if profile_id is not None:
        q = q.filter(JobAnalysis.profile_id == profile_id)
    total = q.count()
    recs = q.filter(JobAnalysis.should_apply == True).count()
    high = q.filter(JobAnalysis.fit_score >= 70).count()
    avg_row = db.query(func.avg(JobAnalysis.fit_score)).filter(
        JobAnalysis.user_id == current_user.id,
        *([JobAnalysis.profile_id == profile_id] if profile_id is not None else []),
    ).scalar()
    avg_score = round(avg_row or 0)
    statuses = {
        "applied": 0, "phone_screen": 0, "interviewed": 0, "offer": 0, "rejected": 0,
    }
    for row in (
        db.query(JobAnalysis.status, func.count())
        .filter(JobAnalysis.user_id == current_user.id, JobAnalysis.status.isnot(None))
        .group_by(JobAnalysis.status)
        .all()
    ):
        if row[0] in statuses:
            statuses[row[0]] = row[1]
    applied_count = statuses["applied"]
    response_rate = round(statuses["phone_screen"] / applied_count * 100) if applied_count else 0
    offer_rate = round(statuses["offer"] / applied_count * 100) if applied_count else 0
    return {
        "total": total,
        "recs": recs,
        "high_score": high,
        "avg_score": avg_score,
        **statuses,
        "response_rate": response_rate,
        "offer_rate": offer_rate,
    }


@router.get("/history", response_model=list[JobHistoryItem])
async def get_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 25,
    offset: int = 0,
    search: Optional[str] = None,
    status: Optional[str] = None,
    site: Optional[str] = None,
    min_score: Optional[int] = None,
    max_score: Optional[int] = None,
    recommend: Optional[bool] = None,
    applied: Optional[bool] = None,
    days: Optional[int] = None,
    profile_id: Optional[int] = None,
) -> list[JobHistoryItem]:
    from datetime import timedelta
    query = db.query(JobAnalysis).filter(JobAnalysis.user_id == current_user.id)
    if search:
        term = f"%{search}%"
        query = query.filter(
            JobAnalysis.job_title.ilike(term) | JobAnalysis.company.ilike(term)
        )
    if status:
        query = query.filter(JobAnalysis.status == status)
    if site:
        query = query.filter(JobAnalysis.url.ilike(f"%{site}%"))
    if min_score is not None:
        query = query.filter(JobAnalysis.fit_score >= min_score)
    if max_score is not None:
        query = query.filter(JobAnalysis.fit_score <= max_score)
    if recommend is not None:
        query = query.filter(JobAnalysis.should_apply == recommend)
    if applied is True:
        query = query.filter(JobAnalysis.status.isnot(None))
    elif applied is False:
        query = query.filter(JobAnalysis.status.is_(None))
    if days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.filter(JobAnalysis.created_at >= cutoff)
    if profile_id is not None:
        query = query.filter(JobAnalysis.profile_id == profile_id)
    records = (
        query
        .order_by(JobAnalysis.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    logger.info(
        "Fetching history for user %s: limit=%s offset=%s status=%s",
        current_user.id, limit, offset, status,
    )
    return records


@router.get("/score/{job_id}")
async def get_score_by_job_id(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    logger.info("Score lookup by job_id: %s for user %s", job_id, current_user.id)

    record = (
        db.query(JobAnalysis)
        .filter(JobAnalysis.url.contains(job_id), JobAnalysis.user_id == current_user.id)
        .order_by(JobAnalysis.created_at.desc())
        .first()
    )

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
        "db_id": record.id,
    }


@router.get("/job/{db_id}")
async def get_job_by_db_id(
    db_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Fetch job data by database row ID. Used by the dashboard re-analyze flow."""
    record = (
        db.query(JobAnalysis)
        .filter(JobAnalysis.id == db_id, JobAnalysis.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "db_id": record.id,
        "job_title": record.job_title,
        "company": record.company,
        "job_description": record.job_description,
        "url": record.url,
    }


@router.patch("/job/{db_id}/status", response_model=JobHistoryItem)
async def patch_job_status(
    db_id: int,
    request: UpdateStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobAnalysis:
    record = update_job_status(
        db=db,
        db_id=db_id,
        user_id=current_user.id,
        status=request.status,
        applied_date=request.applied_date,
        notes=request.notes,
    )
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return record


@router.post("/company-info", response_model=CompanyInfoResponse)
async def get_company_info(
    request: CompanyInfoRequest,
    current_user: User = Depends(get_current_user),
) -> CompanyInfoResponse:
    logger.info("Extracting company info for: %s", request.company)
    api_key = _require_api_key(current_user)
    from app.services.company_info import extract_company_info
    try:
        return extract_company_info(request, api_key=api_key)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during company info extraction")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/interview-prep", response_model=InterviewPrepResponse)
async def generate_interview_prep(
    request: InterviewPrepRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InterviewPrepResponse:
    logger.info("Generating interview prep for: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.interview_prep import generate_prep_brief
    try:
        return generate_prep_brief(
            request,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during interview prep generation")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/history/claim", response_model=list[ClaimResult])
async def claim_jobs(
    request: ClaimRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ClaimResult]:
    """Backfill db_id for jobs missing it in local storage.
    Pass 1: URL substring match (works for LinkedIn/Indeed).
    Pass 2: title+company match (fallback for Hiring.cafe and other non-URL-keyed jobs)."""
    results: list[ClaimResult] = []
    unmatched: list[ClaimItem] = []

    for item in request.jobs:
        if not item.job_id:
            continue
        row = (
            db.query(JobAnalysis)
            .filter(
                JobAnalysis.url.contains(item.job_id),
                JobAnalysis.user_id == current_user.id,
            )
            .order_by(JobAnalysis.created_at.desc())
            .first()
        )
        if row:
            results.append(ClaimResult(job_id=item.job_id, db_id=row.id))
        else:
            unmatched.append(item)

    # Title+company fallback for jobs whose ID isn't in their URL (e.g. Hiring.cafe)
    for item in unmatched:
        if not item.title or not item.company:
            continue
        row = (
            db.query(JobAnalysis)
            .filter(
                JobAnalysis.job_title == item.title,
                JobAnalysis.company == item.company,
                JobAnalysis.user_id == current_user.id,
            )
            .order_by(JobAnalysis.created_at.desc())
            .first()
        )
        if row:
            results.append(ClaimResult(job_id=item.job_id, db_id=row.id))

    logger.info("Backfilled db_id for %d/%d jobs for user %d", len(results), len(request.jobs), current_user.id)
    return results


@router.post("/history/push-statuses", response_model=list[ClaimResult])
async def push_statuses(
    request: PushStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ClaimResult]:
    """Push local statuses to the backend, one unique DB row per ext_job_id.
    Finds an existing row by ext_job_id first, then falls back to title+company,
    then creates a minimal new row. Returns job_id→db_id mapping."""
    results: list[ClaimResult] = []
    for item in request.jobs:
        # 1. Already have a row for this exact extension job ID?
        row = (
            db.query(JobAnalysis)
            .filter(JobAnalysis.ext_job_id == item.job_id, JobAnalysis.user_id == current_user.id)
            .first()
        )
        if row:
            row.status = item.status
            db.commit()
            results.append(ClaimResult(job_id=item.job_id, db_id=row.id))
            continue

        # 2. Find any unclaimed row (no ext_job_id) by title+company and claim it
        unclaimed = (
            db.query(JobAnalysis)
            .filter(
                JobAnalysis.job_title == item.title,
                JobAnalysis.company == item.company,
                JobAnalysis.user_id == current_user.id,
                JobAnalysis.ext_job_id.is_(None),
            )
            .order_by(JobAnalysis.created_at.desc())
            .first()
        )
        if unclaimed:
            unclaimed.ext_job_id = item.job_id
            unclaimed.status = item.status
            db.commit()
            results.append(ClaimResult(job_id=item.job_id, db_id=unclaimed.id))
            continue

        # 3. No matching row at all — create a minimal placeholder row
        new_row = JobAnalysis(
            url=None,
            job_title=item.title,
            company=item.company,
            job_description="",
            fit_score=0,
            should_apply=False,
            one_line_verdict="",
            direct_matches=[],
            transferable=[],
            gaps=[],
            red_flags=[],
            green_flags=[],
            user_id=current_user.id,
            ext_job_id=item.job_id,
            status=item.status,
        )
        db.add(new_row)
        db.commit()
        db.refresh(new_row)
        results.append(ClaimResult(job_id=item.job_id, db_id=new_row.id))

    logger.info("Pushed statuses for %d jobs for user %d", len(results), current_user.id)
    return results


@router.post("/cover-letter", response_model=CoverLetterResponse)
async def generate_cover_letter_endpoint(
    request: CoverLetterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CoverLetterResponse:
    logger.info("Generating cover letter for: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.cover_letter import generate_cover_letter
    try:
        return generate_cover_letter(
            request,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during cover letter generation")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/app-question", response_model=AppQuestionResponse)
async def generate_app_question_endpoint(
    request: AppQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppQuestionResponse:
    logger.info("Generating app answer for: %s at %s", request.job_title, request.company)
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.app_questions import generate_app_answer
    try:
        return generate_app_answer(
            request,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.app_assist_instructions or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during app question generation")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/app-assist/{db_id}", response_model=AppAssistData)
async def get_app_assist(
    db_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppAssistData:
    row = (
        db.query(ApplicationData)
        .filter(ApplicationData.job_analysis_id == db_id, ApplicationData.user_id == current_user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="No application data found")
    return AppAssistData(
        cover_letter=row.cover_letter,
        cover_letter_length=row.cover_letter_length,
        salary_ask=row.salary_ask,
        questions=row.questions or [],
        updated_at=row.updated_at,
    )


@router.put("/app-assist/{db_id}", response_model=AppAssistData)
async def upsert_app_assist(
    db_id: int,
    request: AppAssistData,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AppAssistData:
    # Verify job belongs to this user
    job = (
        db.query(JobAnalysis)
        .filter(JobAnalysis.id == db_id, JobAnalysis.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    row = (
        db.query(ApplicationData)
        .filter(ApplicationData.job_analysis_id == db_id, ApplicationData.user_id == current_user.id)
        .first()
    )
    if row:
        row.cover_letter = request.cover_letter
        row.cover_letter_length = request.cover_letter_length
        row.salary_ask = request.salary_ask
        row.questions = request.questions
    else:
        row = ApplicationData(
            job_analysis_id=db_id,
            user_id=current_user.id,
            cover_letter=request.cover_letter,
            cover_letter_length=request.cover_letter_length,
            salary_ask=request.salary_ask,
            questions=request.questions,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return AppAssistData(
        cover_letter=row.cover_letter,
        cover_letter_length=row.cover_letter_length,
        salary_ask=row.salary_ask,
        questions=row.questions or [],
        updated_at=row.updated_at,
    )


@router.post("/applied/{job_id}")
async def mark_applied(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    logger.info("Marking job as applied: %s for user %s", job_id, current_user.id)

    record = (
        db.query(JobAnalysis)
        .filter(JobAnalysis.url.contains(job_id), JobAnalysis.user_id == current_user.id)
        .order_by(JobAnalysis.created_at.desc())
        .first()
    )

    if not record:
        raise HTTPException(status_code=404, detail="No score found for this job ID")

    record.applied = True
    record.status = "applied"
    if not record.applied_date:
        record.applied_date = datetime.now(timezone.utc)
    db.commit()
    logger.info("Marked job %s as applied", job_id)
    return {"job_id": job_id, "applied": True}
