from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path

print("[config.py] Loading settings")

ENV_PATH = Path(__file__).parent.parent / ".env"
print(f"[config.py] Looking for .env at: {ENV_PATH}")
print(f"[config.py] .env file exists: {ENV_PATH.exists()}")

if ENV_PATH.exists():
    print(f"[config.py] .env contents preview:")
    with open(ENV_PATH, "r") as f:
        for line in f:
            key = line.split("=")[0].strip()
            print(f"[config.py]   found key: {key}")


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
    print(f"[config.py] Settings loaded, environment: {settings.environment}")
    return settings