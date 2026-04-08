import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.user_profile import UserProfile, DEFAULT_INSTRUCTIONS
from app.schemas.profile import ProfileCreate, ProfileUpdate, ProfileResponse, ParseResumeResponse, ActiveProfileResponse
from app.services.resume_parser import extract_resume_text

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[ProfileResponse])
def list_profiles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProfileResponse]:
    return (
        db.query(UserProfile)
        .filter(UserProfile.user_id == current_user.id)
        .order_by(UserProfile.created_at)
        .all()
    )


@router.post("", response_model=ProfileResponse, status_code=201)
def create_profile(
    body: ProfileCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    profile = UserProfile(
        user_id=current_user.id,
        name=body.name,
        resume_text=body.resume_text,
        instructions=body.instructions,
        is_active=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    logger.info("Created profile '%s' for user %d", body.name, current_user.id)
    return profile


# parse-resume must be registered before /{profile_id} routes to avoid
# "parse-resume" being matched as a profile_id integer (it won't match int,
# but registering it first is cleaner and explicit)
@router.post("/parse-resume", response_model=ParseResumeResponse)
async def parse_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> ParseResumeResponse:
    """Extract text from a PDF or DOCX upload. Does NOT save the file or the text."""
    text = await extract_resume_text(file)
    if not text:
        raise HTTPException(
            status_code=422,
            detail="Could not extract text from the uploaded file. Try a different file.",
        )
    return ParseResumeResponse(text=text)


@router.get("/active", response_model=Optional[ActiveProfileResponse])
def get_active_profile_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Optional[ActiveProfileResponse]:
    """Return the active profile's id and name, or null if none is active."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == current_user.id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        return None
    return ActiveProfileResponse(id=profile.id, name=profile.name)


@router.put("/{profile_id}", response_model=ProfileResponse)
def update_profile(
    profile_id: int,
    body: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    if body.name is not None:
        profile.name = body.name
    if body.resume_text is not None:
        profile.resume_text = body.resume_text
    if body.instructions is not None:
        profile.instructions = body.instructions
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{profile_id}", status_code=204)
def delete_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.delete(profile)
    db.commit()


@router.post("/{profile_id}/activate", response_model=ProfileResponse)
def activate_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    """Set a profile as active. Flips all other profiles for this user to inactive."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.query(UserProfile).filter(
        UserProfile.user_id == current_user.id,
        UserProfile.id != profile_id,
    ).update({"is_active": False})
    profile.is_active = True
    db.commit()
    db.refresh(profile)
    logger.info("Activated profile '%s' (id=%d) for user %d", profile.name, profile_id, current_user.id)
    return profile
