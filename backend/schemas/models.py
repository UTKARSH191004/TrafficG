"""
schemas/models.py — Pydantic request/response models for TrafficAI API
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class SeverityLevel(str, Enum):
    critical = "critical"
    high     = "high"
    medium   = "medium"
    low      = "low"

class ViolationType(str, Enum):
    helmet_non_compliance   = "helmet_non_compliance"
    seatbelt_non_compliance = "seatbelt_non_compliance"
    triple_riding           = "triple_riding"
    wrong_side_driving      = "wrong_side_driving"
    stop_line_violation     = "stop_line_violation"
    red_light_violation     = "red_light_violation"
    illegal_parking         = "illegal_parking"
    overspeeding            = "overspeeding"

class ImageQuality(str, Enum):
    excellent = "excellent"
    good      = "good"
    fair      = "fair"
    poor      = "poor"


# ─── Sub-models ───────────────────────────────────────────────────────────────

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1

    def to_list(self) -> List[float]:
        return [self.x1, self.y1, self.x2, self.y2]


class Detection(BaseModel):
    class_id:    int
    class_name:  str
    confidence:  float = Field(ge=0.0, le=1.0)
    bbox:        BoundingBox
    track_id:    Optional[int] = None


class ViolationResult(BaseModel):
    violation_id:   str
    type:           ViolationType
    label:          str
    severity:       SeverityLevel
    confidence:     float = Field(ge=0.0, le=1.0)
    bbox:           BoundingBox
    color:          str
    icon:           str
    description:    str
    related_vehicle: Optional[str] = None


class PlateResult(BaseModel):
    text:       str
    confidence: float = Field(ge=0.0, le=1.0)
    bbox:       BoundingBox
    region:     Optional[str] = None
    state:      Optional[str] = None


class ImageMetadata(BaseModel):
    width:            int
    height:           int
    channels:         int
    vehicle_count:    int
    person_count:     int
    violation_count:  int
    plate_count:      int
    image_quality:    ImageQuality
    weather_estimate: str
    lighting:         str
    is_blurry:        bool
    brightness:       float


class PreprocessingInfo(BaseModel):
    clahe_applied:        bool
    denoising_applied:    bool
    gamma_correction:     bool
    fog_removal:          bool
    original_brightness:  float
    enhanced_brightness:  float


class PerformanceMetrics(BaseModel):
    preprocess_ms:  float
    detection_ms:   float
    ocr_ms:         float
    annotation_ms:  float
    total_ms:       float


# ─── Response Models ──────────────────────────────────────────────────────────

class AnalyzeResponse(BaseModel):
    status:             str
    image_annotated:    str                   # Base64 data URI
    detections:         List[Detection]
    violations:         List[ViolationResult]
    plates:             List[PlateResult]
    metadata:           ImageMetadata
    preprocessing:      PreprocessingInfo
    performance:        PerformanceMetrics
    timestamp:          str
    analysis_id:        str


class OCRResponse(BaseModel):
    status:     str
    plates:     List[PlateResult]
    image_annotated: str                      # Base64 data URI
    total_found: int
    performance_ms: float


class HealthResponse(BaseModel):
    status:         str
    version:        str
    models_loaded:  Dict[str, bool]
    gpu_available:  bool
    device:         str
    uptime_seconds: float
    total_analyzed: int


class StatsResponse(BaseModel):
    total_violations_today: int
    critical_violations:    int
    detection_accuracy:     float
    plates_recognized:      int
    images_processed:       int
    avg_processing_ms:      float
    violation_breakdown:    Dict[str, int]
    hourly_data:            List[int]


class ViolationRecord(BaseModel):
    id:           str
    plate:        Optional[str]
    violation:    str
    severity:     SeverityLevel
    location:     Optional[str]
    timestamp:    str
    confidence:   float
    status:       str
    camera:       Optional[str]
    image_thumb:  Optional[str]       # Base64 thumbnail


class ViolationListResponse(BaseModel):
    total:      int
    page:       int
    page_size:  int
    records:    List[ViolationRecord]


class ErrorResponse(BaseModel):
    status:  str = "error"
    message: str
    detail:  Optional[str] = None
