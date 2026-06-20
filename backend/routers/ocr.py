"""
routers/ocr.py — Standalone license plate OCR endpoint (POST /api/ocr)
"""
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from schemas.models import OCRResponse, PlateResult, BoundingBox
from core.annotator import EvidenceAnnotator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["OCR"])


@router.post("/ocr", response_model=OCRResponse)
async def recognize_plates(file: UploadFile = File(...)):
    """
    Standalone license plate OCR endpoint.
    Accepts an image and returns all detected plate numbers with confidence scores.
    """
    from main import ocr_engine, annotator

    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/bmp"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    raw_bytes = await file.read()
    try:
        image = EvidenceAnnotator.decode_image(raw_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = ocr_engine.recognize(image)

    # Annotate image with plate highlights
    import cv2, base64
    annotated = image.copy()
    for plate in result.plates:
        if plate.x1 != 0 or plate.x2 != 0:
            x1, y1, x2, y2 = int(plate.x1), int(plate.y1), int(plate.x2), int(plate.y2)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 200, 0), 2)
            cv2.putText(annotated, plate.text,
                        (x1, y2 + 18), cv2.FONT_HERSHEY_PLAIN, 1.1,
                        (255, 200, 0), 1, cv2.LINE_AA)

    img_b64 = EvidenceAnnotator.to_base64(annotated)

    plates = [
        PlateResult(
            text       = p.text,
            confidence = round(p.confidence, 3),
            bbox       = BoundingBox(x1=p.x1, y1=p.y1, x2=p.x2, y2=p.y2),
            region     = p.state_code,
            state      = p.state_name,
        )
        for p in result.plates
    ]

    return OCRResponse(
        status          = "success",
        plates          = plates,
        image_annotated = img_b64,
        total_found     = len(plates),
        performance_ms  = result.ocr_ms,
    )
