@echo off
title TrafficAI Backend Server
color 0A

echo.
echo  =====================================================
echo    TrafficAI v2.4 -- Python Backend Launcher
echo  =====================================================
echo.

REM ── Check Python ──────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found. Please install Python 3.9+
    echo          https://www.python.org/downloads/
    pause
    exit /b 1
)

echo  [OK] Python found
python --version

REM ── Change to backend directory ────────────────────────
cd /d "%~dp0"
echo  [OK] Working directory: %CD%
echo.

REM ── Create virtual environment if needed ──────────────
if not exist ".venv" (
    echo  [SETUP] Creating virtual environment...
    python -m venv .venv
    echo  [OK] Virtual environment created
)

REM ── Activate virtual environment ──────────────────────
echo  [INFO] Activating virtual environment...
call .venv\Scripts\activate.bat

REM ── Install / upgrade dependencies ────────────────────
echo.
echo  [SETUP] Installing dependencies (first run may take 5-10 min)...
echo          YOLOv8 model will auto-download on first analysis (~6MB)
echo          EasyOCR models will auto-download on first OCR (~100MB)
echo.
pip install -r requirements.txt --quiet --upgrade

if errorlevel 1 (
    echo.
    echo  [ERROR] Dependency installation failed.
    echo          Try running as Administrator or check internet connection.
    pause
    exit /b 1
)

echo.
echo  [OK] All dependencies installed
echo.
echo  =====================================================
echo    Starting TrafficAI API Server
echo    API:  http://localhost:8000
echo    Docs: http://localhost:8000/docs
echo    Press Ctrl+C to stop
echo  =====================================================
echo.

REM ── Launch server ─────────────────────────────────────────────────────
.venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload --log-level info

echo.
echo  [INFO] Server stopped.
pause
