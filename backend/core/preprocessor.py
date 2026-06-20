"""
core/preprocessor.py — OpenCV image enhancement pipeline
Handles: low-light, rain, fog, motion blur, noise, contrast issues
"""
import cv2
import numpy as np
import time
from dataclasses import dataclass
from typing import Tuple


@dataclass
class PreprocessResult:
    image:               np.ndarray
    original_brightness: float
    enhanced_brightness: float
    clahe_applied:       bool
    denoising_applied:   bool
    gamma_correction:    bool
    fog_removal:         bool
    is_blurry:           bool
    lighting:            str
    weather_estimate:    str
    quality_score:       float   # 0.0 – 1.0
    process_ms:          float


class ImagePreprocessor:
    """
    Full OpenCV preprocessing pipeline for traffic surveillance images.
    Applies adaptive enhancement based on detected image conditions.
    """

    def __init__(self):
        # CLAHE (Contrast Limited Adaptive Histogram Equalization)
        self._clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))

    # ── Public API ────────────────────────────────────────────────────────────

    def process(self, image: np.ndarray) -> PreprocessResult:
        """Run full preprocessing pipeline and return enhanced image + metadata."""
        t0 = time.perf_counter()

        orig_brightness = self._mean_brightness(image)
        lighting        = self._classify_lighting(orig_brightness)
        is_blurry       = self._detect_blur(image)
        weather         = self._estimate_weather(image)

        enhanced            = image.copy()
        clahe_applied       = False
        denoising_applied   = False
        gamma_applied       = False
        fog_removal_applied = False

        # ── Step 1: Denoising ────────────────────────────────────────────────
        noise_level = self._estimate_noise(image)
        if noise_level > 15 or weather in ("rain", "fog"):
            enhanced          = cv2.fastNlMeansDenoisingColored(enhanced, None, 8, 8, 7, 21)
            denoising_applied = True

        # ── Step 2: Fog / haze removal ───────────────────────────────────────
        if weather == "fog" or self._detect_haze(image):
            enhanced            = self._remove_haze(enhanced)
            fog_removal_applied = True

        # ── Step 3: Gamma correction for low-light ───────────────────────────
        if lighting in ("dark", "very_dark"):
            gamma         = 1.8 if lighting == "very_dark" else 1.4
            enhanced      = self._apply_gamma(enhanced, gamma)
            gamma_applied = True
        elif lighting == "overexposed":
            enhanced      = self._apply_gamma(enhanced, 0.7)
            gamma_applied = True

        # ── Step 4: CLAHE contrast enhancement ───────────────────────────────
        if lighting != "normal" or is_blurry:
            enhanced      = self._apply_clahe(enhanced)
            clahe_applied = True

        # ── Step 5: Sharpening (if blurry) ───────────────────────────────────
        if is_blurry:
            enhanced = self._sharpen(enhanced)

        # ── Step 6: Normalize to standard size if very large ─────────────────
        enhanced = self._normalize_size(enhanced)

        enhanced_brightness = self._mean_brightness(enhanced)
        quality_score       = self._compute_quality(enhanced, is_blurry, noise_level)
        process_ms          = (time.perf_counter() - t0) * 1000

        return PreprocessResult(
            image               = enhanced,
            original_brightness = round(orig_brightness, 2),
            enhanced_brightness = round(enhanced_brightness, 2),
            clahe_applied       = clahe_applied,
            denoising_applied   = denoising_applied,
            gamma_correction    = gamma_applied,
            fog_removal         = fog_removal_applied,
            is_blurry           = is_blurry,
            lighting            = lighting,
            weather_estimate    = weather,
            quality_score       = round(quality_score, 3),
            process_ms          = round(process_ms, 2),
        )

    # ── Internal Helpers ──────────────────────────────────────────────────────

    def _mean_brightness(self, image: np.ndarray) -> float:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        return float(np.mean(hsv[:, :, 2]))

    def _classify_lighting(self, brightness: float) -> str:
        if brightness < 40:   return "very_dark"
        if brightness < 80:   return "dark"
        if brightness < 160:  return "normal"
        if brightness < 210:  return "bright"
        return "overexposed"

    def _detect_blur(self, image: np.ndarray, threshold: float = 80.0) -> bool:
        gray      = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        return float(laplacian.var()) < threshold

    def _estimate_noise(self, image: np.ndarray) -> float:
        gray  = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blur  = cv2.GaussianBlur(gray, (5, 5), 0)
        diff  = cv2.absdiff(gray.astype(np.float32), blur.astype(np.float32))
        return float(np.mean(diff))

    def _detect_haze(self, image: np.ndarray) -> bool:
        """Simple haze detection: high mean brightness + low saturation variance."""
        hsv  = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        sat  = hsv[:, :, 1]
        return float(np.mean(hsv[:, :, 2])) > 160 and float(np.std(sat)) < 30

    def _estimate_weather(self, image: np.ndarray) -> str:
        hsv         = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        brightness  = float(np.mean(hsv[:, :, 2]))
        saturation  = float(np.mean(hsv[:, :, 1]))

        if brightness < 50:                          return "night"
        if self._detect_haze(image):                 return "fog"
        if saturation < 30 and brightness > 150:     return "overcast"
        if saturation < 20:                          return "rain"
        return "clear"

    def _apply_gamma(self, image: np.ndarray, gamma: float) -> np.ndarray:
        inv_gamma = 1.0 / gamma
        table     = np.array([((i / 255.0) ** inv_gamma) * 255
                              for i in range(256)], dtype=np.uint8)
        return cv2.LUT(image, table)

    def _apply_clahe(self, image: np.ndarray) -> np.ndarray:
        lab       = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l, a, b   = cv2.split(lab)
        l_clahe   = self._clahe.apply(l)
        lab_merge = cv2.merge((l_clahe, a, b))
        return cv2.cvtColor(lab_merge, cv2.COLOR_LAB2BGR)

    def _sharpen(self, image: np.ndarray) -> np.ndarray:
        kernel = np.array([[0, -1, 0],
                           [-1, 5, -1],
                           [0, -1, 0]], dtype=np.float32)
        return cv2.filter2D(image, -1, kernel)

    def _remove_haze(self, image: np.ndarray) -> np.ndarray:
        """Dark channel prior–inspired simple dehazing."""
        img_f    = image.astype(np.float32) / 255.0
        dark_ch  = np.min(img_f, axis=2)
        # Atmospheric light estimate
        atm      = np.percentile(img_f, 99)
        # Transmission map
        t        = 1.0 - 0.9 * dark_ch
        t        = np.clip(t, 0.1, 1.0)
        t3       = np.stack([t, t, t], axis=2)
        # Recover scene
        dehazed  = (img_f - atm) / t3 + atm
        dehazed  = np.clip(dehazed * 255, 0, 255).astype(np.uint8)
        return dehazed

    def _normalize_size(self, image: np.ndarray, max_dim: int = 1280) -> np.ndarray:
        h, w = image.shape[:2]
        if max(h, w) <= max_dim:
            return image
        scale  = max_dim / max(h, w)
        new_w  = int(w * scale)
        new_h  = int(h * scale)
        return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    def _compute_quality(
        self, image: np.ndarray, is_blurry: bool, noise: float
    ) -> float:
        gray  = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        lap   = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        score = min(lap / 300.0, 1.0)          # sharpness
        score -= (noise / 100.0) * 0.3          # noise penalty
        if is_blurry:
            score -= 0.2
        return max(0.0, min(1.0, score))

    @staticmethod
    def quality_label(score: float) -> str:
        if score >= 0.75: return "excellent"
        if score >= 0.50: return "good"
        if score >= 0.25: return "fair"
        return "poor"
