#!/bin/bash
# TrafficAI Backend Launcher (Linux / macOS)

echo ""
echo "====================================================="
echo "  TrafficAI v2.4 -- Python Backend Launcher"
echo "====================================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 not found. Please install Python 3.9+"
    exit 1
fi
echo "[OK] $(python3 --version)"

# Navigate to script directory
cd "$(dirname "$0")"
echo "[OK] Working directory: $(pwd)"

# Create virtual environment
if [ ! -d ".venv" ]; then
    echo "[SETUP] Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate
source .venv/bin/activate

# Install dependencies
echo ""
echo "[SETUP] Installing dependencies..."
pip install -r requirements.txt --quiet --upgrade

echo ""
echo "====================================================="
echo "  Starting TrafficAI API Server"
echo "  API:  http://localhost:8000"
echo "  Docs: http://localhost:8000/docs"
echo "  Press Ctrl+C to stop"
echo "====================================================="
echo ""

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload --log-level info
