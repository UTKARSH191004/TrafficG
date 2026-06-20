"""
routers/analyze.py — Main image analysis endpoint (POST /api/analyze)
Runs: Preprocess → YOLOv8 Detect → Violation Rules → EasyOCR → Annotate → Return
"""
import uuid
import random
import logging
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional
from schemas.models import (
    AnalyzeResponse, BoundingBox, Detection, ViolationResult,
    PlateResult, ImageMetadata, PreprocessingInfo, PerformanceMetrics,
)
from core.preprocessor import ImagePreprocessor
from core.annotator    import EvidenceAnnotator

logger  = APIRouter.__module__ and logging.getLogger(__name__)
router  = APIRouter(prefix="/api", tags=["Analysis"])

LOCATIONS = [
    "MG Road Junction", "Silk Board Flyover", "KR Puram Signal",
    "Whitefield Cross", "Hebbal Junction", "Electronic City Toll",
    "Marathahalli Bridge", "Koramangala 4th Block",
]


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_image(
    file:     UploadFile = File(...),
    camera:   str        = Form("CAM-01"),
    location: str        = Form(""),
):
    """
    Full traffic violation analysis pipeline:
    1. Decode & preprocess image (OpenCV)
    2. Detect vehicles & persons (YOLOv8)
    3. Apply violation rules
    4. Recognize license plates (EasyOCR)
    5. Annotate evidence image
    6. Save to database
    7. Return annotated image + JSON results
    """
    import time as _time

    from main import detector, ocr_engine, annotator, preprocessor, store

    # ── Validate upload ───────────────────────────────────────────────────────
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/bmp"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    raw_bytes = await file.read()
    if len(raw_bytes) > 20 * 1024 * 1024:   # 20MB limit
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    try:
        image = EvidenceAnnotator.decode_image(raw_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    h, w, ch = image.shape
    analysis_id = str(uuid.uuid4())[:8].upper()
    location    = location or random.choice(LOCATIONS)

    # ── Step 1: Preprocess ────────────────────────────────────────────────────
    t_pre  = _time.perf_counter()
    prep   = preprocessor.process(image)
    pre_ms = ((_time.perf_counter() - t_pre) * 1000)

    # ── Step 2: Detection ─────────────────────────────────────────────────────
    t_det  = _time.perf_counter()
    det    = detector.detect(prep.image)
    det_ms = ((_time.perf_counter() - t_det) * 1000)

    # ── Step 3: OCR ───────────────────────────────────────────────────────────
    t_ocr  = _time.perf_counter()
    ocr    = ocr_engine.recognize(prep.image)
    ocr_ms = ((_time.perf_counter() - t_ocr) * 1000)

    # ── Step 4: Annotate ──────────────────────────────────────────────────────
    t_ann  = _time.perf_counter()
    annotated_img = annotator.annotate(
        prep.image, det.boxes, det.violations, ocr.plates,
        camera=camera, location=location,
    )
    ann_ms    = ((_time.perf_counter() - t_ann) * 1000)
    img_b64   = EvidenceAnnotator.to_base64(annotated_img)
    thumb_b64 = EvidenceAnnotator.to_thumbnail_base64(annotated_img)
    total_ms  = pre_ms + det_ms + ocr_ms + ann_ms

    # ── Build response objects ────────────────────────────────────────────────
    detections = [
        Detection(
            class_id   = b.class_id,
            class_name = b.class_name,
            confidence = round(b.confidence, 3),
            bbox       = BoundingBox(x1=b.x1, y1=b.y1, x2=b.x2, y2=b.y2),
        )
        for b in det.boxes
    ]

    violations = [
        ViolationResult(
            violation_id    = v.violation_id,
            type            = v.type,
            label           = v.label,
            severity        = v.severity,
            confidence      = round(v.confidence, 3),
            bbox            = BoundingBox(x1=v.x1, y1=v.y1, x2=v.x2, y2=v.y2),
            color           = v.color,
            icon            = v.icon,
            description     = v.description,
            related_vehicle = v.related_vehicle,
        )
        for v in det.violations
    ]

    plates = [
        PlateResult(
            text       = p.text,
            confidence = round(p.confidence, 3),
            bbox       = BoundingBox(x1=p.x1, y1=p.y1, x2=p.x2, y2=p.y2),
            region     = p.state_code,
            state      = p.state_name,
        )
        for p in ocr.plates
    ]

    quality_label = ImagePreprocessor.quality_label(prep.quality_score)

    metadata = ImageMetadata(
        width            = w,
        height           = h,
        channels         = ch,
        vehicle_count    = det.vehicle_count,
        person_count     = det.person_count,
        violation_count  = len(violations),
        plate_count      = len(plates),
        image_quality    = quality_label,
        weather_estimate = prep.weather_estimate,
        lighting         = prep.lighting,
        is_blurry        = prep.is_blurry,
        brightness       = prep.original_brightness,
    )

    preprocessing = PreprocessingInfo(
        clahe_applied        = prep.clahe_applied,
        denoising_applied    = prep.denoising_applied,
        gamma_correction     = prep.gamma_correction,
        fog_removal          = prep.fog_removal,
        original_brightness  = prep.original_brightness,
        enhanced_brightness  = prep.enhanced_brightness,
    )

    performance = PerformanceMetrics(
        preprocess_ms = round(pre_ms, 1),
        detection_ms  = round(det_ms, 1),
        ocr_ms        = round(ocr_ms, 1),
        annotation_ms = round(ann_ms, 1),
        total_ms      = round(total_ms, 1),
    )

    # ── Persist violations ────────────────────────────────────────────────────
    if det.violations:
        plate_text = plates[0].text if plates else None
        for v in det.violations:
            store.add_violation({
                "plate":      plate_text,
                "violation":  v.label,
                "severity":   v.severity,
                "location":   location,
                "timestamp":  datetime.now().isoformat(),
                "confidence": v.confidence,
                "camera":     camera,
                "image_thumb": thumb_b64,
                "metadata":   {"color": v.color, "icon": v.icon},
            })
    store.increment_analyzed()

    return AnalyzeResponse(
        status          = "success",
        image_annotated = img_b64,
        detections      = detections,
        violations      = violations,
        plates          = plates,
        metadata        = metadata,
        preprocessing   = preprocessing,
        performance     = performance,
        timestamp       = datetime.now().isoformat(),
        analysis_id     = analysis_id,
    )
