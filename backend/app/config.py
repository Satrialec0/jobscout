from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

ENV_PATH = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    anthropic_api_key: str
    database_url: str
    environment: str = "development"

    class Config:
        env_file = str(ENV_PATH)
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    logger.info("Settings loaded, environment: %s", settings.environment)
    return settings