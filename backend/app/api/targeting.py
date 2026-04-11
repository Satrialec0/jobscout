import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.user_profile import UserProfile
from app.models.targeting import ProfileTargetKeyword, ProfileTargetSignal, Company
from app.schemas.targeting import (
    TargetKeywordItem,
    TargetKeywordAddRequest,
    TargetSignalItem,
    TargetSignalUpsertRequest,
    CompanyItem,
    CompanyAddRequest,
    CompaniesResponse,
)
from app.services.keyword_extractor import extract_keywords_from_resume

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_owned_profile(profile_id: int, current_user: User, db: Session) -> UserProfile:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


# ── Target Keywords ──────────────────────────────────────────────────────────

@router.get("/profiles/{profile_id}/target-keywords", response_model=list[TargetKeywordItem])
def get_target_keywords(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TargetKeywordItem]:
    profile = _get_owned_profile(profile_id, current_user, db)
    rows = (
        db.query(ProfileTargetKeyword)
        .filter(ProfileTargetKeyword.profile_id == profile_id)
        .order_by(ProfileTargetKeyword.created_at)
        .all()
    )
    # Lazy extraction: if no resume keywords exist yet, extract from resume
    has_resume_keywords = any(r.source == "resume" for r in rows)
    if not has_resume_keywords and profile.resume_text:
        keywords = extract_keywords_from_resume(profile.resume_text)
        for kw in keywords:
            kw_lower = kw.lower().strip()
            if not kw_lower:
                continue
            existing = (
                db.query(ProfileTargetKeyword)
                .filter(
                    ProfileTargetKeyword.profile_id == profile_id,
                    ProfileTargetKeyword.keyword == kw_lower,
                )
                .first()
            )
            if not existing:
                db.add(ProfileTargetKeyword(
                    profile_id=profile_id,
                    keyword=kw_lower,
                    source="resume",
                ))
        db.commit()
        rows = (
            db.query(ProfileTargetKeyword)
            .filter(ProfileTargetKeyword.profile_id == profile_id)
            .order_by(ProfileTargetKeyword.created_at)
            .all()
        )
    return [TargetKeywordItem(id=r.id, keyword=r.keyword, source=r.source) for r in rows]


