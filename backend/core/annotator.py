"""
core/annotator.py — Draw detection results on images and produce evidence output
"""
import cv2
import numpy as np
import base64
import time
import logging
from datetime import datetime
from typing import List, Optional
from .detector import DetectionBox, ViolationDetection
from .ocr_engine import PlateDetection

logger = logging.getLogger(__name__)

# Font settings
FONT       = cv2.FONT_HERSHEY_SIMPLEX
FONT_MONO  = cv2.FONT_HERSHEY_PLAIN   # closer to monospace

# Color palette (BGR)
COLORS = {
    "#ff3b5c": (92,  59, 255),
    "#ff9500": (0,  149, 255),
    "#ff6b35": (53, 107, 255),
    "#ff2d55": (85,  45, 255),
    "#ffd60a": (10, 214, 255),
    "#00c4b0": (176, 196,  0),
    "#00d4ff": (255, 212,  0),
    "#00ff88": (136, 255,  0),
    "default": (0,  212, 255),
}

def hex_to_bgr(hex_color: str) -> tuple:
    if hex_color in COLORS:
        return COLORS[hex_color]
    try:
        h   = hex_color.lstrip('#')
        rgb = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
        return (rgb[2], rgb[1], rgb[0])   # RGB → BGR
    except Exception:
        return COLORS["default"]


