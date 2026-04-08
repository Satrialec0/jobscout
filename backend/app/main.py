import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException
from fastapi.responses import FileResponse
from app.api.analyze import router as analyze_router
from app.api.auth import router as auth_router
from app.api.reach import router as reach_router
from app.api.profiles import router as profiles_router
from app.api.keywords import router as keywords_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

logger = logging.getLogger(__name__)
logger.info("Starting JobScout API")

app = FastAPI(
    title="JobScout API",
    description="Real-time job fit scoring using Claude AI",
    version="0.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # JWT in headers — no cookies needed, wildcard is safe
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router, prefix="/api/v1", tags=["analysis"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(reach_router, prefix="/api/v1/reach", tags=["reach"])
app.include_router(profiles_router, prefix="/api/v1/profiles", tags=["profiles"])
app.include_router(keywords_router, prefix="/api/v1/keywords", tags=["keywords"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.2.0"}


_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "web")


@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/login.html")


@app.get("/{filename}")
async def serve_static(filename: str):
    file_path = os.path.join(_static_dir, filename)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")
