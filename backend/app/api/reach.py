import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.reach import (
    ClusterRequest,
    ClusterResponse,
    ReachAnalyzeRequest,
    ReachAnalyzeResponse,
)
from app.models.user import User
from app.models.user_profile import UserProfile
from app.api.deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_active_profile(user_id: int, db: Session) -> UserProfile:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == user_id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        raise HTTPException(
            status_code=400,
            detail="No active profile found. Please create and activate a profile in the dashboard.",
        )
    return profile


def _require_api_key(user: User) -> str:
    if not user.anthropic_api_key:
        raise HTTPException(
            status_code=402,
            detail="No API key configured. Please add your Anthropic API key in Settings.",
        )
    from app.services.encryption import decrypt
    return decrypt(user.anthropic_api_key)


@router.post("/cluster", response_model=ClusterResponse)
async def cluster_reach_jobs(
    request: ClusterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ClusterResponse:
    if len(request.jobs) < 2:
        raise HTTPException(
            status_code=422,
            detail="At least 2 reach jobs are required for clustering.",
        )
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.reach import cluster_reach_jobs as _cluster
    try:
        return _cluster(
            request.jobs,
            api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during reach clustering")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/analyze", response_model=ReachAnalyzeResponse)
async def analyze_reach_group(
    request: ReachAnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReachAnalyzeResponse:
    if len(request.jobs) == 0:
        raise HTTPException(
            status_code=422,
            detail="At least 1 job is required for analysis.",
        )
    api_key = _require_api_key(current_user)
    profile = _get_active_profile(current_user.id, db)
    from app.services.reach import analyze_reach_group as _analyze
    try:
        return _analyze(
            request.group_name,
            request.jobs,
            api_key,
            resume_text=profile.resume_text or "",
            instructions=profile.instructions,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Unexpected error during reach analysis")
        raise HTTPException(status_code=500, detail="Internal server error")
