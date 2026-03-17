import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.config import get_settings

logger = logging.getLogger(__name__)


def get_engine():
    settings = get_settings()
    logger.info("Creating database engine")
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        echo=False
    )


def get_session_factory():
    engine = get_engine()
    return sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Session:
    SessionFactory = get_session_factory()
    db = SessionFactory()
    try:
        yield db
    finally:
        db.close()