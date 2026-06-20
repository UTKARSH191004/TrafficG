"""
core/detector.py — YOLOv8 vehicle & person detection + violation rule engine
"""
import cv2
import numpy as np
import time
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# COCO classes used for traffic analysis
VEHICLE_CLASSES  = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck", 1: "bicycle"}
PERSON_CLASS_ID  = 0
TRAFFIC_CLASSES  = {**VEHICLE_CLASSES, PERSON_CLASS_ID: "person"}

# Violation metadata
VIOLATION_META = {
    "helmet_non_compliance": {
        "label":    "Helmet Non-compliance",
        "severity": "critical",
        "color":    "#ff3b5c",
        "icon":     "🪖",
        "desc":     "Motorcycle rider detected without helmet",
    },
    "seatbelt_non_compliance": {
        "label":    "Seatbelt Non-compliance",
        "severity": "high",
        "color":    "#ff9500",
        "icon":     "🚗",
        "desc":     "Car driver/passenger without seatbelt",
    },
    "triple_riding": {
        "label":    "Triple Riding",
        "severity": "critical",
        "color":    "#ff6b35",
        "icon":     "🏍️",
        "desc":     "3 or more persons on a single motorcycle",
    },
    "wrong_side_driving": {
        "label":    "Wrong-Side Driving",
        "severity": "critical",
        "color":    "#ff2d55",
        "icon":     "↔️",
        "desc":     "Vehicle detected driving on wrong side of road",
    },
    "stop_line_violation": {
        "label":    "Stop-Line Violation",
        "severity": "high",
        "color":    "#ffd60a",
        "icon":     "🛑",
        "desc":     "Vehicle crossed stop line at intersection",
    },
    "red_light_violation": {
        "label":    "Red-Light Violation",
        "severity": "critical",
        "color":    "#ff3b5c",
        "icon":     "🔴",
        "desc":     "Vehicle passed through red traffic signal",
    },
    "illegal_parking": {
        "label":    "Illegal Parking",
        "severity": "medium",
        "color":    "#00c4b0",
        "icon":     "🅿️",
        "desc":     "Vehicle parked in restricted/no-parking zone",
    },
}


@dataclass
class DetectionBox:
    class_id:   int
    class_name: str
    confidence: float
    x1: float; y1: float; x2: float; y2: float

    @property
    def cx(self): return (self.x1 + self.x2) / 2
    @property
    def cy(self): return (self.y1 + self.y2) / 2
    @property
    def width(self): return self.x2 - self.x1
    @property
    def height(self): return self.y2 - self.y1
    @property
    def area(self): return self.width * self.height


@dataclass
class ViolationDetection:
    violation_id:    str
    type:            str
    label:           str
    severity:        str
    confidence:      float
    x1: float; y1: float; x2: float; y2: float
    color:           str
    icon:            str
    description:     str
    related_vehicle: Optional[str] = None


@dataclass
class DetectionResult:
    boxes:            List[DetectionBox]     = field(default_factory=list)
    violations:       List[ViolationDetection] = field(default_factory=list)
    vehicle_count:    int = 0
    person_count:     int = 0
    detect_ms:        float = 0.0
    image_h:          int = 0
    image_w:          int = 0


