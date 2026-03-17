import logging
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
    url: str | None = None
) -> JobAnalysis:
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
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("Saved analysis id=%s, fit_score=%s", record.id, record.fit_score)
    return record