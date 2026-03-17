from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.analyze import router as analyze_router

print("[main.py] Starting JobScout API")

app = FastAPI(
    title="JobScout API",
    description="Real-time job fit scoring using Claude AI",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router, prefix="/api/v1", tags=["analysis"])


@app.get("/health")
async def health_check():
    print("[main.py] Health check called")
    return {"status": "ok", "version": "0.1.0"}