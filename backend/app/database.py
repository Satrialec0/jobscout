import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.config import get_settings

logger = logging.getLogger(__name__)

# Create engine once at module level — not per request
settings = get_settings()
logger.info("Creating database engine")
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    echo=False
)

SessionFactory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

def get_db() -> Session:
    db = SessionFactory()
    try:
        yield db
    finally:
        db.close()