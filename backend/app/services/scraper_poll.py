import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database import SessionFactory as SessionLocal
from app.models.scraper import HiringCafeCredential, SavedSearch, ScrapedJob
from app.models.job import JobAnalysis
from app.models.targeting import ProfileTargetKeyword, ProfileTargetSignal, Company
from app.models.user import User
from app.models.user_profile import UserProfile
from app.services.encryption import decrypt
from app.services.hiring_cafe import fetch_search, HiringCafeAuthError, HiringCafeRateLimitError
from app.services.email import build_match_email_body, build_expiry_email_body, send_email

logger = logging.getLogger(__name__)

_MIN_TARGET_COUNT = 3
_MIN_CONFIDENCE = 0.70


def tokenize_title(title: str) -> list[str]:
    """Lowercase and split a job title into individual word tokens."""
    cleaned = re.sub(r"[^\w\s]", "", title.lower())
    return [w for w in cleaned.split() if w]


def _ngrams(tokens: list[str], n: int) -> list[str]:
    return [" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def job_matches_signals(job: dict, signals: dict) -> bool:
    """Return True if a job matches any of the user's targeting signals.

    signals dict shape:
      {
        "profile_keywords": list[str],       # always-active keywords (lowercase)
        "target_signals": list[dict],        # {"ngram": str, "target_count": int, "show_count": int}
        "target_companies": list[str],       # lowercase company names
      }
    """
    title_lower = job.get("title", "").lower()
    company_lower = job.get("company", "").lower()
    tokens = tokenize_title(job.get("title", ""))
    title_ngrams = set(tokens) | set(_ngrams(tokens, 2)) | set(_ngrams(tokens, 3))

    # Profile keywords — always active
    for kw in signals["profile_keywords"]:
        if kw.lower() in title_lower:
            return True

    # Target companies
    for co in signals["target_companies"]:
        if co.lower() in company_lower:
            return True

    # Learned target signals — threshold: count >= 3 AND confidence >= 70%
    for sig in signals["target_signals"]:
        tc = sig["target_count"]
        sc = sig["show_count"]
        if tc < _MIN_TARGET_COUNT:
            continue
        confidence = tc / (tc + sc) if (tc + sc) > 0 else 0
        if confidence < _MIN_CONFIDENCE:
            continue
        if sig["ngram"].lower() in title_ngrams:
            return True

    return False


def _load_signals_for_user(user_id: int, db: Session) -> dict:
    """Load all targeting signals for a user's active profile from the DB."""
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.user_id == user_id, UserProfile.is_active.is_(True))
        .first()
    )
    if not profile:
        return {"profile_keywords": [], "target_signals": [], "target_companies": []}

    keywords = (
        db.query(ProfileTargetKeyword.keyword)
        .filter(ProfileTargetKeyword.profile_id == profile.id)
        .all()
    )
    signals = (
        db.query(ProfileTargetSignal)
        .filter(ProfileTargetSignal.profile_id == profile.id)
        .all()
    )
    companies = (
        db.query(Company.name)
        .filter(Company.profile_id == profile.id, Company.list_type == "target")
        .all()
    )

    return {
        "profile_keywords": [k.keyword.lower() for k in keywords],
        "target_signals": [
            {"ngram": s.ngram, "target_count": s.target_count, "show_count": s.show_count}
            for s in signals
        ],
        "target_companies": [c.name.lower() for c in companies],
    }


def _is_new_job(object_id: str, apply_url: str, user_id: int, db: Session) -> bool:
    """Return True if this job has not been seen by this user before."""
    in_scraped = (
        db.query(ScrapedJob.id)
        .filter(ScrapedJob.user_id == user_id, ScrapedJob.object_id == object_id)
        .first()
    )
    if in_scraped:
        return False

    in_analyzed = (
        db.query(JobAnalysis.id)
        .filter(JobAnalysis.user_id == user_id, JobAnalysis.url == apply_url)
        .first()
    )
    return in_analyzed is None


async def _fetch_with_backoff(search_state: dict, cookie_header: str, max_retries: int = 3) -> list[dict]:
    """Fetch search results with exponential backoff on rate limit errors."""
    delay = 120  # seconds
    for attempt in range(max_retries):
        try:
            return await fetch_search(search_state, cookie_header)
        except HiringCafeRateLimitError:
            if attempt == max_retries - 1:
                raise
            logger.warning("Rate limited by hiring.cafe, backing off %ds", delay)
            await asyncio.sleep(delay)
            delay *= 2
    return []


async def poll_user(user_id: int) -> None:
    """Run one poll cycle for a single user. Called by APScheduler."""
    db: Session = SessionLocal()
    try:
        cred = db.query(HiringCafeCredential).filter(
            HiringCafeCredential.user_id == user_id
        ).first()
        if not cred:
            return

        cookie_header = decrypt(cred.cookie_header)

        searches = (
            db.query(SavedSearch)
            .filter(SavedSearch.user_id == user_id, SavedSearch.is_active.is_(True))
            .all()
        )
        if not searches:
            return

        signals = _load_signals_for_user(user_id, db)
        user = db.query(User).filter(User.id == user_id).first()

        # Fetch all searches concurrently
        tasks = [_fetch_with_backoff(s.search_state, cookie_header) for s in searches]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        new_jobs: list[dict] = []

        for search, result in zip(searches, results):
            if isinstance(result, HiringCafeAuthError):
                logger.warning("Auth error for user %d — disabling credential", user_id)
                db.delete(cred)
                db.commit()
                if user:
                    send_email(
                        user.email,
                        "JobScout: Your hiring.cafe session has expired",
                        build_expiry_email_body(),
                    )
                return

            if isinstance(result, Exception):
                logger.error("Error polling search %d for user %d: %s", search.id, user_id, result)
                continue

            for job in result:
                if not _is_new_job(job["object_id"], job["apply_url"], user_id, db):
                    continue
                if not job_matches_signals(job, signals):
                    continue

                scraped = ScrapedJob(
                    user_id=user_id,
                    saved_search_id=search.id,
                    object_id=job["object_id"],
                    apply_url=job["apply_url"],
                    title=job["title"],
                    company=job["company"],
                    description=job["description"],
                )
                db.add(scraped)
                new_jobs.append(job)

            search.last_polled = datetime.now(timezone.utc)

        db.commit()

        if new_jobs and user:
            n = len(new_jobs)
            send_email(
                user.email,
                f"JobScout: {n} new job{'s' if n != 1 else ''} match your profile",
                build_match_email_body(new_jobs),
            )
            logger.info("Emailed %d new jobs to user %d", n, user_id)

    except Exception:
        logger.exception("Unexpected error in poll_user(%d)", user_id)
        db.rollback()
    finally:
        db.close()
