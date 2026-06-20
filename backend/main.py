"""
main.py — TrafficAI FastAPI Application Entry Point
====================================================
Starts the full AI pipeline server with:
  - YOLOv8 vehicle & violation detection
  - EasyOCR license plate recognition
  - OpenCV image preprocessing
  - SQLite violation database
  - CORS enabled for frontend at file:// and localhost

Run: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
Docs: http://localhost:8000/docs
"""
import logging
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Logging Setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level  = logging.INFO,
    format = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt= "%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("trafficai")

# ── Lazy-load heavy models (set at module level, populated on startup) ─────────
detector    = None
ocr_engine  = None
annotator   = None
preprocessor = None
store       = None


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global detector, ocr_engine, annotator, preprocessor, store

    logger.info("=" * 60)
    logger.info("  TrafficAI Backend v2.4.1 — Starting up")
    logger.info("=" * 60)

    t0 = time.perf_counter()

    # Database
    logger.info("[DB]  Initializing violation database...")
    from database.store import get_store
    store = get_store()
    logger.info(f"   [OK] Database ready ({store._conn.execute('SELECT COUNT(*) FROM violations').fetchone()[0]} records)")

    # Preprocessor (lightweight, always succeeds)
    logger.info("[CV]  Loading image preprocessor (OpenCV)...")
    from core.preprocessor import ImagePreprocessor
    preprocessor = ImagePreprocessor()
    logger.info("   [OK] Preprocessor ready")

    # YOLOv8 Detector
    logger.info("[AI]  Loading YOLOv8 detection model...")
    from core.detector import TrafficDetector
    detector = TrafficDetector(model_name="yolov8n.pt", conf_threshold=0.35)
    status = "[OK] Loaded" if detector.is_loaded else "[WARN] Fallback mode (model unavailable)"
    logger.info(f"   {status}")

    # EasyOCR
    logger.info("[OCR] Loading EasyOCR (English)...")
    from core.ocr_engine import PlateOCREngine
    ocr_engine = PlateOCREngine()
    status = "[OK] Loaded" if ocr_engine.is_loaded else "[WARN] Fallback mode (EasyOCR unavailable)"
    logger.info(f"   {status}")

    # Annotator (pure OpenCV, always loads)
    from core.annotator import EvidenceAnnotator
    annotator = EvidenceAnnotator()
    logger.info("[ANN] Annotator ready")

    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("=" * 60)
    logger.info(f"  TrafficAI Server ready in {elapsed:.0f}ms")
    logger.info("  API:  http://localhost:8000")
    logger.info("  Docs: http://localhost:8000/docs")
    logger.info("=" * 60)

    yield

    # Shutdown
    logger.info("Shutting down TrafficAI backend…")


# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title       = "TrafficAI Vision API",
    description = (
        "Automated traffic violation detection system using YOLOv8, EasyOCR, and OpenCV. "
        "Detects vehicles, identifies violations, and recognizes license plates in real time."
    ),
    version     = "2.4.1",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
    lifespan    = lifespan,
)

# ── CORS — allow frontend (file://, localhost) ────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],   # In production: restrict to your domain
    allow_methods  = ["*"],
    allow_headers  = ["*"],
    allow_credentials = False,
)

# ── Routers ───────────────────────────────────────────────────────────────────
from routers.analyze    import router as analyze_router
from routers.ocr        import router as ocr_router
from routers.violations import router as violations_router
from routers.health     import router as health_router

app.include_router(analyze_router)
app.include_router(ocr_router)
app.include_router(violations_router)
app.include_router(health_router)


# ── Root ──────────────────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return {
        "name":    "TrafficAI Vision API",
        "version": "2.4.1",
        "status":  "running",
        "docs":    "/docs",
        "endpoints": [
            "POST /api/analyze   — Full image analysis",
            "POST /api/ocr       — License plate OCR",
            "GET  /api/violations — Violation records",
            "GET  /api/stats      — Dashboard statistics",
            "GET  /api/health     — System health",
        ],
    }


# ── Exception Handlers ────────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "Internal server error", "detail": str(exc)},
    )


# ── Dev runner ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host        = "0.0.0.0",
        port        = 8000,
        reload      = True,
        log_level   = "info",
        access_log  = True,
    )
