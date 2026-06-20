"""
routers/health.py — System health and model status endpoint
"""
import time
import platform
from fastapi import APIRouter
from schemas.models import HealthResponse

router = APIRouter(prefix="/api", tags=["System"])

_start_time = time.time()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Returns system status, loaded models, GPU info, and uptime."""
    from main import detector, ocr_engine, store

    # Check GPU
    gpu_available = False
    device        = "cpu"
    try:
        import torch
        gpu_available = torch.cuda.is_available()
        device        = torch.cuda.get_device_name(0) if gpu_available else "CPU"
    except ImportError:
        pass

    return HealthResponse(
        status         = "healthy",
        version        = "2.4.1",
        models_loaded  = {
            "yolov8":   detector.is_loaded,
            "easyocr":  ocr_engine.is_loaded,
        },
        gpu_available  = gpu_available,
        device         = device,
        uptime_seconds = round(time.time() - _start_time, 1),
        total_analyzed = store.total_analyzed,
    )


@router.get("/stats")
async def get_stats():
    """Dashboard KPI statistics."""
    from main import store
    return store.get_stats()
