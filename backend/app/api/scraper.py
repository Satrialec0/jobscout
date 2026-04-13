import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.scraper import HiringCafeCredential, SavedSearch, ScrapedJob
from app.models.user import User
from app.schemas.scraper import (
    CredentialUpsertRequest,
    CredentialStatusResponse,
    SavedSearchCreate,
    SavedSearchUpdate,
    SavedSearchItem,
    ScrapedJobItem,
    AnalyzeScrapedJobResponse,
)
from app.services.encryption import encrypt
from app.services.claude import analyze_job as run_claude
from app.models.repository import save_analysis
from app.api.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_SEARCHES_PER_USER = 5


# ── Credentials ───────────────────────────────────────────────────────────────

@router.post("/scraper/credentials", status_code=204)
async def upsert_credentials(
    request: CredentialUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    encrypted = encrypt(request.cookie_header)
    existing = db.query(HiringCafeCredential).filter(
        HiringCafeCredential.user_id == current_user.id
    ).first()
    if existing:
        existing.cookie_header = encrypted
    else:
        db.add(HiringCafeCredential(user_id=current_user.id, cookie_header=encrypted))
    db.commit()
    logger.info("Upserted hiring.cafe credential for user %d", current_user.id)


@router.delete("/scraper/credentials", status_code=204)
async def delete_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    db.query(HiringCafeCredential).filter(
        HiringCafeCredential.user_id == current_user.id
    ).delete()
    db.commit()


@router.get("/scraper/credentials/status", response_model=CredentialStatusResponse)
async def get_credential_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CredentialStatusResponse:
    cred = db.query(HiringCafeCredential).filter(
        HiringCafeCredential.user_id == current_user.id
    ).first()
    if not cred:
        return CredentialStatusResponse(active=False, last_used=None, last_error=None)
    return CredentialStatusResponse(active=True, last_used=cred.updated_at, last_error=None)


# ── Saved Searches ─────────────────────────────────────────────────────────────

@router.get("/scraper/searches", response_model=list[SavedSearchItem])
async def list_searches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SavedSearch]:
    return (
        db.query(SavedSearch)
        .filter(SavedSearch.user_id == current_user.id)
        .order_by(SavedSearch.created_at)
        .all()
    )


@router.post("/scraper/searches", response_model=SavedSearchItem, status_code=201)
async def create_search(
    request: SavedSearchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedSearch:
    count = db.query(SavedSearch).filter(SavedSearch.user_id == current_user.id).count()
    if count >= _MAX_SEARCHES_PER_USER:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_SEARCHES_PER_USER} saved searches allowed")
    search = SavedSearch(user_id=current_user.id, name=request.name, search_state=request.search_state)
    db.add(search)
    db.commit()
    db.refresh(search)
    return search


@router.patch("/scraper/searches/{search_id}", response_model=SavedSearchItem)
async def update_search(
    search_id: int,
    request: SavedSearchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedSearch:
    search = db.query(SavedSearch).filter(
        SavedSearch.id == search_id, SavedSearch.user_id == current_user.id
    ).first()
    if not search:
        raise HTTPException(status_code=404, detail="Search not found")
    if request.name is not None:
        search.name = request.name
    if request.is_active is not None:
        search.is_active = request.is_active
    db.commit()
    db.refresh(search)
    return search


@router.delete("/scraper/searches/{search_id}", status_code=204)
async def delete_search(
    search_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    deleted = db.query(SavedSearch).filter(
        SavedSearch.id == search_id, SavedSearch.user_id == current_user.id
    ).delete()
    if not deleted:
        raise HTTPException(status_code=404, detail="Search not found")
    db.commit()


# ── Scraped Jobs ───────────────────────────────────────────────────────────────

@router.get("/scraper/jobs", response_model=list[ScrapedJobItem])
async def list_scraped_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ScrapedJobItem]:
    rows = (
        db.query(ScrapedJob, SavedSearch.name.label("search_name"))
        .outerjoin(SavedSearch, ScrapedJob.saved_search_id == SavedSearch.id)
        .filter(ScrapedJob.user_id == current_user.id, ScrapedJob.is_read.is_(False))
        .order_by(ScrapedJob.found_at.desc())
        .all()
    )
    return [
        ScrapedJobItem(
            id=job.id, object_id=job.object_id, apply_url=job.apply_url,
            title=job.title, company=job.company, description=job.description,
            found_at=job.found_at, is_read=job.is_read, analysis_id=job.analysis_id,
            saved_search_name=search_name,
        )
        for job, search_name in rows
    ]


@router.post("/scraper/jobs/{job_id}/dismiss", status_code=204)
async def dismiss_scraped_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    job = db.query(ScrapedJob).filter(
        ScrapedJob.id == job_id, ScrapedJob.user_id == current_user.id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.is_read = True
    db.commit()


@router.post("/scraper/jobs/{job_id}/analyze", response_model=AnalyzeScrapedJobResponse)
async def analyze_scraped_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyzeScrapedJobResponse:
    from app.api.analyze import _require_api_key, _get_active_profile

    job = db.query(ScrapedJob).filter(
        ScrapedJob.id == job_id, ScrapedJob.user_id == current_user.id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)

    try:
        result = run_claude(
            job_title=job.title,
            company=job.company,
            job_description=job.description,
            api_key=api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    saved = save_analysis(
        db=db,
        job_title=job.title,
        company=job.company,
        job_description=job.description,
        result=result,
        url=job.apply_url,
        user_id=current_user.id,
        profile_id=profile.id,
        profile_name=profile.name,
    )

    job.is_read = True
    job.analysis_id = saved.id
    db.commit()

    return AnalyzeScrapedJobResponse(
        scraped_job_id=job.id,
        analysis_id=saved.id,
        fit_score=result.fit_score,
        should_apply=result.should_apply,
        one_line_verdict=result.one_line_verdict,
        direct_matches=result.direct_matches,
        transferable=result.transferable,
        gaps=result.gaps,
        red_flags=result.red_flags,
        green_flags=result.green_flags,
        salary_estimate=result.salary_estimate.model_dump() if result.salary_estimate else None,
    )
