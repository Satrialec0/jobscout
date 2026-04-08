import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.user_profile import UserProfile
from app.models.keyword import UserKeywordBlocklist, ProfileKeywordSignal
from app.schemas.keyword import BlocklistResponse, BlocklistAddRequest, SignalItem, SignalUpsertRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/blocklist", response_model=BlocklistResponse)
def get_blocklist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BlocklistResponse:
    rows = (
        db.query(UserKeywordBlocklist)
        .filter(UserKeywordBlocklist.user_id == current_user.id)
        .order_by(UserKeywordBlocklist.created_at)
        .all()
    )
    return BlocklistResponse(terms=[r.term for r in rows])


@router.post("/blocklist", status_code=201)
def add_to_blocklist(
    body: BlocklistAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    term = body.term.strip().lower()
    existing = (
        db.query(UserKeywordBlocklist)
        .filter(UserKeywordBlocklist.user_id == current_user.id, UserKeywordBlocklist.term == term)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Term already in blocklist")
    entry = UserKeywordBlocklist(user_id=current_user.id, term=term)
    db.add(entry)
    db.commit()
    logger.info("Added blocklist term '%s' for user %d", term, current_user.id)
    return {"term": term}


@router.delete("/blocklist/{term}", status_code=204)
def remove_from_blocklist(
    term: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    entry = (
        db.query(UserKeywordBlocklist)
        .filter(UserKeywordBlocklist.user_id == current_user.id, UserKeywordBlocklist.term == term)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Term not found")
    db.delete(entry)
    db.commit()
    logger.info("Removed blocklist term '%s' for user %d", term, current_user.id)


@router.get("/signals/{profile_id}", response_model=list[SignalItem])
def get_signals(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SignalItem]:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    rows = (
        db.query(ProfileKeywordSignal)
        .filter(ProfileKeywordSignal.profile_id == profile_id)
        .all()
    )
    return [SignalItem(ngram=r.ngram, hide_count=r.hide_count, show_count=r.show_count) for r in rows]


@router.put("/signals/{profile_id}", status_code=204)
def upsert_signals(
    profile_id: int,
    body: SignalUpsertRequest,
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

    now = datetime.now(timezone.utc)
    for item in body.signals:
        existing = (
            db.query(ProfileKeywordSignal)
            .filter(
                ProfileKeywordSignal.profile_id == profile_id,
                ProfileKeywordSignal.ngram == item.ngram,
            )
            .first()
        )
        if existing:
            existing.hide_count = item.hide_count
            existing.show_count = item.show_count
            existing.updated_at = now
        else:
            db.add(ProfileKeywordSignal(
                profile_id=profile_id,
                ngram=item.ngram,
                hide_count=item.hide_count,
                show_count=item.show_count,
                updated_at=now,
            ))
    db.commit()
    logger.info("Upserted %d signals for profile %d", len(body.signals), profile_id)
