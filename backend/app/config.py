from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

ENV_PATH = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    anthropic_api_key: str | None = None  # no longer required — users supply their own key
    database_url: str
    environment: str = "development"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 720  # 30 days

    class Config:
        env_file = str(ENV_PATH)
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    logger.info("Settings loaded, environment: %s", settings.environment)
    return settings