@router.post("/profiles/{profile_id}/target-keywords", status_code=201)
def add_target_keyword(
    profile_id: int,
    body: TargetKeywordAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _get_owned_profile(profile_id, current_user, db)
    kw = body.keyword.lower().strip()
    existing = (
        db.query(ProfileTargetKeyword)
        .filter(ProfileTargetKeyword.profile_id == profile_id, ProfileTargetKeyword.keyword == kw)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Keyword already exists")
    db.add(ProfileTargetKeyword(profile_id=profile_id, keyword=kw, source=body.source))
    db.commit()
    logger.info("Added target keyword '%s' for profile %d", kw, profile_id)
    return {"keyword": kw}


@router.delete("/profiles/{profile_id}/target-keywords/{keyword}", status_code=204)
def delete_target_keyword(
    profile_id: int,
    keyword: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _get_owned_profile(profile_id, current_user, db)
    row = (
        db.query(ProfileTargetKeyword)
        .filter(
            ProfileTargetKeyword.profile_id == profile_id,
            ProfileTargetKeyword.keyword == keyword.lower().strip(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Keyword not found")
    db.delete(row)
    db.commit()


@router.post("/profiles/{profile_id}/target-keywords/reset", status_code=200)
def reset_target_keywords(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Re-extract resume keywords, replacing all source='resume' entries."""
    profile = _get_owned_profile(profile_id, current_user, db)
    db.query(ProfileTargetKeyword).filter(
        ProfileTargetKeyword.profile_id == profile_id,
        ProfileTargetKeyword.source == "resume",
    ).delete()
    db.commit()
    keywords = extract_keywords_from_resume(profile.resume_text)
    for kw in keywords:
        kw_lower = kw.lower().strip()
        if not kw_lower:
            continue
        existing = (
            db.query(ProfileTargetKeyword)
            .filter(
                ProfileTargetKeyword.profile_id == profile_id,
                ProfileTargetKeyword.keyword == kw_lower,
            )
            .first()
        )
        if not existing:
            db.add(ProfileTargetKeyword(profile_id=profile_id, keyword=kw_lower, source="resume"))
    db.commit()
    count = db.query(ProfileTargetKeyword).filter(
        ProfileTargetKeyword.profile_id == profile_id,
        ProfileTargetKeyword.source == "resume",
    ).count()
    logger.info("Reset resume keywords for profile %d: %d keywords", profile_id, count)
    return {"reset": count}


# ── Target Signals ────────────────────────────────────────────────────────────

@router.get("/keywords/target-signals/{profile_id}", response_model=list[TargetSignalItem])
def get_target_signals(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TargetSignalItem]:
    _get_owned_profile(profile_id, current_user, db)
    rows = (
        db.query(ProfileTargetSignal)
        .filter(ProfileTargetSignal.profile_id == profile_id)
        .all()
    )
    return [
        TargetSignalItem(ngram=r.ngram, target_count=r.target_count, show_count=r.show_count)
        for r in rows
    ]


@router.put("/keywords/target-signals/{profile_id}", status_code=204)
def upsert_target_signals(
    profile_id: int,
    body: TargetSignalUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _get_owned_profile(profile_id, current_user, db)
    now = datetime.now(timezone.utc)
    for item in body.signals:
        existing = (
            db.query(ProfileTargetSignal)
            .filter(
                ProfileTargetSignal.profile_id == profile_id,
                ProfileTargetSignal.ngram == item.ngram,
            )
            .first()
        )
        if existing:
            existing.target_count = item.target_count
            existing.show_count = item.show_count
            existing.updated_at = now
        else:
            db.add(ProfileTargetSignal(
                profile_id=profile_id,
                ngram=item.ngram,
                target_count=item.target_count,
                show_count=item.show_count,
                updated_at=now,
            ))
    db.commit()
    logger.info("Upserted %d target signals for profile %d", len(body.signals), profile_id)


# ── Companies ─────────────────────────────────────────────────────────────────

@router.get("/companies", response_model=CompaniesResponse)
def get_companies(
    profile_id: Optional[int] = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CompaniesResponse:
    """Return target companies for the given profile_id and all global block companies."""
    targets = []
    if profile_id:
        _get_owned_profile(profile_id, current_user, db)
        target_rows = (
            db.query(Company)
            .filter(Company.profile_id == profile_id, Company.list_type == "target")
            .order_by(Company.created_at)
            .all()
        )
        targets = [
            CompanyItem(id=r.id, name=r.name, list_type=r.list_type, profile_id=r.profile_id)
            for r in target_rows
        ]
    block_rows = (
        db.query(Company)
        .filter(Company.profile_id.is_(None), Company.list_type == "block")
        .order_by(Company.created_at)
        .all()
    )
    blocks = [
        CompanyItem(id=r.id, name=r.name, list_type=r.list_type, profile_id=r.profile_id)
        for r in block_rows
    ]
    return CompaniesResponse(targets=targets, blocks=blocks)


@router.post("/companies/target", status_code=201)
def add_target_company(
    body: CompanyAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not body.profile_id:
        raise HTTPException(status_code=400, detail="profile_id required for target companies")
    _get_owned_profile(body.profile_id, current_user, db)
    name = body.name.strip()
    existing = (
        db.query(Company)
        .filter(
            Company.profile_id == body.profile_id,
            Company.name == name,
            Company.list_type == "target",
        )
        .first()
    )
    if existing:
        return {"id": existing.id, "name": name}
    entry = Company(profile_id=body.profile_id, name=name, list_type="target")
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "name": name}


@router.delete("/companies/target/{company_id}", status_code=204)
def delete_target_company(
    company_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = db.query(Company).filter(Company.id == company_id, Company.list_type == "target").first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    if row.profile_id:
        _get_owned_profile(row.profile_id, current_user, db)
    db.delete(row)
    db.commit()


@router.post("/companies/block", status_code=201)
def add_block_company(
    body: CompanyAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    name = body.name.strip()
    existing = (
        db.query(Company)
        .filter(Company.profile_id.is_(None), Company.name == name, Company.list_type == "block")
        .first()
    )
    if existing:
        return {"id": existing.id, "name": name}
    entry = Company(profile_id=None, name=name, list_type="block")
    db.add(entry)
    db.commit()
    db.refresh(entry)
    logger.info("Added blocked company '%s'", name)
    return {"id": entry.id, "name": name}


@router.delete("/companies/block/{company_id}", status_code=204)
def delete_block_company(
    company_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = (
        db.query(Company)
        .filter(Company.id == company_id, Company.list_type == "block", Company.profile_id.is_(None))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(row)
    db.commit()
