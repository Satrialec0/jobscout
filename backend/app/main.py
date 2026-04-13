import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.analyze import router as analyze_router
from app.api.auth import router as auth_router
from app.api.reach import router as reach_router
from app.api.profiles import router as profiles_router
from app.api.keywords import router as keywords_router
from app.api.targeting import router as targeting_router
from app.api.scraper import router as scraper_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)


def _schedule_scraper(scheduler: AsyncIOScheduler) -> None:
    """Register one hourly job per user who has credentials stored, staggered by user_id."""
    from app.database import SessionFactory
    from app.models.scraper import HiringCafeCredential
    from app.services.scraper_poll import poll_user

    db = SessionFactory()
    try:
        user_ids = [row.user_id for row in db.query(HiringCafeCredential.user_id).all()]
    finally:
        db.close()

    for user_id in user_ids:
        minute_offset = user_id % 60
        scheduler.add_job(
            poll_user,
            "cron",
            minute=minute_offset,
            args=[user_id],
            id=f"scraper_user_{user_id}",
            replace_existing=True,
        )
        logger.info("Scheduled scraper for user %d at minute %d", user_id, minute_offset)

    if not user_ids:
        logger.info("No credentials registered — scraper not scheduled at startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()
    _schedule_scraper(scheduler)
    scheduler.start()
    logger.info("APScheduler started")
    yield
    scheduler.shutdown()
    logger.info("APScheduler stopped")


logger.info("Starting JobScout API")

app = FastAPI(
    title="JobScout API",
    description="Real-time job fit scoring using Claude AI",
    version="0.2.0",
    lifespan=lifespan,
)

from app.config import get_settings as _get_settings
_settings = _get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router, prefix="/api/v1", tags=["analysis"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(reach_router, prefix="/api/v1/reach", tags=["reach"])
app.include_router(profiles_router, prefix="/api/v1/profiles", tags=["profiles"])
app.include_router(keywords_router, prefix="/api/v1/keywords", tags=["keywords"])
app.include_router(targeting_router, prefix="/api/v1", tags=["targeting"])
app.include_router(scraper_router, prefix="/api/v1", tags=["scraper"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.2.0"}


_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "web")


@app.get("/")
async def root():
    index = os.path.join(_static_dir, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/login.html")


@app.get("/{filename:path}")
async def serve_static(filename: str):
    # Serve the exact file if it exists (JS/CSS/assets)
    file_path = os.path.join(_static_dir, filename)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    # SPA fallback: serve index.html for any unknown path so React Router works
    index = os.path.join(_static_dir, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")