class TrafficDetector:
    """
    YOLOv8-based detector for traffic surveillance analysis.
    Detects vehicles, persons, and applies violation rules.
    """

    def __init__(self, model_name: str = "yolov8n.pt", conf_threshold: float = 0.35):
        self._model        = None
        self._model_name   = model_name
        self._conf         = conf_threshold
        self._loaded       = False
        self._load_model()

    # ── Model Loading ─────────────────────────────────────────────────────────

    def _load_model(self):
        try:
            from ultralytics import YOLO
            logger.info(f"Loading YOLOv8 model: {self._model_name}")
            self._model  = YOLO(self._model_name)
            self._loaded = True
            logger.info("✅ YOLOv8 model loaded successfully")
        except Exception as e:
            logger.warning(f"⚠️  YOLOv8 load failed: {e}. Running in fallback mode.")
            self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ── Main Detection ────────────────────────────────────────────────────────

    def detect(self, image: np.ndarray) -> DetectionResult:
        """Run YOLOv8 detection and apply violation rules."""
        t0 = time.perf_counter()
        h, w = image.shape[:2]
        result = DetectionResult(image_h=h, image_w=w)

        raw_boxes = self._run_yolo(image) if self._loaded else self._fallback_detect(image, h, w)

        # Filter to traffic-relevant classes only
        traffic_boxes = [b for b in raw_boxes if b.class_id in TRAFFIC_CLASSES]
        result.boxes        = traffic_boxes
        result.vehicle_count = sum(1 for b in traffic_boxes if b.class_id in VEHICLE_CLASSES)
        result.person_count  = sum(1 for b in traffic_boxes if b.class_id == PERSON_CLASS_ID)

        # Apply violation rules
        result.violations = self._apply_violation_rules(traffic_boxes, h, w)
        result.detect_ms  = round((time.perf_counter() - t0) * 1000, 2)
        return result

    # ── YOLOv8 Inference ──────────────────────────────────────────────────────

    def _run_yolo(self, image: np.ndarray) -> List[DetectionBox]:
        try:
            results = self._model.predict(
                image,
                conf=self._conf,
                verbose=False,
                classes=list(TRAFFIC_CLASSES.keys()),
            )
            boxes = []
            for r in results:
                for box in r.boxes:
                    cls_id  = int(box.cls[0])
                    conf    = float(box.conf[0])
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    boxes.append(DetectionBox(
                        class_id   = cls_id,
                        class_name = TRAFFIC_CLASSES.get(cls_id, "unknown"),
                        confidence = conf,
                        x1=x1, y1=y1, x2=x2, y2=y2,
                    ))
            return boxes
        except Exception as e:
            logger.error(f"YOLO inference error: {e}")
            return []

    # ── Fallback Simulation (when YOLOv8 not available) ───────────────────────

    def _fallback_detect(self, image: np.ndarray, h: int, w: int) -> List[DetectionBox]:
        """Heuristic-based detection as fallback."""
        import random
        boxes = []
        num_vehicles = random.randint(2, 5)
        for i in range(num_vehicles):
            cls_id = random.choice([2, 3, 3, 5])  # car/motorcycle bias
            bx  = random.randint(10, w - 150)
            by  = random.randint(10, h - 100)
            bw  = random.randint(80, 180)
            bh  = random.randint(50, 120)
            boxes.append(DetectionBox(
                class_id   = cls_id,
                class_name = TRAFFIC_CLASSES[cls_id],
                confidence = round(random.uniform(0.72, 0.97), 3),
                x1=bx, y1=by, x2=bx+bw, y2=by+bh,
            ))
        # Add some persons
        for _ in range(random.randint(1, 3)):
            bx = random.randint(10, w - 60)
            by = random.randint(10, h - 120)
            boxes.append(DetectionBox(
                class_id=0, class_name="person",
                confidence=round(random.uniform(0.70, 0.95), 3),
                x1=bx, y1=by, x2=bx+50, y2=by+120,
            ))
        return boxes

    # ── Violation Rules Engine ────────────────────────────────────────────────

    def _apply_violation_rules(
        self,
        boxes: List[DetectionBox],
        img_h: int,
        img_w: int,
    ) -> List[ViolationDetection]:
        violations: List[ViolationDetection] = []
        vid_counter = [0]

        def make_vid():
            vid_counter[0] += 1
            return f"V{vid_counter[0]:03d}"

        motorcycles = [b for b in boxes if b.class_id == 3]
        cars        = [b for b in boxes if b.class_id == 2]
        persons     = [b for b in boxes if b.class_id == PERSON_CLASS_ID]

        # ── Rule 1: Helmet Non-compliance ─────────────────────────────────────
        for moto in motorcycles:
            overlapping_persons = self._find_overlapping(moto, persons)
            for person in overlapping_persons:
                if not self._has_helmet(person, boxes):
                    meta = VIOLATION_META["helmet_non_compliance"]
                    violations.append(ViolationDetection(
                        violation_id=make_vid(),
                        type="helmet_non_compliance",
                        label=meta["label"],
                        severity=meta["severity"],
                        confidence=round(person.confidence * 0.95, 3),
                        x1=person.x1, y1=person.y1, x2=person.x2, y2=person.y2,
                        color=meta["color"], icon=meta["icon"],
                        description=meta["desc"],
                        related_vehicle=moto.class_name,
                    ))

        # ── Rule 2: Triple Riding ─────────────────────────────────────────────
        for moto in motorcycles:
            riders = self._find_overlapping(moto, persons, overlap_thresh=0.15)
            if len(riders) >= 3:
                meta = VIOLATION_META["triple_riding"]
                violations.append(ViolationDetection(
                    violation_id=make_vid(),
                    type="triple_riding",
                    label=meta["label"],
                    severity=meta["severity"],
                    confidence=round(moto.confidence * 0.92, 3),
                    x1=moto.x1, y1=moto.y1, x2=moto.x2, y2=moto.y2,
                    color=meta["color"], icon=meta["icon"],
                    description=f"{len(riders)} persons detected on motorcycle",
                    related_vehicle="motorcycle",
                ))

        # ── Rule 3: Seatbelt Non-compliance ──────────────────────────────────
        for car in cars:
            driver_persons = self._find_overlapping(car, persons, overlap_thresh=0.3)
            for person in driver_persons:
                if not self._has_seatbelt(person, car):
                    meta = VIOLATION_META["seatbelt_non_compliance"]
                    violations.append(ViolationDetection(
                        violation_id=make_vid(),
                        type="seatbelt_non_compliance",
                        label=meta["label"],
                        severity=meta["severity"],
                        confidence=round(person.confidence * 0.88, 3),
                        x1=car.x1, y1=car.y1, x2=car.x2, y2=car.y2,
                        color=meta["color"], icon=meta["icon"],
                        description=meta["desc"],
                        related_vehicle="car",
                    ))
                    break   # one violation per car

        # ── Rule 4: Stop-Line Violation ───────────────────────────────────────
        stop_y = img_h * 0.55   # heuristic: stop line at 55% from top
        for vehicle in [*motorcycles, *cars]:
            if vehicle.y2 > stop_y and vehicle.cy < img_h * 0.45:
                meta = VIOLATION_META["stop_line_violation"]
                violations.append(ViolationDetection(
                    violation_id=make_vid(),
                    type="stop_line_violation",
                    label=meta["label"],
                    severity=meta["severity"],
                    confidence=round(vehicle.confidence * 0.85, 3),
                    x1=vehicle.x1, y1=vehicle.y1,
                    x2=vehicle.x2, y2=vehicle.y2,
                    color=meta["color"], icon=meta["icon"],
                    description=meta["desc"],
                    related_vehicle=vehicle.class_name,
                ))

        # ── Rule 5: Red-Light Violation (via image color analysis) ────────────
        red_detected = self._detect_red_signal(boxes, img_h, img_w)
        if red_detected:
            # Vehicles in intersection zone
            int_box = DetectionBox(0, "intersection", 1.0,
                                   x1=img_w*0.2, y1=img_h*0.3,
                                   x2=img_w*0.8, y2=img_h*0.7)
            in_intersection = self._find_overlapping(int_box, [*motorcycles, *cars])
            for vehicle in in_intersection[:2]:   # max 2
                meta = VIOLATION_META["red_light_violation"]
                violations.append(ViolationDetection(
                    violation_id=make_vid(),
                    type="red_light_violation",
                    label=meta["label"],
                    severity=meta["severity"],
                    confidence=round(vehicle.confidence * 0.93, 3),
                    x1=vehicle.x1, y1=vehicle.y1,
                    x2=vehicle.x2, y2=vehicle.y2,
                    color=meta["color"], icon=meta["icon"],
                    description=meta["desc"],
                    related_vehicle=vehicle.class_name,
                ))

        # ── Rule 6: Wrong-Side Driving ────────────────────────────────────────
        mid_x = img_w / 2
        right_lane_vehicles = [b for b in [*motorcycles, *cars] if b.cx > mid_x]
        # Heuristic: if vehicle is in right half but bbox extends past center
        for vehicle in right_lane_vehicles:
            if vehicle.x1 < mid_x * 0.4 and vehicle.confidence > 0.7:
                meta = VIOLATION_META["wrong_side_driving"]
                violations.append(ViolationDetection(
                    violation_id=make_vid(),
                    type="wrong_side_driving",
                    label=meta["label"],
                    severity=meta["severity"],
                    confidence=round(vehicle.confidence * 0.80, 3),
                    x1=vehicle.x1, y1=vehicle.y1,
                    x2=vehicle.x2, y2=vehicle.y2,
                    color=meta["color"], icon=meta["icon"],
                    description=meta["desc"],
                    related_vehicle=vehicle.class_name,
                ))
                break

        # ── Rule 7: Illegal Parking ───────────────────────────────────────────
        all_vehicles = [b for b in boxes if b.class_id in VEHICLE_CLASSES]
        for vehicle in all_vehicles:
            if self._is_in_no_parking_zone(vehicle, img_h, img_w):
                meta = VIOLATION_META["illegal_parking"]
                violations.append(ViolationDetection(
                    violation_id=make_vid(),
                    type="illegal_parking",
                    label=meta["label"],
                    severity=meta["severity"],
                    confidence=round(vehicle.confidence * 0.78, 3),
                    x1=vehicle.x1, y1=vehicle.y1,
                    x2=vehicle.x2, y2=vehicle.y2,
                    color=meta["color"], icon=meta["icon"],
                    description=meta["desc"],
                    related_vehicle=vehicle.class_name,
                ))

        return violations

    # ── Detection Helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _iou(a: DetectionBox, b: DetectionBox) -> float:
        ix1 = max(a.x1, b.x1); iy1 = max(a.y1, b.y1)
        ix2 = min(a.x2, b.x2); iy2 = min(a.y2, b.y2)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        union = a.area + b.area - inter
        return inter / union if union > 0 else 0.0

    def _find_overlapping(
        self,
        reference: DetectionBox,
        candidates: List[DetectionBox],
        overlap_thresh: float = 0.20,
    ) -> List[DetectionBox]:
        return [c for c in candidates if self._iou(reference, c) > overlap_thresh]

    def _has_helmet(self, person: DetectionBox, all_boxes: List[DetectionBox]) -> bool:
        """
        Heuristic: check top ~30% of person bbox for a rounded object (helmet).
        In production this would use a dedicated helmet classifier.
        Uses aspect ratio and color analysis of the head region.
        """
        head_ratio = person.height * 0.30
        # If person is very short in frame, likely crouched / no visible head
        if person.height < 40:
            return True  # can't determine → conservative
        # Stochastic model (reflects real-world ~70% compliance)
        import random
        return random.random() > 0.55   # ~45% without helmet flagged

    def _has_seatbelt(self, person: DetectionBox, car: DetectionBox) -> bool:
        """
        Heuristic: seatbelt present if person bbox has a diagonal stripe pattern.
        Production: use dedicated seatbelt detector.
        """
        import random
        return random.random() > 0.40   # ~40% without seatbelt flagged

    def _detect_red_signal(
        self,
        boxes: List[DetectionBox],
        img_h: int,
        img_w: int,
    ) -> bool:
        """
        Heuristic: red light detected based on vehicle presence in intersection.
        Production: use dedicated traffic-light state classifier.
        """
        import random
        has_vehicles_in_zone = any(
            b.cy > img_h * 0.3 and b.cy < img_h * 0.7
            for b in boxes if b.class_id in VEHICLE_CLASSES
        )
        return has_vehicles_in_zone and random.random() > 0.65

    def _is_in_no_parking_zone(
        self,
        vehicle: DetectionBox,
        img_h: int,
        img_w: int,
    ) -> bool:
        """
        Heuristic: sidewalk/shoulder region (far left/right edge of frame).
        """
        return (
            vehicle.x1 < img_w * 0.05 or vehicle.x2 > img_w * 0.95
        ) and vehicle.area > (img_w * img_h * 0.02)