class EvidenceAnnotator:
    """
    Draws detection results on images to produce annotated evidence:
    - Color-coded violation bounding boxes with corner accents
    - Violation labels with confidence scores
    - Vehicle detection boxes
    - License plate highlights with OCR text
    - HUD overlay (timestamp, camera, model info)
    """

    def __init__(self, line_thickness: int = 2):
        self._thickness = line_thickness

    # ── Main Annotate ─────────────────────────────────────────────────────────

    def annotate(
        self,
        image:      np.ndarray,
        detections: List[DetectionBox],
        violations: List[ViolationDetection],
        plates:     List[PlateDetection],
        camera:     str = "CAM-01",
        location:   str = "Unknown",
    ) -> np.ndarray:
        """Annotate image with all detections and violations."""
        t0   = time.perf_counter()
        out  = image.copy()

        # 1. Draw non-violation vehicle detections (subtle)
        violation_boxes = {(v.x1, v.y1, v.x2, v.y2) for v in violations}
        for det in detections:
            box_key = (det.x1, det.y1, det.x2, det.y2)
            if box_key not in violation_boxes:
                self._draw_vehicle_box(out, det)

        # 2. Draw violation boxes (prominent)
        for viol in violations:
            self._draw_violation_box(out, viol)

        # 3. Draw plate highlights
        for plate in plates:
            self._draw_plate_box(out, plate)

        # 4. Draw HUD overlay
        self._draw_hud(out, violations, plates, camera, location)

        # 5. Scanline effect (optional aesthetic)
        self._draw_scanlines(out)

        logger.debug(f"Annotation: {(time.perf_counter()-t0)*1000:.1f}ms")
        return out

    # ── Vehicle Box ───────────────────────────────────────────────────────────

    def _draw_vehicle_box(self, img: np.ndarray, det: DetectionBox):
        x1, y1, x2, y2 = int(det.x1), int(det.y1), int(det.x2), int(det.y2)
        color = (140, 140, 140)  # Grey for non-violation

        # Dashed rectangle simulation (every 8px)
        self._draw_dashed_rect(img, x1, y1, x2, y2, color)

        # Class label (small)
        label = f"{det.class_name} {det.confidence:.0%}"
        (lw, lh), _ = cv2.getTextSize(label, FONT, 0.38, 1)
        cv2.rectangle(img, (x1, y1 - lh - 6), (x1 + lw + 4, y1), (30, 30, 30), -1)
        cv2.putText(img, label, (x1 + 2, y1 - 4), FONT, 0.38, (180, 180, 180), 1, cv2.LINE_AA)

    # ── Violation Box ─────────────────────────────────────────────────────────

    def _draw_violation_box(self, img: np.ndarray, viol: ViolationDetection):
        x1, y1, x2, y2 = int(viol.x1), int(viol.y1), int(viol.x2), int(viol.y2)
        color  = hex_to_bgr(viol.color)
        t      = self._thickness

        # Semi-transparent fill
        overlay = img.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        cv2.addWeighted(overlay, 0.12, img, 0.88, 0, img)

        # Solid border
        cv2.rectangle(img, (x1, y1), (x2, y2), color, t)

        # Corner accents
        clen = 12
        for (cx, cy) in [(x1, y1), (x2, y1), (x1, y2), (x2, y2)]:
            dx = clen if cx == x1 else -clen
            dy = clen if cy == y1 else -clen
            cv2.line(img, (cx, cy), (cx + dx, cy), color, t + 1)
            cv2.line(img, (cx, cy), (cx, cy + dy), color, t + 1)

        # Label background
        icon  = viol.icon if viol.icon.isascii() else "!"
        label = f"{viol.label}"
        conf  = f"{viol.confidence:.1%}"
        (lw, lh), _ = cv2.getTextSize(label, FONT, 0.50, 1)
        lx, ly = x1, max(0, y1 - 22)

        cv2.rectangle(img, (lx - 1, ly - 2), (lx + lw + 60, ly + lh + 4), color, -1)
        cv2.putText(img, label, (lx + 2, ly + lh),     FONT, 0.50, (10, 10, 10), 1, cv2.LINE_AA)
        cv2.putText(img, conf,  (lx + lw + 6, ly + lh), FONT, 0.45, (10, 10, 10), 1, cv2.LINE_AA)

        # Confidence bar (right side of box)
        bar_h    = int((y2 - y1) * viol.confidence)
        bar_x    = x2 + 3
        cv2.rectangle(img, (bar_x, y2 - bar_h), (bar_x + 5, y2), color, -1)

    # ── Plate Box ─────────────────────────────────────────────────────────────

    def _draw_plate_box(self, img: np.ndarray, plate: PlateDetection):
        if plate.x1 == plate.x2 == 0:
            return
        x1, y1, x2, y2 = int(plate.x1), int(plate.y1), int(plate.x2), int(plate.y2)
        blue = (255, 200, 0)   # BGR cyan-ish

        cv2.rectangle(img, (x1, y1), (x2, y2), blue, 2)
        # Plate text label
        plate_label = plate.text
        (pw, ph), _ = cv2.getTextSize(plate_label, FONT_MONO, 0.9, 1)
        cv2.rectangle(img, (x1, y2), (x1 + pw + 8, y2 + ph + 8), (0, 0, 0), -1)
        cv2.putText(img, plate_label, (x1 + 4, y2 + ph + 4),
                    FONT_MONO, 0.9, blue, 1, cv2.LINE_AA)
        # Confidence
        cv2.putText(img, f"{plate.confidence:.0%}", (x2 + 4, y1 + 12),
                    FONT, 0.4, (100, 255, 150), 1, cv2.LINE_AA)

    # ── HUD Overlay ───────────────────────────────────────────────────────────

    def _draw_hud(
        self,
        img:       np.ndarray,
        violations: List[ViolationDetection],
        plates:    List[PlateDetection],
        camera:    str,
        location:  str,
    ):
        h, w = img.shape[:2]

        # Bottom bar
        overlay = img.copy()
        cv2.rectangle(overlay, (0, h - 36), (w, h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.75, img, 0.25, 0, img)

        ts      = datetime.now().strftime("%d-%b-%Y  %H:%M:%S")
        n_viols = len(violations)
        n_plates = len(plates)

        cv2.putText(img,
            f"TrafficAI v2.4  |  {camera}  |  {location}  |  {ts}",
            (8, h - 20), FONT, 0.40, (160, 160, 160), 1, cv2.LINE_AA)

        status_color = (50, 80, 255) if n_viols > 0 else (80, 220, 80)
        status_text  = (f"{n_viols} VIOLATION(S) DETECTED"
                        if n_viols > 0 else "NO VIOLATIONS DETECTED")
        (sw, _), _ = cv2.getTextSize(status_text, FONT, 0.42, 1)
        cv2.putText(img, status_text,
                    (w - sw - 8, h - 20), FONT, 0.42, status_color, 1, cv2.LINE_AA)

        # Plate row
        if plates:
            plate_str = "  |  ".join(p.text for p in plates)
            cv2.putText(img, f"PLATES: {plate_str}",
                        (8, h - 6), FONT, 0.38, (0, 200, 255), 1, cv2.LINE_AA)

        # Top-left live badge
        cv2.rectangle(img, (6, 6), (80, 22), (0, 0, 0), -1)
        cv2.circle(img, (18, 14), 4, (0, 60, 255), -1)
        cv2.putText(img, "LIVE AI", (26, 18), FONT, 0.38, (0, 212, 255), 1, cv2.LINE_AA)

        # Top-right model info
        model_str = "YOLOv8n + EasyOCR"
        (mw, _), _ = cv2.getTextSize(model_str, FONT, 0.36, 1)
        cv2.rectangle(img, (w - mw - 14, 4), (w - 2, 20), (0, 0, 0), -1)
        cv2.putText(img, model_str, (w - mw - 10, 16), FONT, 0.36, (100, 255, 100), 1, cv2.LINE_AA)

    # ── Scanlines (CRT effect) ────────────────────────────────────────────────

    def _draw_scanlines(self, img: np.ndarray, alpha: float = 0.03):
        h, w = img.shape[:2]
        for y in range(0, h, 4):
            img[y:y+1, :] = (img[y:y+1, :] * (1 - alpha)).astype(np.uint8)

    # ── Dashed Rectangle ──────────────────────────────────────────────────────

    @staticmethod
    def _draw_dashed_rect(img, x1, y1, x2, y2, color, dash=8, gap=6, t=1):
        pts = [(x1+i, y1) for i in range(0, x2-x1, dash+gap)] + \
              [(x2, y1+i) for i in range(0, y2-y1, dash+gap)] + \
              [(x2-(i%(x2-x1)), y2) for i in range(0, x2-x1, dash+gap)] + \
              [(x1, y2-(i%(y2-y1))) for i in range(0, y2-y1, dash+gap)]
        for px, py in pts:
            cv2.circle(img, (px, py), t, color, -1)

    # ── Export Helpers ────────────────────────────────────────────────────────

    @staticmethod
    def to_base64(image: np.ndarray, quality: int = 88) -> str:
        """Encode annotated image as Base64 data URI (JPEG)."""
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
        success, buffer = cv2.imencode(".jpg", image, encode_params)
        if not success:
            raise ValueError("Failed to encode image")
        b64 = base64.b64encode(buffer.tobytes()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    @staticmethod
    def to_thumbnail_base64(image: np.ndarray, size: tuple = (280, 160)) -> str:
        """Generate small thumbnail for gallery display."""
        thumb = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
        _, buffer = cv2.imencode(".jpg", thumb, [cv2.IMWRITE_JPEG_QUALITY, 72])
        b64 = base64.b64encode(buffer.tobytes()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    @staticmethod
    def decode_image(image_bytes: bytes) -> np.ndarray:
        """Decode uploaded image bytes to OpenCV array."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image. Unsupported format or corrupt file.")
        return img
