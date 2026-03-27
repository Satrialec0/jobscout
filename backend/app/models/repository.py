import logging
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.job import JobAnalysis
from app.schemas.analyze import AnalyzeResponse

logger = logging.getLogger(__name__)


def get_cached_analysis(db: Session, url: str) -> JobAnalysis | None:
    if not url:
        return None
    result = db.query(JobAnalysis).filter(JobAnalysis.url == url).first()
    if result:
        logger.info("Cache hit for url: %s", url)
    return result


def save_analysis(
    db: Session,
    job_title: str,
    company: str,
    job_description: str,
    result: AnalyzeResponse,
    url: str | None = None,
    user_id: int | None = None,
) -> JobAnalysis:
    salary_estimate_dict = None
    if result.salary_estimate:
        salary_estimate_dict = {
            "low": result.salary_estimate.low,
            "high": result.salary_estimate.high,
            "currency": result.salary_estimate.currency,
            "per": result.salary_estimate.per,
            "confidence": result.salary_estimate.confidence,
            "assessment": result.salary_estimate.assessment,
        }

    record = JobAnalysis(
        url=url,
        job_title=job_title,
        company=company,
        job_description=job_description,
        fit_score=result.fit_score,
        should_apply=result.should_apply,
        one_line_verdict=result.one_line_verdict,
        direct_matches=[i.model_dump() for i in result.direct_matches],
        transferable=[i.model_dump() for i in result.transferable],
        gaps=[i.model_dump() for i in result.gaps],
        red_flags=result.red_flags,
        green_flags=result.green_flags,
        salary_estimate=salary_estimate_dict,
        user_id=user_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("Saved analysis id=%s, fit_score=%s", record.id, record.fit_score)
    return record


def update_job_status(
    db: Session,
    db_id: int,
    user_id: int,
    status: str | None,
    applied_date: datetime | None = None,
    notes: str | None = None,
) -> JobAnalysis | None:
    record = (
        db.query(JobAnalysis)
        .filter(JobAnalysis.id == db_id, JobAnalysis.user_id == user_id)
        .first()
    )
    if not record:
        return None
    record.status = status
    if applied_date is not None:
        record.applied_date = applied_date
    if notes is not None:
        record.notes = notes
    db.commit()
    db.refresh(record)
    logger.info("Updated status for job id=%s: %s", db_id, status)
    return record